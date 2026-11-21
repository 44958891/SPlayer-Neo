/**
 * QM 请求层
 *
 * 设计：
 * - 统一走 u.y.qq.com/cgi-bin/musicu.fcg 的 `{ comm, request: {module, method, param} }` 协议
 * - 首次请求前先调 music.getSession.session 拿 uid/sid/userip，缓存 1 小时
 * - 业务码错误不做传输重试；1000/2001 鉴权错误且已登录时刷新凭据并最多重放一次
 * - 凭据刷新按凭据身份单飞（跨账号在途互不阻塞、收尾互不误清）+ 60s 冷却（按当前账号/key 指纹），防止 2001 刷新循环
 * - HTTP 层 4xx 终止不重试，429/5xx 与网络/超时限次重试
 */

import { createHash } from "node:crypto";
import { QM_API_URL, QM_HEADERS, SESSION_TTL, getCommonParams } from "./config";
import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "@main/database/sessions";
import { coreLog } from "@main/utils/logger";
import { sessionToCookieHeader } from "./credential";

/** Session 字段（可能缺失则下次请求会自动补拿） */
interface SessionCache {
  uid?: string;
  sid?: string;
  userip?: string;
  expireAt: number;
}

let session: SessionCache = { expireAt: 0 };
let initPromise: Promise<void> | null = null;
let userCookies: Record<string, string> | null = null;
let sessionGeneration = 0;

/** 使当前客户端会话失效，避免账号变化后继续复用旧会话 */
const invalidateSession = (): void => {
  sessionGeneration++;
  session = { expireAt: 0 };
};

/** 传输层最多额外重试次数 */
const MAX_RETRY = 2;
/** 传输层重试退避（毫秒） */
const RETRY_BACKOFF = 300;
/** 单次 HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 8000;
/** 鉴权刷新冷却时长（毫秒）：同一凭据冷却期内不重复刷新 */
const REFRESH_COOLDOWN_MS = 60 * 1000;
/** 视为鉴权异常、可触发凭据刷新的 fcg 内层业务码（1000 未登录/token 失效, 2001 会话异常） */
const AUTH_ERROR_CODES: ReadonlySet<number> = new Set([1000, 2001]);

/** QM 错误类别：business 为 fcg 业务码错误，transport 为 HTTP/网络传输错误 */
export type QMRequestErrorKind = "business" | "transport";

/**
 * QM 请求错误
 *
 * business：fcg 业务码非零，outerCode/innerCode 取自响应体，消息固定为 `QM API 错误: outer=X inner=Y`
 * transport：HTTP/网络层失败，由静态 transport 工厂构建，outerCode/innerCode 为 -1
 */
export class QMRequestError extends Error {
  /** business 为业务码错误；transport 为 HTTP/网络传输错误 */
  kind: QMRequestErrorKind;
  /** fcg 外层业务码，传输错误为 -1 */
  outerCode: number;
  /** fcg 内层业务码，传输错误为 -1 */
  innerCode: number;
  /** HTTP 状态码，业务错误或网络断开为 0 */
  status: number;
  /** 传输错误是否值得重试 */
  retryable: boolean;

  /**
   * @param outerCode - fcg 外层业务码
   * @param innerCode - fcg 内层业务码
   */
  constructor(outerCode: number, innerCode: number) {
    super(`QM API 错误: outer=${outerCode} inner=${innerCode}`);
    this.name = "QMRequestError";
    this.kind = "business";
    this.outerCode = outerCode;
    this.innerCode = innerCode;
    this.status = 0;
    this.retryable = false;
  }
}

/**
 * 构建 HTTP/网络层传输错误（模块内部使用）
 * @param message - 错误描述（不得包含凭据）
 * @param status - HTTP 状态码，网络断开传 0
 * @param retryable - 是否可重试（429/5xx/网络为 true，其余 4xx 为 false）
 * @returns transport 类别的 QMRequestError
 */
const transportError = (message: string, status = 0, retryable = true): QMRequestError => {
  const err = new QMRequestError(-1, -1);
  err.message = message;
  err.kind = "transport";
  err.status = status;
  err.retryable = retryable;
  return err;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 鉴权刷新冷却状态（仅保留最近一次凭据身份，有界不增长） */
interface AuthRefreshState {
  /** 凭据身份指纹（uin + musickey 摘要） */
  identity: string;
  /** 最近一次刷新尝试完成时间 */
  attemptedAt: number;
  /** 最近一次刷新成功时间，失败为 0 */
  successAt: number;
}

let authRefreshState: AuthRefreshState | null = null;
let refreshPromise: Promise<boolean> | null = null;
/** 当前在途刷新归属的凭据身份指纹；跨账号在途不复用，避免新账号被旧账号的刷新阻塞 */
let refreshIdentity = "";
/** 在途刷新代数，最新一次发起自增；收尾按代数判断，防止旧账号收尾误清新账号的在途记录 */
let refreshGeneration = 0;

/** 读取内存或数据库中的 QM cookies */
export const getQQMusicCookies = (): Record<string, string> => {
  if (userCookies !== null) return userCookies;
  userCookies = getSessionCookies("qqmusic");
  return userCookies;
};

/** 写入内存与数据库并使客户端会话失效 */
const persistCookies = (cookies: Record<string, string>): void => {
  userCookies = cookies;
  saveSessionCookies("qqmusic", cookies);
  invalidateSession();
  coreLog.info(`[qm-cookie] 已保存 Cookie (${Object.keys(cookies).length} 个字段)`);
};

/**
 * 更新 QM cookies 并落库
 *
 * 外部登录/导入凭据入口，会重置鉴权刷新冷却；凭据刷新内部走 persistCookies 不重置
 * @param cookies - 追加合并的 cookie 字段
 */
export const mergeQQMusicCookies = (cookies: Record<string, string>): void => {
  persistCookies({ ...getQQMusicCookies(), ...cookies });
  authRefreshState = null;
};

/** 清空 QM cookies 登录态，并重置鉴权刷新冷却 */
export const clearQQMusicCookies = (): void => {
  userCookies = {};
  clearSessionCookies("qqmusic");
  invalidateSession();
  authRefreshState = null;
  coreLog.info("[qm-cookie] 已从数据库中清空 QM Session");
};

/** 提取当前登录 uin（纯数字形式） */
export const getQQMusicUin = (): string => {
  const cookies = getQQMusicCookies();
  const raw = cookies.qm_str_musicid || cookies.uin || cookies.wxuin || cookies.p_uin || "";
  return raw ? raw.replace(/^o/, "") : "0";
};

/** 当前凭据身份指纹：uin + musickey 的摘要，不落明文 key */
const currentAuthIdentity = (): string => {
  const cookies = getQQMusicCookies();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key || "";
  return createHash("sha256").update(`${getQQMusicUin()}|${musickey}`).digest("hex").slice(0, 16);
};

/** 冷却期内是否存在一次刷新成功（供请求层直接用新凭据重放而不重复刷新） */
const hasRecentRefreshSuccess = (): boolean =>
  !!authRefreshState &&
  authRefreshState.successAt > 0 &&
  Date.now() - authRefreshState.successAt < REFRESH_COOLDOWN_MS &&
  authRefreshState.identity === currentAuthIdentity();

interface FcgResponse {
  code?: number;
  request?: { code?: number; data?: unknown };
  [key: string]: unknown;
}

export interface QMRequestOptions {
  /** 是否在请求前初始化客户端会话 */
  session?: boolean;
  /** 追加到 comm 的字段（如 tmeLoginType） */
  comm?: Record<string, unknown>;
  /** 是否需要携带用户认证凭据 */
  auth?: boolean;
  /** 是否允许在收到鉴权错误时自动刷新凭据 */
  autoRefresh?: boolean;
}

/** 发起一次 fcg POST；HTTP 层失败按 4xx 终止 / 429·5xx·网络瞬态分类抛出 */
const postRaw = async (
  body: unknown,
  extraHeaders?: Record<string, string>,
  useAuth = true,
): Promise<FcgResponse> => {
  const cookies = useAuth ? getQQMusicCookies() : {};
  const cookieStr = sessionToCookieHeader(cookies);

  let res: Response;
  try {
    res = await fetch(QM_API_URL, {
      method: "POST",
      headers: {
        ...QM_HEADERS,
        ...(cookieStr ? { Cookie: cookieStr } : { Cookie: "tmeLoginType=-1;" }),
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw transportError(`QM 网络请求失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw transportError(`QM 请求失败: HTTP ${res.status}`, res.status, retryable);
  }
  try {
    return (await res.json()) as FcgResponse;
  } catch (err) {
    throw transportError(
      `QM 响应解析失败: ${err instanceof Error ? err.message : String(err)}`,
      res.status,
    );
  }
};

/** 初始化 / 刷新 session（1h 过期）；并发安全：同一时刻只发一次 */
const ensureSession = (): Promise<void> => {
  if (session.uid && session.expireAt > Date.now()) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const generation = sessionGeneration;
    try {
      const uin = getQQMusicUin();
      const body = {
        comm: {
          ...getCommonParams(),
          ...(uin && uin !== "0" ? { uin } : {}),
        },
        request: {
          module: "music.getSession.session",
          method: "GetSession",
          param: { caller: 0, uid: uin, vkey: 0 },
        },
      };
      const data = await postRaw(body);
      if (generation === sessionGeneration && data.code === 0 && data.request?.code === 0) {
        const info =
          ((data.request.data as { session?: Partial<SessionCache> }) ?? {}).session ?? {};
        session = {
          uid: info.uid,
          sid: info.sid,
          userip: info.userip,
          expireAt: Date.now() + SESSION_TTL,
        };
      }
    } catch {
      // session 失败不阻塞后续调用，大部分接口无 session 也能回结果
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

/**
 * 发送一次 musicu.fcg 请求
 *
 * 业务码错误立即抛 QMRequestError 不做传输重试；1000/2001 且已登录时刷新凭据并最多重放一次，
 * 重放仍失败立即抛出；冷却期内若刚刷新成功过则直接用新凭据重放一次，避免刷新循环
 * @param module 业务 module（如 music.search.SearchCgiService）
 * @param method 业务 method（如 DoSearchForQQMusicMobile）
 * @param param  业务 param
 * @param options 请求选项
 * @returns request.data 的业务数据段
 */
export const qmRequest = async <T = unknown>(
  module: string,
  method: string,
  param: Record<string, unknown>,
  options: QMRequestOptions = {},
): Promise<T> => {
  const useSession = options.session !== false;
  if (useSession) await ensureSession();

  const useAuth = options.auth !== false;

  const buildComm = () => {
    const cookies = getQQMusicCookies();
    const musickey = useAuth ? cookies.qm_keyst || cookies.qqmusic_key : undefined;
    const uin = useAuth ? getQQMusicUin() : undefined;
    const loginType =
      cookies.tmeLoginType !== undefined
        ? Number(cookies.tmeLoginType)
        : musickey?.startsWith("W_X")
          ? 1
          : 2;

    return {
      ...getCommonParams(),
      ...(uin && uin !== "0" ? { uin, qq: uin } : {}),
      ...(musickey ? { authst: musickey, tmeLoginType: loginType } : {}),
      ...(useSession && session.uid ? { uid: session.uid } : {}),
      ...(useSession && session.sid ? { sid: session.sid } : {}),
      ...(useSession && session.userip ? { userip: session.userip } : {}),
      ...(options.comm ?? {}),
    };
  };

  /** 单次业务请求：传输层限次重试，业务码非零立即抛出 */
  const postBusiness = async (): Promise<T> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const body = { comm: buildComm(), request: { module, method, param } };
        const data = await postRaw(body, undefined, useAuth);
        const outerCode = data.code ?? 0;
        const innerCode = data.request?.code ?? 0;
        if (outerCode !== 0 || innerCode !== 0) throw new QMRequestError(outerCode, innerCode);
        return data.request?.data as T;
      } catch (err) {
        if (err instanceof QMRequestError && !err.retryable) throw err;
        lastErr = err;
        if (attempt < MAX_RETRY) await delay(RETRY_BACKOFF);
      }
    }
    throw lastErr;
  };

  try {
    return await postBusiness();
  } catch (err) {
    const canSelfHeal =
      err instanceof QMRequestError &&
      err.outerCode === 0 &&
      AUTH_ERROR_CODES.has(err.innerCode) &&
      useAuth &&
      getQQMusicUin() !== "0" &&
      options.autoRefresh !== false;
    if (!canSelfHeal) throw err;
    const authErr = err as QMRequestError;

    coreLog.warn(
      `[qm-request] 接口遇到鉴权异常 (outer=${authErr.outerCode} inner=${authErr.innerCode})，尝试自动刷新凭据`,
    );
    const refreshed = await refreshQMCredential();
    if (!refreshed && !hasRecentRefreshSuccess()) throw authErr;
    // 刷新会使客户端会话失效，重放前重新初始化
    if (useSession) await ensureSession();
    return await postBusiness();
  }
};

/** 调试用：取当前 session 快照 */
export const getQMSession = (): Readonly<SessionCache> => session;

/** LoginServer.Login 刷新后的凭据字段 */
interface RefreshCredentialData {
  musickey?: string;
  openid?: string;
  unionid?: string;
  refresh_token?: string;
  access_token?: string;
  expired_at?: number;
  musicid?: number;
  str_musicid?: string;
  refresh_key?: string;
  musickeyCreateTime?: number;
  encryptUin?: string;
  loginType?: number;
}

/**
 * 执行 LoginServer.Login（loginMode=2）向服务端请求刷新 musickey
 * @returns 刷新成功且新 key 已写回返回 true；被拒绝或请求失败返回 false
 */
const performRefreshCredential = async (): Promise<boolean> => {
  const cookies = getQQMusicCookies();
  const uin = getQQMusicUin();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key;
  if (!uin || uin === "0" || !musickey) return false;

  const loginType = Number(cookies.tmeLoginType) || (musickey.startsWith("W_X") ? 1 : 2);
  const refreshKey = cookies.qm_refresh_key || "";

  let param: Record<string, unknown>;
  if (loginType === 1) {
    // 微信型凭据刷新
    param = {
      openid: cookies.wxopenid || cookies.psrf_qqopenid || "",
      refresh_token: cookies.wxrefresh_token || cookies.psrf_qqrefresh_token || "",
      str_musicid: cookies.qm_str_musicid || uin,
      musickey,
      unionid: cookies.psrf_qqunionid || "",
      refresh_key: refreshKey,
      loginMode: 2,
    };
  } else {
    // QQ 型凭据刷新
    param = {
      openid: cookies.psrf_qqopenid || cookies.wxopenid || "",
      access_token: cookies.psrf_qqaccess_token || "",
      refresh_token: cookies.psrf_qqrefresh_token || cookies.wxrefresh_token || "",
      expired_in: Number(cookies.psrf_access_token_expiresAt) || 0,
      musicid: Number(uin) || 0,
      musickey,
      refresh_key: refreshKey,
      loginMode: 2,
    };
  }

  try {
    // 直连而不走 qmRequest：避免业务码非零时的无意义重试
    const generation = sessionGeneration;
    const resp = await postRaw({
      comm: {
        ...getCommonParams(),
        ...(uin !== "0" ? { uin, qq: uin } : {}),
        authst: musickey,
        tmeLoginType: loginType,
      },
      request: {
        module: "music.login.LoginServer",
        method: "Login",
        param,
      },
    });
    // 刷新请求期间账号被切换/清空时，丢弃旧账号凭据的刷新结果
    if (generation !== sessionGeneration) return false;
    const inner = resp.request;
    if (resp.code !== 0 || inner?.code !== 0) {
      // 只记业务码，不落完整响应（可能含 token 类字段）
      coreLog.warn(`[qm-refresh] 刷新被拒绝 (outer=${resp.code ?? -1} inner=${inner?.code ?? -1})`);
      return false;
    }
    const data = inner?.data as RefreshCredentialData | undefined;
    if (!data?.musickey) return false;

    const refreshed: Record<string, string> = {
      qm_keyst: data.musickey,
      qqmusic_key: data.musickey,
      tmeLoginType: String(data.loginType ?? loginType),
    };
    if (data.str_musicid || data.musicid) {
      const musicId = String(data.str_musicid || data.musicid).replace(/^o/, "");
      refreshed.qm_str_musicid = musicId;
      refreshed.uin = musicId;
      if (loginType === 1) refreshed.wxuin = musicId;
    }
    if (data.encryptUin) refreshed.euin = data.encryptUin;
    if (data.openid) refreshed[loginType === 1 ? "wxopenid" : "psrf_qqopenid"] = data.openid;
    if (data.unionid) refreshed.psrf_qqunionid = data.unionid;
    if (data.refresh_token)
      refreshed[loginType === 1 ? "wxrefresh_token" : "psrf_qqrefresh_token"] = data.refresh_token;
    if (data.access_token) refreshed.psrf_qqaccess_token = data.access_token;
    if (data.expired_at) refreshed.psrf_access_token_expiresAt = String(data.expired_at);
    if (data.musickeyCreateTime)
      refreshed.psrf_musickey_createtime = String(data.musickeyCreateTime);
    // 网页 cookie 无此字段，首次刷新后落库供后续刷新复用
    if (data.refresh_key) refreshed.qm_refresh_key = data.refresh_key;

    // 合并写回保留 openid/refresh_token 等未轮换的原始字段
    persistCookies({ ...getQQMusicCookies(), ...refreshed });
    coreLog.info("[qm-refresh] musickey 刷新成功");
    return true;
  } catch (err) {
    coreLog.warn("[qm-refresh] musickey 刷新失败:", err);
    return false;
  }
};

/**
 * 刷新 QM 凭据：按凭据身份单飞 + 冷却互斥
 *
 * 同一凭据的刷新在途时直接复用；不同账号的刷新在途时立即为本账号独立发起新刷新，
 * 旧账号收尾只清理仍归属自己的在途记录，不误清新账号的 promise。
 * 同一凭据冷却期内直接返回 false；手动登录/清空账号会重置冷却（见
 * mergeQQMusicCookies / clearQQMusicCookies），刷新内部写库不重置
 * @returns 刷新成功（新 key 已写回 cookie）返回 true；冷却期内或刷新失败返回 false
 */
export const refreshQMCredential = async (): Promise<boolean> => {
  const identity = currentAuthIdentity();
  // 仅同一凭据的刷新在途才单飞复用，跨账号不复用
  if (refreshPromise && refreshIdentity === identity) return refreshPromise;

  if (
    authRefreshState &&
    authRefreshState.identity === identity &&
    Date.now() - authRefreshState.attemptedAt < REFRESH_COOLDOWN_MS
  ) {
    return false;
  }

  const generation = sessionGeneration;
  const myGeneration = ++refreshGeneration;
  refreshIdentity = identity;
  refreshPromise = (async () => {
    try {
      const ok = await performRefreshCredential();
      // 失败且期间账号已切换：失败属于旧账号，不给新账号贴失败冷却
      if (!ok && generation !== sessionGeneration) return false;
      // 刷新成功会轮换 musickey，冷却状态挂到轮换后的新身份上
      authRefreshState = {
        identity: currentAuthIdentity(),
        attemptedAt: Date.now(),
        successAt: ok ? Date.now() : 0,
      };
      return ok;
    } finally {
      // 仅最新一次发起允许清理，防止旧账号收尾误清新账号的在途记录
      if (myGeneration === refreshGeneration) {
        refreshPromise = null;
        refreshIdentity = "";
      }
    }
  })();
  return refreshPromise;
};
