/**
 * 平台请求节奏门与熔断（纯逻辑，便于复用与测试）
 *
 * 各平台独立限流：连续请求过快会触发风控（网易最敏感），连续失败则阶梯冷却，
 * 冷却中的平台在本次批次内直接跳过，避免单个平台拖住整体进度。
 */

import type { Platform } from "@shared/types/platform";

/** 每平台最小请求间隔（网易对连发最敏感，其余平台留出余量即可） */
export const PLATFORM_PACE_MS: Record<Platform, number> = {
  netease: 700,
  qqmusic: 400,
  kugou: 400,
  kuwo: 400,
  migu: 400,
};

/** 连续失败达到该值时进入冷却 */
const BREAK_THRESHOLD = 8;
/** 阶梯冷却时长 */
const BREAK_COOLDOWNS_MS = [10_000, 30_000, 60_000];

/** 单平台状态 */
export interface PlatformGateState {
  /** 上次发起请求时间（节奏门） */
  lastAt: number;
  /** 连续失败次数 */
  fails: number;
  /** 熔断触发次数 */
  trips: number;
  /** 冷却截止时间戳；0 表示可用 */
  cooldownUntil: number;
  /** 已彻底停用（熔断次数用尽） */
  disabled: boolean;
  /** 请求成功率取样（成功次数） */
  okCount: number;
  /** 请求成功率取样（总次数） */
  totalCount: number;
}

/** 全部平台的门状态 */
export type PlatformGateMap = Record<Platform, PlatformGateState>;

const emptyState = (): PlatformGateState => ({
  lastAt: 0,
  fails: 0,
  trips: 0,
  cooldownUntil: 0,
  disabled: false,
  okCount: 0,
  totalCount: 0,
});

/**
 * 创建各平台门状态
 * @param platforms - 要纳入的平台列表
 */
export const createGates = (platforms: readonly Platform[]): PlatformGateMap => {
  const map = {} as PlatformGateMap;
  for (const platform of platforms) map[platform] = emptyState();
  return map;
};

/** 重置全部门状态（重新开始一轮检测时调用） */
export const resetGates = (gates: PlatformGateMap, platforms: readonly Platform[]): void => {
  for (const platform of platforms) gates[platform] = emptyState();
};

/**
 * 等待某平台的节奏门与冷却结束
 * @param gates - 门状态表
 * @param platform - 平台
 * @param shouldAbort - 取消检查
 * @param maxWaitMs - 最长等待；超出则本次跳过该平台
 * @returns 是否可以发起请求
 */
export const awaitGate = async (
  gates: PlatformGateMap,
  platform: Platform,
  shouldAbort: () => boolean,
  maxWaitMs = 3000,
): Promise<boolean> => {
  const state = gates[platform];
  if (!state) return false;
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (shouldAbort()) return false;
    if (state.disabled) return false;
    const now = Date.now();
    if (now > deadline) return false;
    // 冷却中的平台直接跳过（不再等待冷却结束）
    if (state.cooldownUntil > now) return false;
    const wait = state.lastAt + PLATFORM_PACE_MS[platform] - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, deadline - now)));
      continue;
    }
    state.lastAt = Date.now();
    return true;
  }
};

/** 记录一次成功 */
export const gateSuccess = (gates: PlatformGateMap, platform: Platform): void => {
  const state = gates[platform];
  if (!state) return;
  state.fails = 0;
  state.okCount++;
  state.totalCount++;
};

/** 记录一次失败；连续失败触发冷却，多次熔断后停用该平台 */
export const gateFailure = (gates: PlatformGateMap, platform: Platform): void => {
  const state = gates[platform];
  if (!state) return;
  state.totalCount++;
  state.fails++;
  if (state.fails < BREAK_THRESHOLD) return;
  state.fails = 0;
  if (state.trips >= BREAK_COOLDOWNS_MS.length) {
    state.disabled = true;
    return;
  }
  state.cooldownUntil = Date.now() + BREAK_COOLDOWNS_MS[state.trips];
  state.trips++;
};

/** 跳过计数（熔断禁用或冷却中未发请求）也算一次尝试，用于成功率展示 */
export const gateSkip = (gates: PlatformGateMap, platform: Platform): void => {
  const state = gates[platform];
  if (state) state.totalCount++;
};

/** 全部平台是否都被停用 */
export const allGatesDisabled = (gates: PlatformGateMap, platforms: readonly Platform[]): boolean =>
  platforms.every((platform) => gates[platform]?.disabled === true);
