import type { Track } from "@shared/types/player";
import { shouldSkipKeywordTrack } from "@/utils/preset/skipKeywords";

/**
 * 随机播放状态机
 *
 * 队列（播放列表）顺序保持调用方给出的原始顺序，永远不被打乱；
 * 随机模式只决定「下一首要跳到哪个索引」。一轮内不重复，
 * 全部播完后自动开新一轮。
 */

/** 随机挑选时的跳过关键词设置 */
export interface ShuffleSkipOptions {
  skipKeywordsSongs: boolean;
  skipTrackKeywords: readonly string[];
}

/** 随机挑选结果 */
export interface ShufflePick {
  id: string;
  index: number;
}

/** 本轮已播放（含当前）的曲目 id */
const playedIds = new Set<string>();
/** 已预定好的下一首：预载、交叉过渡与真正切歌必须用同一个决定 */
let upcoming: ShufflePick | null = null;
/** 随机模式下的后退历史（队列索引栈） */
const history: number[] = [];
const HISTORY_LIMIT = 100;

/** 开启随机或整体更换队列时调用：开新一轮，当前曲记为已播 */
export const resetShuffleRound = (currentId?: string | null): void => {
  playedIds.clear();
  if (currentId) playedIds.add(currentId);
  upcoming = null;
  history.length = 0;
};

/** 清空后退历史（队列结构变化后旧索引不再可靠） */
export const clearShuffleHistory = (): void => {
  history.length = 0;
};

/** 前进换曲时压入当前位置，供随机模式下的「上一首」回退 */
export const pushShuffleHistory = (index: number): void => {
  history.push(index);
  if (history.length > HISTORY_LIMIT) history.shift();
};

/** 弹出上一首的队列位置；无有效历史时返回 null */
export const popShuffleHistory = (queueLength: number): number | null => {
  while (history.length > 0) {
    const index = history.pop() as number;
    if (index >= 0 && index < queueLength) return index;
  }
  return null;
};

/** 手动播放某曲时把它记为本轮已播 */
export const markShufflePlayed = (id: string | null | undefined): void => {
  if (id) playedIds.add(id);
};

/** 预定的下一首被手动播掉时使其失效 */
export const invalidateShuffleIfUpcoming = (id: string | null | undefined): void => {
  if (id && upcoming?.id === id) upcoming = null;
};

const isSkipped = (track: Track, opts?: ShuffleSkipOptions): boolean =>
  !!opts?.skipKeywordsSongs && shouldSkipKeywordTrack(track, opts.skipTrackKeywords);

/** 现场挑选下一首：优先「本轮未播 + 不命中跳过词」，逐级放宽 */
const pickShuffle = (
  queue: readonly Track[],
  currentId: string | null | undefined,
  opts?: ShuffleSkipOptions,
): ShufflePick | null => {
  const len = queue.length;
  if (len <= 1) return null;
  const found = currentId ? queue.findIndex((track) => track.id === currentId) : -1;
  const currentIndex = found >= 0 ? found : 0;

  const collect = (fresh: boolean, usable: boolean): number[] => {
    const out: number[] = [];
    for (let index = 0; index < len; index++) {
      if (index === currentIndex) continue;
      const track = queue[index];
      if (!track) continue;
      if (fresh && playedIds.has(track.id)) continue;
      if (usable && isSkipped(track, opts)) continue;
      out.push(index);
    }
    return out;
  };

  let bucket = collect(true, true);
  if (bucket.length === 0) {
    // 本轮可用曲目已播完：重置已播（保留当前曲）重新开一轮；
    // 跳过词命中的曲目始终垫底，仅在整列都命中时才兜底播放
    playedIds.clear();
    if (currentId) playedIds.add(currentId);
    bucket = collect(true, true);
    if (bucket.length === 0) bucket = collect(true, false);
  }
  if (bucket.length === 0) bucket = collect(false, false);
  if (bucket.length === 0) return null;

  const index = bucket[Math.floor(Math.random() * bucket.length)];
  const track = queue[index];
  return track ? { id: track.id, index } : null;
};

/** 预定下一首是否仍有效（队列该项未被改动） */
const validateUpcoming = (queue: readonly Track[]): ShufflePick | null => {
  if (!upcoming) return null;
  const track = queue[upcoming.index];
  if (track && track.id === upcoming.id) return upcoming;
  upcoming = null;
  return null;
};

/**
 * 预览随机下一首（不消费、不改已播集合）
 * 已有预定且仍有效则沿用，保证预载/交叉过渡与真正切歌走同一个决定
 */
export const peekShuffleNext = (
  queue: readonly Track[],
  currentId: string | null | undefined,
  opts?: ShuffleSkipOptions,
): ShufflePick | null => {
  if (queue.length <= 1) return null;
  const valid = validateUpcoming(queue);
  if (valid) return valid;
  const pick = pickShuffle(queue, currentId, opts);
  upcoming = pick;
  return pick;
};

/**
 * 消费随机下一首：nextTrack 真正切歌时调用，把目标曲记为本轮已播
 */
export const consumeShuffleNext = (
  queue: readonly Track[],
  currentId: string | null | undefined,
  opts?: ShuffleSkipOptions,
): ShufflePick | null => {
  const pick = peekShuffleNext(queue, currentId, opts);
  if (!pick) return null;
  playedIds.add(pick.id);
  upcoming = null;
  return pick;
};
