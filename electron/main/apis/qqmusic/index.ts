/**
 * QM 主进程服务
 *
 * 与 netease 不同之处：
 * - 无持久化 session（uid/sid 是匿名态，内存缓存 1h 足够）
 * - 无 cookie 登录态（播放 URL 由插件实现，不走账号）
 * - 走 fetch 原生 HTTP，无加密 body（靠 UA + comm 伪装）
 *
 * 统一入口：callQQMusic(name, params)
 *
 * 缓存分层（单 Map，LRU 上限 200）：
 * - 全量接口新鲜期 2 分钟；search 成功值额外保留至 30 分钟，接口失败时按「账号 + 参数」回退并附带 searchRecovery
 * - 缓存键按账号隔离（uin + 登录类型摘要，musickey 轮换不影响命中）
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import {
  clearQQMusicCookies,
  getQQMusicCookies,
  getQQMusicUin,
  mergeQQMusicCookies,
} from "./core/request";
import type { QMModule, QMParams } from "./core/types";

export { clearQQMusicCookies, mergeQQMusicCookies };

/** 新鲜期 2 分钟 */
const DEFAULT_TTL = 2 * 60 * 1000;
/** search 失败回退的保留期 */
const STALE_TTL = 30 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  /** 成功时间，回退时作为 cachedAt 透出 */
  cachedAt: number;
  /** 新鲜期截止 */
  freshUntil: number;
  /** 保留期截止；非 search 接口与 freshUntil 相同 */
  retainUntil: number;
}

/** 陈旧回退标记，UI 据此提示结果来自本地缓存 */
export interface QMSearchRecovery {
  kind: "cache";
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
/** 同 key 在途请求，并发去重 */
const inFlight = new Map<string, Promise<any>>();
/** 缓存代数：清空后自增，旧代数的在途响应不得回填 */
let generation = 0;

/** 不缓存的实时接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "user_detail",
  "song_url",
  "comment",
  "login_qr_key",
  "login_qr_check",
]);

/**
 * 计算通用缓存键参数摘要（SHA256 全长，含 timestamp 等原始区分字段）
 * @param params 业务参数
 * @returns 参数摘要 hex
 */
const hashParams = (params: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(params ?? {}))
    .digest("hex");

/** 搜索缓存键使用的规范化参数，默认值与 modules/search 保持一致 */
interface SearchKeyParams {
  keywords: string;
  type: number;
  page: number;
  limit: number;
}

/**
 * 提取搜索缓存键参数并应用默认值
 * @param params 原始调用参数
 * @returns 规范化后的搜索键参数
 */
const normalizeSearchKeyParams = (params: QMParams): SearchKeyParams => {
  const {
    keywords,
    type = 0,
    page = 1,
    limit = 30,
  } = params as {
    keywords?: unknown;
    type?: number;
    page?: number;
    limit?: number;
  };
  return {
    keywords: typeof keywords === "string" ? keywords : String(keywords ?? ""),
    type: Number(type) || 0,
    page: Number(page) || 1,
    limit: Number(limit) || 30,
  };
};

/** 搜索各类目对应的结果条目数组字段 */
const SEARCH_ITEM_KEYS: Readonly<Record<number, string>> = {
  0: "songs",
  8: "albums",
  9: "artists",
  2: "playlists",
};

/**
 * 校验搜索返回值是否为可用成功结果：code=200 且对应类目条目数组存在（空数组有效）
 * @param value 模块返回值
 * @param type 规范化后的搜索类目
 * @returns 是否可作为成功值写入缓存
 */
const isValidSearchValue = (value: unknown, type: number): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.code !== 200) return false;
  const itemKey = SEARCH_ITEM_KEYS[type];
  return itemKey !== undefined && Array.isArray(record[itemKey]);
};

/**
 * 账号维度摘要：uin + 登录类型；musickey 轮换不影响，摘要值不写入日志
 * @returns 账号摘要 hex
 */
const getAccountKey = (): string => {
  const cookies = getQQMusicCookies();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key;
  const loginType =
    cookies.tmeLoginType !== undefined
      ? Number(cookies.tmeLoginType)
      : musickey?.startsWith("W_X")
        ? 1
        : 2;
  return createHash("sha256").update(`${getQQMusicUin()}|${loginType}`).digest("hex");
};

/**
 * 读取新鲜缓存：保留期内但已过新鲜期的 search 条目保留原地供失败回退，其余过期即删
 * @param key 缓存键
 * @returns 新鲜期内命中返回缓存值，否则返回 undefined
 */
const cacheGetFresh = (key: string): unknown => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.retainUntil <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  if (hit.freshUntil <= Date.now()) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

/**
 * 写入缓存，超上限时按插入序淘汰最旧条目
 * @param key 缓存键
 * @param value 待缓存值
 * @param ttl 保留期时长；非 search 为 2 分钟，search 为 30 分钟
 */
const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  // 先移除旧条目再判容量：更新已有键时不挤掉无关条目，且刷新 LRU 位置
  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const now = Date.now();
  cache.set(key, {
    value,
    cachedAt: now,
    freshUntil: now + DEFAULT_TTL,
    retainUntil: now + ttl,
  });
};

/**
 * 清空全部缓存与在途记录，并递增代数使旧在途响应失效
 */
export const clearQQMusicCache = (): void => {
  generation++;
  cache.clear();
  inFlight.clear();
};

/**
 * 同 key 并发调用合并为一次执行；清空后旧执行不得回填缓存，其收尾也不得误删新的在途记录
 * @param key 在途去重键
 * @param task 实际执行体，入参为发起时的缓存代数
 * @returns 执行结果
 */
const runDeduped = (key: string, task: (gen: number) => Promise<any>): Promise<any> => {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const exec = (async () => {
    const gen = generation;
    try {
      return await task(gen);
    } finally {
      // 清空后旧执行的收尾不得误删清空后新建的在途记录
      if (gen === generation) inFlight.delete(key);
    }
  })();
  inFlight.set(key, exec);
  return exec;
};

/**
 * search 调用：新鲜命中直接返回（带 timestamp 的请求真绕过新鲜读取）；
 * 成功仅缓存合法成功值（code=200 且条目数组存在，保留 30 分钟）；
 * 失败时若存在保留期内的缓存，返回附带 searchRecovery 的克隆包装，不改动缓存原值
 * @param params 原始调用参数
 * @param fn search 模块函数
 * @returns 搜索结果，回退时附带 searchRecovery
 */
const callSearch = (params: QMParams, fn: QMModule): Promise<any> => {
  const accountKey = getAccountKey();
  const core = normalizeSearchKeyParams(params);
  const key = `search|${accountKey}|${createHash("sha256")
    .update(JSON.stringify(core))
    .digest("hex")}`;

  if (!Object.hasOwn(params, "timestamp")) {
    const fresh = cacheGetFresh(key);
    if (fresh !== undefined) return Promise.resolve(fresh);
  }

  return runDeduped(key, async (gen) => {
    try {
      const value = await fn(params);
      if (gen !== generation) return value;
      if (isValidSearchValue(value, core.type)) cacheSet(key, value, STALE_TTL);
      return value;
    } catch (err) {
      if (gen !== generation) throw err;
      const entry = cache.get(key);
      if (!entry) throw err;
      if (entry.retainUntil <= Date.now()) {
        cache.delete(key);
        throw err;
      }
      const recovery: QMSearchRecovery = { kind: "cache", cachedAt: entry.cachedAt };
      return { ...(entry.value as Record<string, unknown>), searchRecovery: recovery };
    }
  });
};

/**
 * 调用任意 QM API
 * @param name 见 modules/index.ts 中的 key（search / song_info / lyric / match / hot_search / leaderboard / song_list / user_detail / song_url）
 * @param params 业务参数；不想命中缓存可传 `timestamp: Date.now()`（search 会绕过新鲜读取，失败时仍可能回退缓存结果）
 * @returns 接口结果；search 失败且存在 30 分钟内的成功缓存时，返回附带 searchRecovery 的回退结果
 */
export const callQQMusic = async (name: string, params: QMParams = {}): Promise<any> => {
  // hasOwn 守卫
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown qm api: ${name}`);

  if (NON_CACHEABLE.has(name)) return fn(params);
  if (name === "search") return callSearch(params, fn);

  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGetFresh(key);
  if (hit !== undefined) return hit;

  return runDeduped(key, async (gen) => {
    const value = await fn(params);
    if (gen === generation) cacheSet(key, value);
    return value;
  });
};
