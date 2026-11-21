/**
 * lx-music-desktop user_api 脚本兼容兼容层
 *
 * 在沙箱里注入 `window.lx` / `globalThis.lx`，把 lx 的 `EVENT_NAMES` / `request` / `on` / `send` / `utils`
 * / `currentScriptInfo` / `version` / `env` 桥接到 splayer 宿主 API。
 *
 * 被 host.worker.ts 导入，运行在 utilityProcess + vm.Context 外层（注入前）。
 */

import crypto from "node:crypto";
import zlib from "node:zlib";
import type {
  HostApi,
  MusicUrlReq,
  MusicUrlRes,
  PluginAction,
  PluginQuality,
  PluginUpdateInfo,
  SourceCapability,
} from "@shared/types/plugin";
// 运行时依赖走相对路径：node:test/tsx（test:node）不解析根 tsconfig 的 paths 别名，
// 类型导入（上方 @shared/types）编译期剥除不受影响
import { findPlatformQuality } from "../../../shared/utils/platformQuality";

/**
 * lx 原生音质枚举 → 宿主 PluginQuality 的映射
 * 兼容 128k/192k/320k/flac/flac24bit 以及各类别名、环绕/母带档（atmos/master）
 *
 * 本轮 29 档为 EM 实测 raw 全集（nac/dts/excellent 未支持，刻意不收录，不做猜测映射）：
 * kw 128k/320k/flac/master；kg 增 hires/atmos；tx 增 atmos_plus；wy 增 192k/jyeffect/sky；mg 增 hires
 * - atmos（QQ 平原全景声 qqmusic:qq-spatial）与 atmos_plus（全景声 2.0 qqmusic:qq-spatial-2.0）
 *   同落宿主 sky，但具体选择 ID 与请求原档严格区分、互不替代
 * - master 落宿主 jymaster；通用 master 候选可以请求，但回执 master 仅证明母带品牌档，不证明母带 4.0
 */
const LX_TO_HOST_QUALITY: Record<string, PluginQuality> = {
  "128k": "lq",
  "128": "lq",
  standard: "lq",
  "192k": "sq",
  "192": "sq",
  "320k": "hq",
  "320": "hq",
  high: "hq",
  hq: "hq",
  flac: "lossless",
  ape: "lossless",
  wav: "lossless",
  lossless: "lossless",
  sq: "lossless",
  flac24bit: "hi-res",
  hires: "hi-res",
  "hi-res": "hi-res",
  // 环绕声 / 母带档：lx 生态用 atmos / master 表示，部分脚本直接用宿主档位名
  atmos: "sky",
  atmos_plus: "sky",
  sky: "sky",
  jyeffect: "jyeffect",
  surround: "jyeffect",
  master: "jymaster",
  "qq-master-4.0": "jymaster",
  "臻品母带4.0": "jymaster",
  jymaster: "jymaster",
};

/** 宿主档位由低到高的顺序（与 utils/quality 的 QUALITY_ORDER 保持一致） */
const HOST_QUALITY_ORDER: readonly PluginQuality[] = [
  "lq",
  "sq",
  "hq",
  "lossless",
  "hi-res",
  "jyeffect",
  "sky",
  "jymaster",
];

const HOST_QUALITY_RANK: Record<PluginQuality, number> = Object.fromEntries(
  HOST_QUALITY_ORDER.map((q, i) => [q, i]),
) as Record<PluginQuality, number>;

/**
 * 宿主档位 → 可接受的 lx 音质字符串（按优先级从高到低，含逐级降档）
 * 仅在该源未声明 qualitys 时作为兜底使用
 */
const HOST_TO_LX_QUALITY: Record<PluginQuality, string> = {
  jymaster: "flac24bit",
  sky: "flac24bit",
  jyeffect: "flac24bit",
  lq: "128k",
  sq: "192k",
  hq: "320k",
  lossless: "flac",
  "hi-res": "flac24bit",
};

/** 宿主档位 → 候选 lx 音质字符串（优先级从高到低，含降档链） */
const HOST_TO_LX_CANDIDATES: Record<PluginQuality, readonly string[]> = {
  jymaster: [
    "qq-master-4.0",
    "臻品母带4.0",
    "master",
    "jymaster",
    "hires",
    "flac24bit",
    "flac",
    "320k",
    "192k",
    "128k",
  ],
  sky: ["sky", "atmos", "atmos_plus", "hires", "flac24bit", "flac", "320k", "192k", "128k"],
  jyeffect: [
    "jyeffect",
    "atmos",
    "atmos_plus",
    "hires",
    "flac24bit",
    "flac",
    "320k",
    "192k",
    "128k",
  ],
  "hi-res": ["flac24bit", "hires", "flac", "320k", "192k", "128k"],
  lossless: ["flac", "320k", "192k", "128k"],
  hq: ["320k", "192k", "128k"],
  sq: ["192k", "128k"],
  lq: ["128k"],
};

export const mapLxQualityToHost = (q: string): PluginQuality | null =>
  LX_TO_HOST_QUALITY[String(q).toLowerCase()] ?? null;

/**
 * 校验脚本回包里的来源键，只保留安全的短标识（wy / kg / kugou 等）
 * @param value - 脚本回包中的来源字段
 * @returns 规范化的小写来源键，非法或缺省返回 undefined
 */
const sanitizeSourceKey = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(key) ? key : undefined;
};

/**
 * 校验脚本回包里的原生档位文本，只保留安全的短字符串
 * @param value - 脚本回包中的档位字段
 * @returns 去除首尾空白后的档位文本，非法或缺省返回 undefined
 */
const sanitizeNativeTier = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const tier = value.trim();
  return tier && tier.length <= 96 ? tier : undefined;
};

/** gzPlayback 回执协议的白名单版本，其余版本声明一律不采信 */
const GZ_EVIDENCE_VERSION = 1;
/** 回执能力登记的源数量上限，防止异常声明撑爆 per-source 表 */
const MAX_GZ_SOURCES = 64;
/** 单源别名条目上限 */
const MAX_GZ_ALIASES = 32;

/**
 * 校验别名与档位标识文本，只保留安全短字符串（小写字母数字与 ._-）
 * @param value - 脚本声明的档位/别名文本
 * @returns 规范化的小写标识，非法返回 undefined
 */
const sanitizeQualityToken = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const token = value.trim().toLowerCase();
  return /^[a-z0-9._-]{1,32}$/.test(token) ? token : undefined;
};

/**
 * 解析对象回包根部的 gzPlayback v1 回执
 * 版本不在白名单或缺实际档位文本时视为无回执，请求保持"未确认"状态
 * @param value - 回包里的 gzPlayback 字段
 * @returns 合法回执返回实际档位文本，其余返回 null
 */
const parseGzReceipt = (value: unknown): { quality: string } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.version !== GZ_EVIDENCE_VERSION) return null;
  const quality = sanitizeNativeTier(obj.quality);
  return quality ? { quality } : null;
};

const mapHostQualityToLx = (q: PluginQuality): string => HOST_TO_LX_QUALITY[q] ?? "320k";

/**
 * 把宿主档位翻译成该源真正声明支持的 lx 音质字符串
 * - 声明列表非空：在候选链里选第一个插件支持的档位；无交集时回落到不高于请求档位的最高声明档
 * - 声明列表缺失：沿用静态映射，保持对老脚本的兼容
 * @param requested - 宿主请求档位
 * @param declared - 该源在 inited 里声明的 lx 音质字符串（小写）
 * @returns 实际下发给插件的 lx 字符串及其对应的宿主档位
 */
export const pickLxQuality = (
  requested: PluginQuality,
  declared?: ReadonlySet<string>,
): { lx: string; host: PluginQuality } => {
  if (declared && declared.size > 0) {
    for (const lx of HOST_TO_LX_CANDIDATES[requested]) {
      if (declared.has(lx)) return { lx, host: mapLxQualityToHost(lx) ?? requested };
    }
    const requestedRank = HOST_QUALITY_RANK[requested];
    let best: { lx: string; host: PluginQuality; rank: number } | null = null;
    for (const lx of declared) {
      const host = mapLxQualityToHost(lx);
      if (!host) continue;
      const rank = HOST_QUALITY_RANK[host];
      if (rank <= requestedRank && (!best || rank > best.rank)) best = { lx, host, rank };
    }
    if (best) return { lx: best.lx, host: best.host };
  }
  const lx = mapHostQualityToLx(requested);
  return { lx, host: mapLxQualityToHost(lx) ?? requested };
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const EVENT_NAMES = {
  request: "request",
  inited: "inited",
  updateAlert: "updateAlert",
} as const;

const eventNames: readonly string[] = Object.values(EVENT_NAMES);

/** lx.request 回调签名（与 lx-music-desktop preload 对齐） */
type LxRequestCallback = (
  err: Error | null,
  resp?: {
    statusCode: number;
    statusMessage?: string;
    headers: Record<string, string>;
    bytes?: number;
    raw?: Buffer;
    body?: unknown;
  },
  body?: unknown,
) => void;

/** lx.on('request', handler) 的 handler 形状 */
type LxRequestHandler = (req: {
  source: string;
  action: string;
  info: Record<string, unknown>;
}) => unknown | Promise<unknown>;

export interface LxCurrentScriptInfo {
  name: string;
  description: string;
  version: string;
  author: string;
  homepage: string;
  rawScript: string;
}

/** 规范化输入为标准的 Uint8Array / Buffer */
const toBuffer = (val: unknown): Buffer => {
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array || val instanceof ArrayBuffer)
    return Buffer.from(val as ArrayBuffer);
  if (Array.isArray(val)) return Buffer.from(val as number[]);
  if (typeof val === "string") return Buffer.from(val, "utf-8");
  return Buffer.alloc(0);
};

/** lx.utils — 参数签名与 lx-music 脚本完全兼容 */
const buildLxUtils = (): object => ({
  crypto: {
    aesEncrypt: (
      buffer: Buffer | Uint8Array | number[],
      mode: string,
      key: Buffer | Uint8Array | number[],
      iv?: Buffer | Uint8Array | number[],
    ): Buffer => {
      const buf = toBuffer(buffer);
      const keyBuf = toBuffer(key);
      const ivBuf = iv ? toBuffer(iv) : null;
      const cipher = crypto.createCipheriv(mode, keyBuf, ivBuf);
      return Buffer.concat([cipher.update(buf), cipher.final()]);
    },
    rsaEncrypt: (buffer: Buffer | Uint8Array | number[], key: string): Buffer => {
      const buf = toBuffer(buffer);
      const padded = buf.length < 128 ? Buffer.concat([Buffer.alloc(128 - buf.length), buf]) : buf;
      return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, padded);
    },
    randomBytes: (size: number): Buffer => crypto.randomBytes(size),
    md5: (str: string | Uint8Array | number[]): string =>
      crypto
        .createHash("md5")
        .update(typeof str === "string" ? str : toBuffer(str))
        .digest("hex"),
  },
  buffer: {
    from: (
      data: ArrayBuffer | SharedArrayBuffer | string | Uint8Array | number[],
      encoding?: BufferEncoding,
    ): Buffer =>
      typeof data === "string" ? Buffer.from(data, encoding) : Buffer.from(data as ArrayBuffer),
    bufToString: (
      buf: Buffer | Uint8Array | string | number[],
      format: BufferEncoding = "utf-8",
    ): string => {
      if (typeof buf === "string") return Buffer.from(buf, "binary").toString(format);
      return toBuffer(buf).toString(format);
    },
  },
  zlib: {
    inflate: (buf: Buffer | Uint8Array | number[]): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        zlib.inflate(toBuffer(buf), (err, data) => {
          if (err) reject(new Error(err.message));
          else resolve(data);
        });
      }),
    deflate: (data: Buffer | Uint8Array | string | number[]): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        zlib.deflate(toBuffer(data), (err, buf) => {
          if (err) reject(new Error(err.message));
          else resolve(buf);
        });
      }),
  },
});

/** LX 歌曲信息结构 */
export interface LxMusicInfo {
  id: string;
  songmid: string;
  songId: string;
  name: string;
  singer: string;
  source: string;
  interval: string | null;
  img: string | null;
  lrc: string | null;
  otherSource: unknown;
  types: string[];
  _types: Record<string, unknown>;
  typeUrl: Record<string, unknown>;
  hash?: string;
  strMediaMid?: string;
  copyrightId?: string;
  albumId: string;
  albumName: string;
  meta: {
    songId: string;
    albumName: string;
    albumId: string;
    picUrl: string | null;
    hash?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 将宿主传入的 musicInfo 归一化 */
export const normalizeLxMusicInfo = (
  raw: MusicUrlReq["musicInfo"] | undefined,
  source: string,
): LxMusicInfo => {
  const info = raw ?? { songmid: "" };
  const meta =
    typeof info.meta === "object" && info.meta !== null
      ? (info.meta as Record<string, unknown>)
      : {};
  const id = String(info.id ?? info.songmid ?? info.songId ?? meta.songId ?? "");
  const name = String(info.name ?? info.title ?? "");
  const singer = String(info.singer ?? info.artist ?? "");
  const albumName = String(info.albumName ?? meta.albumName ?? "");
  const albumId = String(info.albumId ?? meta.albumId ?? "");
  const interval = typeof info.interval === "string" ? info.interval : null;
  const img = (info.img ?? info.pic ?? meta.picUrl ?? null) as string | null;

  const rawHash = info.hash ?? meta.hash;
  const isKg = source === "kg" || source === "kugou";
  const hash =
    typeof rawHash === "string" && rawHash.trim().length > 0
      ? rawHash.trim()
      : isKg && id.length === 32 && /^[0-9a-fA-F]{32}$/.test(id)
        ? id
        : undefined;

  const rawStrMediaMid = info.strMediaMid ?? meta.strMediaMid;
  const strMediaMid =
    typeof rawStrMediaMid === "string" && rawStrMediaMid.trim().length > 0
      ? rawStrMediaMid.trim()
      : source === "tx" || source === "qqmusic"
        ? id
        : undefined;

  const rawCopyrightId = info.copyrightId ?? meta.copyrightId;
  const copyrightId =
    typeof rawCopyrightId === "string" && rawCopyrightId.trim().length > 0
      ? rawCopyrightId.trim()
      : undefined;

  const resMeta: Record<string, unknown> = {
    ...meta,
    songId: id,
    albumName,
    albumId,
    picUrl: img,
  };
  if (hash) {
    resMeta.hash = hash;
  } else {
    delete resMeta.hash;
  }

  const result: LxMusicInfo = {
    ...info,
    name,
    singer,
    source,
    songmid: id,
    id,
    songId: id,
    albumId,
    albumName,
    interval,
    img,
    lrc: (info.lrc as string | null | undefined) ?? null,
    otherSource: info.otherSource ?? null,
    types: Array.isArray(info.types) ? (info.types as string[]) : [],
    _types:
      typeof info._types === "object" && info._types !== null
        ? (info._types as Record<string, unknown>)
        : {},
    typeUrl: {},
    meta: resMeta as LxMusicInfo["meta"],
  };

  if (hash) {
    result.hash = hash;
  } else {
    delete (result as Record<string, unknown>).hash;
  }
  if (strMediaMid) {
    result.strMediaMid = strMediaMid;
  } else {
    delete (result as Record<string, unknown>).strMediaMid;
  }
  if (copyrightId) {
    result.copyrightId = copyrightId;
  } else {
    delete (result as Record<string, unknown>).copyrightId;
  }

  return result;
};

/**
 * 安装 lx 兼容层
 * @param sandboxGlobal 沙箱上下文对象（vm.createContext 前的 plain object）
 * @param splayer 宿主 API 实例
 * @param handlers 共享的 action handler 注册表
 * @param onSources 脚本通过 lx.send('inited', {sources}) 注册能力时的回调
 * @param onUpdateAvailable 脚本通过 lx.send('updateAlert', ...) 上报新版本时的回调
 * @param scriptInfo lx 脚本 currentScriptInfo（主进程解析完头注释后传入）
 */
export const installLxShim = (
  sandboxGlobal: Record<string, unknown>,
  splayer: HostApi,
  handlers: Map<PluginAction, (req: unknown) => Promise<unknown>>,
  onSources: (sources: Record<string, SourceCapability>) => void,
  onUpdateAvailable: (info: PluginUpdateInfo) => void,
  scriptInfo?: LxCurrentScriptInfo,
): void => {
  let requestHandler: LxRequestHandler | null = null;
  let inited = false;
  let updateAlerted = false;
  /** 各源在 inited 里声明的 lx 音质字符串（小写），请求时用于挑选插件真正支持的档位 */
  const declaredQualitys = new Map<string, Set<string>>();
  /** 各源声明的 gzPlayback 回执协议版本，仅白名单版本入表 */
  const gzEvidenceVersions = new Map<string, number>();
  /** 各源声明的请求档位别名：key 为宿主候选原档，value 为脚本实际接受的原档（均小写） */
  const gzAliases = new Map<string, Map<string, string>>();

  const lxApi = {
    EVENT_NAMES,
    version: "2.0.0",
    env: "desktop",

    request(
      url: string,
      opts: Record<string, unknown> | undefined,
      callback: LxRequestCallback,
    ): () => void {
      const o = opts ?? {};
      const method = ((o.method as string) ?? "GET").toUpperCase() as "GET" | "POST";
      const timeout = typeof o.timeout === "number" ? (o.timeout as number) : undefined;
      // headers 强制转纯字符串字典，避免脚本传 Proxy / 带函数的对象触发结构化克隆失败
      const headers: Record<string, string> = {};
      const rawHeaders = (o.headers as Record<string, unknown> | undefined) ?? {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (typeof v === "string") headers[k] = v;
        else if (v != null) headers[k] = String(v);
      }
      // form/formData 在 needle 里会被 urlencode/multipart 序列化
      // 这里 body 优先，其次 form/formData 走 URLSearchParams 序列化并补 content-type
      const rawBody = o.body;
      const rawForm = (o.form ?? o.formData) as Record<string, unknown> | undefined;
      let body: string | Uint8Array | ArrayBuffer | undefined;
      let formContentType: string | undefined;
      if (rawBody != null) {
        if (typeof rawBody === "string") body = rawBody;
        else if (rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer) body = rawBody;
        else if (typeof rawBody === "object") {
          try {
            body = JSON.stringify(rawBody);
          } catch {
            body = undefined;
          }
        }
      } else if (rawForm && typeof rawForm === "object") {
        const usp = new URLSearchParams();
        for (const [field, value] of Object.entries(rawForm)) {
          if (value == null) continue;
          usp.append(field, String(value));
        }
        body = usp.toString();
        formContentType = "application/x-www-form-urlencoded";
      }
      // 注入默认 User-Agent，避免反爬接口直接拦截
      const hasUserAgent = Object.keys(headers).some((k) => k.toLowerCase() === "user-agent");
      if (!hasUserAgent) {
        headers["User-Agent"] = DEFAULT_USER_AGENT;
      }

      // 默认 content-type 放前面，让用户传的 headers 仍能覆盖
      const finalHeaders: Record<string, string> = formContentType
        ? { "content-type": formContentType, ...headers }
        : headers;
      let aborted = false;

      const safeCallback: LxRequestCallback = (err, resp, body) => {
        if (aborted) return;
        try {
          callback(err, resp, body);
        } catch (cbErr) {
          splayer.log.error("[lx-shim] request callback threw:", (cbErr as Error)?.message);
        }
      };

      splayer
        .request(url, {
          method,
          headers: finalHeaders,
          body,
          timeout,
          responseType: "text",
        })
        .then((resp) => {
          if (aborted) return;
          const rawText = typeof resp.body === "string" ? (resp.body as string) : "";
          let parsedBody: unknown = rawText;
          try {
            parsedBody = JSON.parse(rawText);
          } catch {
            /* 保留原字符串 */
          }
          const raw = Buffer.from(rawText, "utf-8");
          safeCallback(
            null,
            {
              statusCode: resp.status,
              statusMessage: resp.status === 200 ? "OK" : "",
              headers: resp.headers,
              bytes: raw.byteLength,
              raw,
              body: parsedBody,
            },
            parsedBody,
          );
        })
        .catch((err: Error) => {
          if (aborted) return;
          safeCallback(err, undefined, null);
        });

      // lx 返回一个 abort 函数；当前无法真正取消底层 fetch，置 aborted 丢弃结果
      return () => {
        aborted = true;
      };
    },

    on(eventName: string, handler: LxRequestHandler): Promise<void> {
      if (!eventNames.includes(eventName)) {
        return Promise.reject(new Error("The event is not supported: " + eventName));
      }
      if (eventName === EVENT_NAMES.request) {
        requestHandler = handler;
        return Promise.resolve();
      }
      return Promise.reject(new Error("The event is not supported: " + eventName));
    },

    send(eventName: string, data: Record<string, unknown>): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!eventNames.includes(eventName)) {
          reject(new Error("The event is not supported: " + eventName));
          return;
        }
        switch (eventName) {
          case EVENT_NAMES.inited: {
            if (inited) {
              reject(new Error("Script is inited"));
              return;
            }
            inited = true;
            // lx 脚本上报的 sources.qualitys / qualities 是 lx 原生音质字符串，
            // 转成宿主 PluginQuality 去重后再注册给 router
            const rawSources =
              (data?.sources as Record<
                string,
                {
                  name?: string;
                  actions?: string[];
                  qualitys?: string[];
                  qualities?: string[];
                  gzQualityEvidenceVersion?: unknown;
                  gzQualityAliases?: unknown;
                  [key: string]: unknown;
                }
              >) ?? {};
            const normalized: Record<string, SourceCapability> = {};
            for (const [key, cap] of Object.entries(rawSources)) {
              const rawQualities = cap.qualitys ?? cap.qualities ?? [];
              const lowered = rawQualities.map((q) => String(q).toLowerCase());
              declaredQualitys.set(key, new Set(lowered));
              // 回执协议能力：版本白名单外的声明与别名一律不采信，别名只保留安全短字符串
              if (
                cap.gzQualityEvidenceVersion === GZ_EVIDENCE_VERSION &&
                gzEvidenceVersions.size < MAX_GZ_SOURCES
              ) {
                gzEvidenceVersions.set(key, GZ_EVIDENCE_VERSION);
                const rawAliases = cap.gzQualityAliases;
                if (rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases)) {
                  const safe = new Map<string, string>();
                  for (const [from, to] of Object.entries(rawAliases)) {
                    if (safe.size >= MAX_GZ_ALIASES) break;
                    const fromKey = sanitizeQualityToken(from);
                    const toKey = sanitizeQualityToken(to);
                    if (fromKey && toKey) safe.set(fromKey, toKey);
                  }
                  if (safe.size > 0) gzAliases.set(key, safe);
                }
              }
              const mapped = new Set<PluginQuality>();
              for (const q of rawQualities) {
                const host = mapLxQualityToHost(q);
                if (host) mapped.add(host);
              }
              const actions = (cap.actions ?? []).filter(
                (action): action is PluginAction => action === "musicUrl",
              );
              // 不支持任何宿主已识别动作的源直接丢弃，避免 audioSource 误把
              // lyric-only 脚本当成 musicUrl 候选去调，结果走到归一校验抛 PLUGIN_INVALID_RESULT
              if (actions.length === 0) continue;
              // 保留脚本声明的原始档位（小写），供具体平台音质选择按原档精确匹配；
              // 回执能力与别名同步进公开能力表，供下游溯源按版本协议解释响应
              normalized[key] = {
                name: cap.name ?? key,
                actions,
                qualities: Array.from(mapped),
                ...(lowered.length ? { nativeQualities: Array.from(new Set(lowered)) } : {}),
                ...(gzEvidenceVersions.has(key)
                  ? { gzQualityEvidenceVersion: GZ_EVIDENCE_VERSION }
                  : {}),
                ...(gzAliases.has(key)
                  ? { gzQualityAliases: Object.fromEntries(gzAliases.get(key)!) }
                  : {}),
              };
            }
            onSources(normalized);
            resolve();
            return;
          }
          case EVENT_NAMES.updateAlert: {
            if (updateAlerted) {
              reject(new Error("The update alert can only be called once."));
              return;
            }
            updateAlerted = true;
            // 上报给宿主，由 UI 层展示"有更新"徽章与打开下载链接按钮；
            // 不再落日志（脚本通常会自己 console.log，重复输出无意义）
            onUpdateAvailable({
              log: typeof data?.log === "string" ? (data.log as string) : undefined,
              updateUrl:
                typeof data?.updateUrl === "string" ? (data.updateUrl as string) : undefined,
              version: typeof data?.version === "string" ? (data.version as string) : undefined,
              updatedAt: Date.now(),
            });
            resolve();
            return;
          }
          default:
            reject(new Error("Unknown event name: " + eventName));
        }
      });
    },

    utils: buildLxUtils(),

    currentScriptInfo: scriptInfo ?? {
      name: "",
      description: "",
      version: "",
      author: "",
      homepage: "",
      rawScript: "",
    },
  };

  sandboxGlobal.lx = lxApi;
  // 部分脚本通过 window.lx 访问
  if (typeof sandboxGlobal.window === "object" && sandboxGlobal.window !== null) {
    (sandboxGlobal.window as Record<string, unknown>).lx = lxApi;
  } else {
    sandboxGlobal.window = sandboxGlobal;
  }

  // 为每个 action 安装一个通用分派器：把 router 的 call 转译成 lx 的 request 形状
  const registerAction = (action: PluginAction): void => {
    handlers.set(action, async (req: unknown) => {
      if (!requestHandler) {
        splayer.log.warn("[lx-shim] no request handler registered for action", action);
        throw Object.assign(new Error("lx plugin has not registered request handler"), {
          code: "PLUGIN_NOT_READY",
        });
      }
      const reqObj = req as MusicUrlReq;
      const source = reqObj.source ?? "";
      const hostQuality = reqObj.quality;
      const declared = declaredQualitys.get(source);
      const gzVersion = gzEvidenceVersions.get(source);
      const aliases = gzAliases.get(source);
      // 具体平台音质选择：只在脚本声明里能对上候选原档时精确请求（info.type 收到原档字符串）；
      // 声明非空却对不上时全档位显式报错，不做逐级降档冒充（臻品/全景声/母带等同理）；
      // 未声明 qualitys 的老脚本维持旧链为物理档兜底，品牌档（requiresDeclaration）仍报错
      const selection =
        typeof reqObj.qualitySelection === "string" && reqObj.qualitySelection
          ? findPlatformQuality(reqObj.qualitySelection)
          : undefined;
      if (reqObj.qualitySelection && !selection) {
        throw Object.assign(new Error("quality selection is no longer supported"), {
          code: "QUALITY_SELECTION_UNSUPPORTED",
        });
      }
      let picked: { lx: string; host: PluginQuality } | null = null;
      if (selection) {
        const exact = declared
          ? selection.lxCandidates.find((candidate) => declared.has(candidate.toLowerCase()))
          : undefined;
        if (exact) {
          picked = { lx: exact, host: selection.level };
        } else if ((declared && declared.size > 0) || selection.requiresDeclaration) {
          throw Object.assign(
            new Error(`quality selection ${selection.id} is not declared by source ${source}`),
            { code: "QUALITY_SELECTION_UNSUPPORTED" },
          );
        }
      }
      // lx 期待 128k/320k/flac/... 音质字符串，宿主的 quality 做一次翻译；
      // 脚本声明了 qualitys 时按声明选它支持的档位（例如母带档翻译成 master 而不是 flac24bit）
      if (!picked && hostQuality) picked = pickLxQuality(hostQuality, declared);
      // 别名只作用于脚本声明过的键：把候选原档换成脚本实际接受的同义档
      if (picked && aliases) {
        const aliased = aliases.get(picked.lx);
        if (aliased) picked = { ...picked, lx: aliased };
      }
      const lxType = picked?.lx ?? (hostQuality ? mapHostQualityToLx(hostQuality) : undefined);
      const effectiveQuality = picked?.host;
      // 回执信封只发给声明过 v1 的源；带显式选择时 strictQuality 置真，
      // 源在对不上档位时回 409 GZ_QUALITY_DIFFERENT；通用请求 strict 为假，仅收集证据
      const info = {
        type: lxType,
        musicInfo: normalizeLxMusicInfo(reqObj.musicInfo, source),
        ...(gzVersion === GZ_EVIDENCE_VERSION
          ? { gzPlayback: { version: GZ_EVIDENCE_VERSION, strictQuality: Boolean(selection) } }
          : {}),
      };
      const raw = await Promise.resolve(requestHandler({ source, action, info }));
      const requestedSelection =
        typeof reqObj.qualitySelection === "string" && reqObj.qualitySelection
          ? reqObj.qualitySelection
          : undefined;
      // 字符串回包只是请求回显：quality 取请求换算档位，requestedTier 记录请求的 lx 档位，
      // 不虚构实际来源与响应原生档位
      if (typeof raw === "string") {
        return {
          url: raw,
          ...(effectiveQuality ? { quality: effectiveQuality } : {}),
          ...(lxType ? { requestedTier: lxType } : {}),
          ...(requestedSelection ? { requestedSelection } : {}),
        } as MusicUrlRes;
      }
      if (raw && typeof raw === "object") {
        const rawObj = raw as Record<string, unknown>;
        const url = rawObj.url;
        if (typeof url === "string") {
          // 实际来源仅接受响应显式回传；与请求来源相同的 source 字段视为回显，不作证据
          const echoedSource = sanitizeSourceKey(rawObj.source);
          const actualSource =
            sanitizeSourceKey(rawObj.actualSource) ??
            sanitizeSourceKey(rawObj.platform) ??
            (echoedSource && echoedSource !== source ? echoedSource : undefined);
          // v1 回执：仅声明过能力的源 + 回执版本合法时才采信实际档位；
          // 档位无法识别时不回写请求档位，nativeTier 保留源回传的原始文本
          const receipt =
            gzVersion === GZ_EVIDENCE_VERSION ? parseGzReceipt(rawObj.gzPlayback) : null;
          if (receipt) {
            const receiptHost = mapLxQualityToHost(receipt.quality);
            return {
              url,
              ...(receiptHost ? { quality: receiptHost } : {}),
              ...(lxType ? { requestedTier: lxType } : {}),
              ...(requestedSelection ? { requestedSelection } : {}),
              ...(actualSource ? { actualSource } : {}),
              nativeTier: receipt.quality,
              sourceEvidence: "gzPlayback-v1",
            } as MusicUrlRes;
          }
          // 无有效回执：响应视为未确认，quality 维持请求换算值，不带 sourceEvidence
          let nativeTier = sanitizeNativeTier(rawObj.nativeTier);
          const responseQuality =
            typeof rawObj.quality === "string" ? mapLxQualityToHost(rawObj.quality) : null;
          if (
            !nativeTier &&
            typeof rawObj.quality === "string" &&
            /^\d{2,8}$/.test(rawObj.quality.trim())
          ) {
            nativeTier = rawObj.quality.trim();
          }
          return {
            url,
            quality: responseQuality ?? effectiveQuality,
            ...(lxType ? { requestedTier: lxType } : {}),
            ...(requestedSelection ? { requestedSelection } : {}),
            ...(actualSource ? { actualSource } : {}),
            ...(nativeTier ? { nativeTier } : {}),
          } as MusicUrlRes;
        }
      }
      throw Object.assign(new Error("lx plugin returned invalid musicUrl result"), {
        code: "PLUGIN_INVALID_RESULT",
      });
    });
  };

  (["musicUrl"] as PluginAction[]).forEach(registerAction);
};
