import type { Track } from "@shared/types/player";
import { describe, expect, it } from "vitest";
import {
  consumeShuffleNext,
  invalidateShuffleIfUpcoming,
  markShufflePlayed,
  peekShuffleNext,
  popShuffleHistory,
  pushShuffleHistory,
  resetShuffleRound,
} from "./shuffle";

const track = (id: string, title = id): Track => ({
  id,
  source: "local",
  title,
  artists: [],
  duration: 1_000,
});

const QUEUE: readonly Track[] = [track("a"), track("b"), track("c"), track("d")];

const SKIP = { skipKeywordsSongs: true, skipTrackKeywords: ["DJ"] };

describe("shuffle 状态机", () => {
  it("peek 稳定、consume 消费后换下一首，且不指向当前曲", () => {
    resetShuffleRound("a");

    const first = peekShuffleNext(QUEUE, "a", SKIP);
    expect(first).not.toBeNull();
    expect(first?.id).not.toBe("a");
    expect(peekShuffleNext(QUEUE, "a", SKIP)).toEqual(first);

    const consumed = consumeShuffleNext(QUEUE, "a", SKIP);
    expect(consumed).toEqual(first);

    // 消费后已记为已播，下一次不会立即回到同一首
    const second = peekShuffleNext(QUEUE, "a", SKIP);
    expect(second?.id).not.toBe(first?.id);
  });

  it("一轮内不重复，全部播完后自动开新一轮", () => {
    resetShuffleRound("a");
    const played = new Set<string>(["a"]);

    for (let i = 0; i < 12; i++) {
      const pick = consumeShuffleNext(QUEUE, "a", SKIP);
      expect(pick).not.toBeNull();
      if (played.size < QUEUE.length) {
        expect(played.has(pick!.id)).toBe(false);
      }
      played.add(pick!.id);
      if (played.size === QUEUE.length) played.clear();
      played.add("a");
    }

    // 12 次消费只在 4 首歌内轮转，从未越界
    expect(played.size).toBeLessThanOrEqual(QUEUE.length);
  });

  it("命中跳过词的曲目不会被选中", () => {
    resetShuffleRound("a");
    const queue = [track("a"), track("b"), track("c-dj"), track("d")];
    const picks = new Set<string>();

    for (let i = 0; i < 20; i++) {
      const pick = peekShuffleNext(queue, "a", SKIP);
      expect(pick).not.toBeNull();
      picks.add(pick!.id);
      // 模拟前进消费
      markShufflePlayed(pick!.id);
      invalidateShuffleIfUpcoming(pick!.id);
    }

    expect(picks.has("c-dj")).toBe(false);
    expect(picks.has("a")).toBe(false);
  });

  it("后退历史按 LIFO 回退并过滤越界索引", () => {
    pushShuffleHistory(99);
    pushShuffleHistory(2);
    pushShuffleHistory(3);

    expect(popShuffleHistory(QUEUE.length)).toBe(3);
    expect(popShuffleHistory(QUEUE.length)).toBe(2);
    expect(popShuffleHistory(QUEUE.length)).toBeNull();
  });
});
