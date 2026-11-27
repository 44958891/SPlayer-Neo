/**
 * 跨平台发现歌单服务
 *
 * 并发拉取五个平台的公开歌单候选（与登录账号无关），按「平台:id」去重、
 * 各平台约 6 条配额选取后混排成目标 30 条；各平台独立失败，最多两轮补取；
 * 新数据不足时保留未重复旧项补齐；全部失败时保旧并如实上报状态
 */

import type { CoverItem } from "@/types/artist";
import { ALL_PLATFORMS, type Platform } from "@shared/types/platform";
import { searchPlaylists } from "@/apis/search";
import {
  createSeededRandom,
  DISCOVERY_MAX_PAGE,
  DISCOVERY_OLD_KEEP_THRESHOLD,
  DISCOVERY_PER_PLATFORM_TARGET,
  DISCOVERY_TARGET_COUNT,
  discoveryKey,
  interleaveByPlatform,
  maxValidPage,
  pickThemes,
  retainOldItems,
  selectPlatformCandidates,
  type DiscoveryPlaylist,
  type DiscoveryResult,
} from "@/utils/playlistDiscovery";
import { fetchDiscoveryPlaylistPool } from "./netease";
import { fetchMiguDiscoverPlaylists } from "./migu";

export type { DiscoveryPlaylist, DiscoveryResult };

/** 搜索类平台歌单搜索页宽（实测 QQ / 酷狗 / 酷我均支持 30） */
const SEARCH_PAGE_SIZE = 30;
/** 网易候选池拉取数（匿名 personalized 实测支持 60） */
const NETEASE_POOL_LIMIT = 60;
/** 发现服务主题池（均为搜索平台实测有效的通用歌单关键词） */
const DISCOVERY_THEMES = [
  "流行",
  "华语",
  "经典",
  "轻音乐",
  "民谣",
  "电子",
  "摇滚",
  "睡眠",
  "粤语",
  "影视",
] as const;

/** 单平台单轮候选批次 */
interface PlatformBatch {
  /** 候选条目（尚未带 source，咪咕适配器自带 source） */
  items: CoverItem[];
  /** 接口报告的候选总数 */
  total?: number;
  /** 是否可能还有下一页 */
  hasMore: boolean;
}

/** 单平台拉取函数入参：主题与页码 */
type PlatformFetcher = (theme: string, page: number) => Promise<PlatformBatch>;

/** 单平台两轮间的拉取状态 */
interface PlatformState {
  /** 已选中的新条目 */
  picked: DiscoveryPlaylist[];
  /** 配额外真实备选，用于补齐目标数量 */
  surplus: DiscoveryPlaylist[];
  /** 最近一轮批次，补取页码据此计算 */
  batch?: PlatformBatch;
  /** 本轮使用的主题，补取沿用同主题换页 */
  theme?: string;
  /** 上一轮请求页码 */
  lastPage: number;
  /** 最近一次请求是否失败 */
  lastAttemptFailed: boolean;
}

/** 网易候选池：公开 personalized 单池无分页 */
const fetchNeteaseCandidates: PlatformFetcher = async () => {
  const items = await fetchDiscoveryPlaylistPool(NETEASE_POOL_LIMIT);
  return { items, hasMore: false };
};

/**
 * 创建搜索类平台（QQ / 酷狗 / 酷我）的候选拉取函数
 * @param platform - 平台标识
 * @returns 候选拉取函数
 */
const createSearchFetcher =
  (platform: Platform): PlatformFetcher =>
  async (theme, page) => {
    const result = await searchPlaylists(
      platform,
      theme,
      (page - 1) * SEARCH_PAGE_SIZE,
      SEARCH_PAGE_SIZE,
    );
    return { items: result.items, total: result.total, hasMore: result.hasMore };
  };

/** 咪咕候选：主进程全池 + 渲染侧按页切片，整页返回时假定还有下一页 */
const fetchMiguCandidates: PlatformFetcher = async (theme, page) => {
  const items = await fetchMiguDiscoverPlaylists({ limit: SEARCH_PAGE_SIZE, topic: theme, page });
  return { items, hasMore: items.length >= SEARCH_PAGE_SIZE };
};

/** 各平台候选拉取函数 */
const PLATFORM_FETCHERS = Object.fromEntries(
  ALL_PLATFORMS.map((platform): [Platform, PlatformFetcher] => {
    if (platform === "netease") return [platform, fetchNeteaseCandidates];
    if (platform === "qqmusic" || platform === "kugou" || platform === "kuwo") {
      return [platform, createSearchFetcher(platform)];
    }
    return [platform, fetchMiguCandidates];
  }),
) as Record<Platform, PlatformFetcher>;

/**
 * 拉取跨平台发现歌单
 *
 * 五平台并发请求，最多两轮补取：第二轮沿用同主题随机有效页（尊重 total、
 * 页深封顶 5），首轮失败的平台换主题重试；平台独立失败互不影响；
 * 全部失败时保留上一批（去重、封顶 30）并返回 freshCount = 0 与完整 failedPlatforms
 * @param previous - 上一批展示的歌单，用于去重与不足时补齐
 * @returns 混排结果与准确状态
 */
export const fetchDiscoveryPlaylists = async (
  previous: readonly DiscoveryPlaylist[] = [],
): Promise<DiscoveryResult> => {
  const random = createSeededRandom(Date.now());
  const previousKeys = new Set(previous.map(discoveryKey));
  const seenKeys = new Set(previousKeys);
  const themes = pickThemes(DISCOVERY_THEMES, ALL_PLATFORMS.length * 2, random);
  const createState = (): PlatformState => ({
    picked: [],
    surplus: [],
    lastPage: 1,
    lastAttemptFailed: false,
  });
  const states = Object.fromEntries(
    ALL_PLATFORMS.map((platform) => [platform, createState()]),
  ) as Record<Platform, PlatformState>;

  const runRound = async (round: number, targets: readonly Platform[]): Promise<void> => {
    await Promise.allSettled(
      targets.map(async (platform, index) => {
        const state = states[platform];
        const retry = round > 0 && state.lastAttemptFailed;
        const theme =
          retry || !state.theme
            ? (themes[round * ALL_PLATFORMS.length + index] as string)
            : state.theme;
        let page = 1;
        if (round > 0 && !state.lastAttemptFailed) {
          if (platform === "netease") return;
          if (platform === "migu") {
            page = state.lastPage + 1;
            if (!state.batch?.hasMore || page > DISCOVERY_MAX_PAGE) return;
          } else {
            const max = maxValidPage(state.batch?.total, SEARCH_PAGE_SIZE, DISCOVERY_MAX_PAGE);
            if (max === null || max < 2) return;
            page = 2 + Math.floor(random() * (max - 1));
          }
        }
        try {
          const batch = await PLATFORM_FETCHERS[platform](theme, page);
          state.batch = batch;
          state.theme = theme;
          state.lastPage = page;
          state.lastAttemptFailed = false;
          const quota = DISCOVERY_PER_PLATFORM_TARGET - state.picked.length;
          const selection = selectPlatformCandidates(
            platform,
            batch.items,
            quota,
            previousKeys,
            seenKeys,
          );
          state.picked.push(...selection.picked);
          state.surplus.push(...selection.surplus);
        } catch {
          state.lastAttemptFailed = true;
        }
      }),
    );
  };

  await runRound(0, ALL_PLATFORMS);
  const totalPicked = () =>
    ALL_PLATFORMS.reduce((sum, platform) => sum + states[platform].picked.length, 0);
  if (totalPicked() < DISCOVERY_TARGET_COUNT) {
    const targets = ALL_PLATFORMS.filter((platform) => {
      const state = states[platform];
      return state.picked.length < DISCOVERY_PER_PLATFORM_TARGET || state.lastAttemptFailed;
    });
    await runRound(1, targets);
  }

  const groups = ALL_PLATFORMS.map((platform) => states[platform].picked);
  let items = interleaveByPlatform(groups, random, DISCOVERY_TARGET_COUNT);
  if (items.length < DISCOVERY_TARGET_COUNT) {
    const surplusGroups = ALL_PLATFORMS.map((platform) => states[platform].surplus);
    const extra = interleaveByPlatform(
      surplusGroups,
      random,
      DISCOVERY_TARGET_COUNT - items.length,
    );
    items = items.concat(extra);
  }
  const freshCount = items.length;
  const failedPlatforms = ALL_PLATFORMS.filter((platform) => {
    const state = states[platform];
    return state.lastAttemptFailed && state.picked.length === 0;
  });

  let reusedCount = 0;
  if (freshCount === 0) {
    const kept = retainOldItems(previous, new Set(), DISCOVERY_TARGET_COUNT);
    items = kept;
    reusedCount = kept.length;
  } else if (items.length < DISCOVERY_OLD_KEEP_THRESHOLD) {
    const freshKeys = new Set(items.map(discoveryKey));
    const retained = retainOldItems(previous, freshKeys, DISCOVERY_TARGET_COUNT - items.length);
    items = items.concat(retained);
    reusedCount = retained.length;
  }

  return { items, failedPlatforms, reusedCount, freshCount };
};
