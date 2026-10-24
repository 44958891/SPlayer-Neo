/**
 * 酷我（Kuwo）主进程服务
 *
 * 统一入口：callKuwo(name, params)
 * 提供与 kugou 模块同构的调用器与 2 分钟响应缓存。
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import { getSessionCookies, saveSessionCookies } from "@main/database/sessions";
import type { KWParams } from "./core/types";

/** 酷我会话 cookies（登录后由网页登录窗口写入） */
export const getKuwoSession = (): Record<string, string> => getSessionCookies("kuwo");

export const mergeKuwoSession = (values: Record<string, string>): void => {
  saveSessionCookies("kuwo", { ...getKuwoSession(), ...values });
};

/** 登出：清空登录态（kw_token 是匿名访客标识，无会话价值，一并清） */
export const clearKuwoSession = (): void => saveSessionCookies("kuwo", {});

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;
const NON_CACHEABLE = new Set(["song_url", "lyric"]);

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

const hashParams = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

const cacheGet = (key: string): unknown => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expireAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

const cacheSet = (key: string, value: unknown): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + DEFAULT_TTL });
};

export const clearKuwoCache = (): void => cache.clear();

/**
 * 调用任意 KW API
 * @param name - 模块名（search / album / artist / playlist / song_url）
 * @param params - 业务参数
 */
export const callKuwo = async <T = any>(name: string, params: KWParams = {}): Promise<T> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown kw api: ${name}`);
  if (NON_CACHEABLE.has(name)) return (await fn(params)) as T;
  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit as T;
  const value = await fn(params);
  cacheSet(key, value);
  return value as T;
};
