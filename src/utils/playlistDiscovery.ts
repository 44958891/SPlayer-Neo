/**
 * 发现歌单纯选择逻辑
 *
 * 不做任何网络请求，只负责：种子伪随机、主题抽取、候选去重与配额选择、
 * 跨平台混排、有效页码计算、旧列表保留，供发现服务与测试复用
 */

import type { CoverItem } from "@/types/artist";
import type { Platform } from "@shared/types/platform";

/** 发现歌单目标数量 */
export const DISCOVERY_TARGET_COUNT = 30;
/** 发现歌单单平台选取数 */
export const DISCOVERY_PER_PLATFORM_TARGET = 6;
/** 发现歌单最大页深（实测 QQ 第 999 页返回空、酷狗直接报错，深页结果质量差） */
export const DISCOVERY_MAX_PAGE = 5;
/** 上一批低于该数量时才用未重复旧项补齐 */
export const DISCOVERY_OLD_KEEP_THRESHOLD = 25;

/** 发现歌单条目：封面卡片 + 数据来源平台 */
export type DiscoveryPlaylist = CoverItem & { source: Platform };

/** 发现歌单拉取结果 */
export interface DiscoveryResult {
  /** 混排后的歌单列表（含保留的旧项） */
  items: DiscoveryPlaylist[];
  /** 全部尝试均失败且无任何新条目的平台 */
  failedPlatforms: Platform[];
  /** 从上一批保留的旧项数量 */
  reusedCount: number;
  /** 本轮新拉取的条目数量 */
  freshCount: number;
}

/**
 * 生成「平台:id」去重键
 * @param item - 含来源平台与 id 的条目
 * @returns 去重键
 */
export const discoveryKey = (item: { source: Platform; id: string }): string =>
  `${item.source}:${item.id}`;

/**
 * mulberry32 伪随机数生成器
 * @param seed - 随机种子（服务层传时间戳）
 * @returns 持续产出 [0, 1) 随机数的函数
 */
export const createSeededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * 按随机流从主题池不重复抽取主题
 * @param pool - 主题池
 * @param count - 需要的主题数，超出池大小时按池大小截断
 * @param random - 随机数函数
 * @returns 抽取的主题列表
 */
export const pickThemes = (
  pool: readonly string[],
  count: number,
  random: () => number,
): string[] => {
  const remaining = [...pool];
  const total = Math.min(count, remaining.length);
  const picked: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const index = Math.floor(random() * remaining.length);
    picked.push(remaining.splice(index, 1)[0] as string);
  }
  return picked;
};

/**
 * Fisher-Yates 就地洗牌（Math.random 驱动，测试可 mock）
 * @param list - 待洗牌数组
 */
const shuffleInPlace = <T>(list: T[]): void => {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j] as T, list[i] as T];
  }
};

/**
 * 平台候选选择：剔除无效条目、Fisher-Yates 洗牌后 source:id 去重、
 * 避开上一批、有封面优先、按配额截取
 * 选中与溢出的键都写入 seenKeys，保证同一次拉取内跨轮不重复
 * @param platform - 数据来源平台
 * @param candidates - 平台候选（尚未带 source）
 * @param quota - 还需选取的数量
 * @param excludeKeys - 上一批条目的去重键
 * @param seenKeys - 本次拉取已占用的去重键（就地更新）
 * @returns 选中项与溢出备选
 */
export const selectPlatformCandidates = (
  platform: Platform,
  candidates: readonly CoverItem[],
  quota: number,
  excludeKeys: ReadonlySet<string>,
  seenKeys: Set<string>,
): { picked: DiscoveryPlaylist[]; surplus: DiscoveryPlaylist[] } => {
  const valid = candidates.filter((item) => Boolean(item.id) && Boolean(item.title?.trim()));
  const withCover = valid.filter((item) => item.cover);
  const withoutCover = valid.filter((item) => !item.cover);
  shuffleInPlace(withCover);
  shuffleInPlace(withoutCover);
  const ordered = [...withCover, ...withoutCover];
  const picked: DiscoveryPlaylist[] = [];
  const surplus: DiscoveryPlaylist[] = [];
  for (const item of ordered) {
    const tagged: DiscoveryPlaylist = { ...item, source: platform };
    const key = discoveryKey(tagged);
    if (excludeKeys.has(key) || seenKeys.has(key)) continue;
    if (picked.length < quota) {
      picked.push(tagged);
    } else {
      surplus.push(tagged);
    }
    seenKeys.add(key);
  }
  return { picked, surplus };
};

/**
 * 跨平台轮询混排：先按随机流打乱平台顺序，再逐平台轮流取条目
 * @param groups - 按平台分组的条目
 * @param random - 随机数函数
 * @param max - 结果上限
 * @returns 混排后的条目
 */
export const interleaveByPlatform = (
  groups: readonly DiscoveryPlaylist[][],
  random: () => number,
  max: number,
): DiscoveryPlaylist[] => {
  const order = [...groups];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as DiscoveryPlaylist[], order[i] as DiscoveryPlaylist[]];
  }
  const queues = order.map((group) => [...group]);
  const result: DiscoveryPlaylist[] = [];
  while (result.length < max) {
    let advanced = false;
    for (const queue of queues) {
      if (result.length >= max) break;
      const next = queue.shift();
      if (next) {
        result.push(next);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return result;
};

/**
 * 计算给定候选总数下的最大有效页码，未知 total 时按最大页深封顶
 * @param total - 接口报告的候选总数，未知传 undefined
 * @param limit - 页宽
 * @param maxPage - 最大页深
 * @returns 最大有效页码，候选总数为 0 时为 null
 */
export const maxValidPage = (
  total: number | undefined,
  limit: number,
  maxPage: number,
): number | null => {
  if (total === undefined) return maxPage;
  if (total <= 0) return null;
  return Math.min(maxPage, Math.ceil(total / limit));
};

/**
 * 从上一批保留未重复旧项，用于补齐目标数量
 * @param previous - 上一批歌单
 * @param freshKeys - 本轮新条目的去重键
 * @param limit - 最多保留数量
 * @returns 保留的旧项（保持原顺序）
 */
export const retainOldItems = (
  previous: readonly DiscoveryPlaylist[],
  freshKeys: ReadonlySet<string>,
  limit: number,
): DiscoveryPlaylist[] => {
  const kept: DiscoveryPlaylist[] = [];
  const localKeys = new Set<string>();
  for (const item of previous) {
    if (kept.length >= limit) break;
    const key = discoveryKey(item);
    if (freshKeys.has(key) || localKeys.has(key)) continue;
    kept.push(item);
    localKeys.add(key);
  }
  return kept;
};
