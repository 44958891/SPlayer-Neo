/**
 * 音源插件体检登记表
 *
 * 持久化每个（插件脚本 × 平台源 × 音质档 × 曲目）的取链/探测结论，供取链编排
 * 跳过已知硬失败组合、复用近期成功探测，减少无效请求。
 *
 * 落盘：`{app-data}/plugins/health.json`（原子写）
 * 键：`{pluginId}#{scriptHash}|{source}|{quality}|{trackKey}`
 *   - 脚本 hash 变化（插件更新）后旧结论自动失效，不会误伤新版本脚本
 *   - 曲目键必须带上：无版权/无链接类硬失败是单曲级的，
 *     不带会把"某首歌拿不到"误记成"该插件整体不可用"
 * 生命周期（两条读取路径都必须生效）：
 *   - 成功结论（ok）保留 24h，期间同组合可复用探测体积
 *   - 硬失败结论（hard）保留 12h，期间该组合在取链阶段被跳过
 *   - 软失败（超时/网络抖动）不记录，下次照常尝试
 *   - 过期记录在任何读取路径上都不可见，并在读取时顺带剪除（防无限增长）
 */

import fs from "node:fs";
import path from "node:path";
import { writeFileSync as atomicWriteSync } from "atomically";
import { pluginsDir } from "@main/utils/paths";
import type { PluginQuality } from "@shared/types/plugin";
import { buildHealthKey, type PluginHealthEntry } from "@shared/utils/audioProbe";

/** 单条体检结论（形状与共享层一致，便于 IPC 传输） */
export type HealthEntry = PluginHealthEntry;

/** 成功结论有效期 */
const OK_TTL_MS = 24 * 60 * 60 * 1000;
/** 硬失败结论有效期 */
const FAIL_TTL_MS = 12 * 60 * 60 * 1000;

const healthFile = (): string => path.join(pluginsDir, "health.json");

let cache: Record<string, HealthEntry> | null = null;

const ensureDir = (): void => {
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
};

/** 结论是否已过期 */
const isExpired = (entry: HealthEntry, now = Date.now()): boolean =>
  now - entry.at > (entry.ok ? OK_TTL_MS : FAIL_TTL_MS);

/** 原始表（含过期项，仅供内部剪枝与写盘） */
const load = (): Record<string, HealthEntry> => {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(healthFile(), "utf-8")) as {
      entries?: Record<string, HealthEntry>;
    };
    cache = raw.entries ?? {};
  } catch {
    cache = {};
  }
  return cache;
};

const flush = (): void => {
  ensureDir();
  atomicWriteSync(
    healthFile(),
    JSON.stringify({ version: 1, savedAt: Date.now(), entries: load() }, null, 2),
  );
};

/**
 * 读取「有效」表：剪掉过期项并在有变化时落盘
 *
 * 全量快照与单点查询都走这里，保证 TTL 在两条路径上一致生效。
 * 过期项此前只在单点查询里被剔除，而渲染层取链时读的是全量快照，
 * 导致过期结论长期生效（等于永久黑名单）。
 */
const readLive = (): Record<string, HealthEntry> => {
  const entries = load();
  const now = Date.now();
  const next: Record<string, HealthEntry> = {};
  let pruned = 0;
  for (const [key, entry] of Object.entries(entries)) {
    if (entry && !isExpired(entry, now)) next[key] = entry;
    else pruned++;
  }
  if (pruned > 0) {
    cache = next;
    flush();
  }
  return cache ?? next;
};

/** 组装体检键（委托共享实现，保证主/渲染两侧键一致） */
export const healthKey = buildHealthKey;

/** 查询结论；过期返回 null */
export const healthLookup = (key: string): HealthEntry | null => {
  const entry = readLive()[key];
  return entry ?? null;
};

/** 批量查询：返回每个键的结论（无结论或过期时为 null） */
export const healthLookupMany = (keys: string[]): Record<string, HealthEntry | null> => {
  const table = readLive();
  const out: Record<string, HealthEntry | null> = {};
  for (const key of keys) out[key] = table[key] ?? null;
  return out;
};

/** 写入一条结论 */
export const healthReport = (key: string, entry: HealthEntry): void => {
  const entries = readLive();
  cache = { ...entries, [key]: entry };
  flush();
};

/** 清除体检记录；传 pluginId 只清该插件（脚本更新后可由上层调用） */
export const healthClear = (pluginId?: string): number => {
  const entries = load();
  const next: Record<string, HealthEntry> = {};
  let removed = 0;
  for (const [key, entry] of Object.entries(entries)) {
    if (pluginId && !key.startsWith(`${pluginId}#`)) {
      next[key] = entry;
      continue;
    }
    removed++;
  }
  cache = next;
  flush();
  return removed;
};

/** 快照：只含未过期记录（取链编排读的是这条路径） */
export const healthSnapshot = (): Record<string, HealthEntry> => ({ ...readLive() });

/** 平台源与音质均为主进程内部约定，类型仅用于文档 */
export type HealthContext = { source: string; quality: PluginQuality };
