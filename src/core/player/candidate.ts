import type { Track } from "@shared/types/player";
import type { ShuffleMode } from "@/stores/status";
import { shouldSkipKeywordTrack } from "@/utils/preset/skipKeywords";

/** 候选歌曲计算上下文 */
export interface CandidateContext {
  playIndex: number;
  queue: readonly Track[];
  fmMode: boolean;
  skipKeywordsSongs: boolean;
  skipTrackKeywords: readonly string[];
  shuffleMode: ShuffleMode;
  /** 随机模式下已预定好的下一首索引（播放列表顺序不动，随机只决定跳转目标） */
  shuffleNextIndex?: number | null;
}

/** 候选查找结果 */
export interface CandidateResult {
  track: Track;
  index: number;
}

/**
 * 计算下一首预载候选 Track
 * @param ctx - 计算上下文
 * @returns 候选 Track 及位置，不存在则返回 null
 */
export const getNextTrackCandidate = (ctx: CandidateContext): CandidateResult | null => {
  if (ctx.fmMode) return null;
  const len = ctx.queue.length;
  if (len <= 1) return null;
  // 随机模式：只认预定的下一首（与真正切歌共用同一决定），没有则不缓存
  if (ctx.shuffleMode === "on") {
    const index = ctx.shuffleNextIndex;
    if (index == null || index < 0 || index >= len || index === ctx.playIndex) return null;
    const track = ctx.queue[index];
    return track ? { track, index } : null;
  }

  let candidateIndex = (ctx.playIndex + 1) % len;
  let count = 0;

  while (count < len) {
    const track = ctx.queue[candidateIndex];
    if (track) {
      if (!ctx.skipKeywordsSongs || !shouldSkipKeywordTrack(track, ctx.skipTrackKeywords)) {
        return { track, index: candidateIndex };
      }
    }
    candidateIndex = (candidateIndex + 1) % len;
    count++;
  }

  return null;
};
