/**
 * 咪咕（Migu）主进程服务
 *
 * 统一入口：callMigu(name, params)，与 kugou / kuwo 模块同构，带 2 分钟响应缓存。
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

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

export const clearMiguCache = (): void => cache.clear();

/**
 * 调用任意咪咕 API
 * @param name - 模块名（当前仅 search）
 * @param params - 业务参数
 */
export const callMigu = async <T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown migu api: ${name}`);
  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit as T;
  const value = await fn(params);
  cacheSet(key, value);
  return value as T;
};
