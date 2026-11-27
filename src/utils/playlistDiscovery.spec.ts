import { describe, expect, it, vi } from "vitest";
import type { CoverItem } from "@/types/artist";
import {
  createSeededRandom,
  discoveryKey,
  DISCOVERY_MAX_PAGE,
  interleaveByPlatform,
  maxValidPage,
  pickThemes,
  retainOldItems,
  selectPlatformCandidates,
  type DiscoveryPlaylist,
} from "./playlistDiscovery";

const cover = (id: string, withCover = true, title = `标题-${id}`): CoverItem => ({
  id,
  title,
  ...(withCover ? { cover: `cover-${id}` } : {}),
  trackCount: 1,
});

describe("createSeededRandom", () => {
  it("同种子序列一致，不同种子序列不同", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    const seqC = Array.from({ length: 5 }, () => createSeededRandom(43)());
    expect(seqC).not.toEqual(seqA);
  });
});

describe("pickThemes", () => {
  it("同随机流抽取结果确定且不重复", () => {
    const pool = ["流行", "华语", "电子", "民谣", "摇滚"];
    const r1 = createSeededRandom(7);
    const r2 = createSeededRandom(7);
    const a = pickThemes(pool, 3, r1);
    const b = pickThemes(pool, 3, r2);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a.every((t) => pool.includes(t))).toBe(true);
  });

  it("请求数超出池大小时按池大小截断", () => {
    const picked = pickThemes(["a", "b"], 5, createSeededRandom(1));
    expect(picked).toHaveLength(2);
  });
});

describe("selectPlatformCandidates", () => {
  it("按配额截取，配额外进入溢出，键写入 seenKeys", () => {
    const seen = new Set<string>();
    const { picked, surplus } = selectPlatformCandidates(
      "qqmusic",
      [cover("1"), cover("2"), cover("3")],
      2,
      new Set(),
      seen,
    );
    expect(picked).toHaveLength(2);
    expect(surplus).toHaveLength(1);
    expect(picked.every((item) => item.source === "qqmusic")).toBe(true);
    expect(seen.has("qqmusic:3")).toBe(true);
  });

  it("洗牌带来真实随机：不同随机值选出不同子集", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => cover(`c${i}`));
    const runWith = (value: number) => {
      const spy = vi.spyOn(Math, "random").mockReturnValue(value);
      const seen = new Set<string>();
      const { picked } = selectPlatformCandidates("kugou", candidates, 5, new Set(), seen);
      spy.mockRestore();
      return picked.map((item) => item.id).sort();
    };
    const low = runWith(0.01);
    const high = runWith(0.99);
    expect(low).not.toEqual(high);
    expect(low).toHaveLength(5);
    expect(high).toHaveLength(5);
  });

  it("剔除空 id 与空标题候选", () => {
    const seen = new Set<string>();
    const { picked, surplus } = selectPlatformCandidates(
      "kuwo",
      [cover("ok"), cover("", true), cover("no-title", true, "  ")],
      5,
      new Set(),
      seen,
    );
    expect(picked.map((item) => item.id)).toEqual(["ok"]);
    expect(surplus).toHaveLength(0);
  });

  it("避开上一批且平台内同 id 去重，跨平台同 id 互不影响", () => {
    const exclude = new Set(["kuwo:1"]);
    const seen = new Set(exclude);
    const first = selectPlatformCandidates(
      "kuwo",
      [cover("2"), cover("2"), cover("1")],
      5,
      exclude,
      seen,
    );
    expect(first.picked.map((item) => item.id)).toEqual(["2"]);
    const otherSource = selectPlatformCandidates(
      "kugou",
      [cover("1"), cover("2")],
      5,
      new Set(),
      new Set(),
    );
    expect(otherSource.picked.map((item) => discoveryKey(item)).sort()).toEqual([
      "kugou:1",
      "kugou:2",
    ]);
  });

  it("有封面候选优先于无封面候选", () => {
    const seen = new Set<string>();
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { picked } = selectPlatformCandidates(
      "netease",
      [
        cover("n1", false),
        cover("n2", false),
        cover("n3", true),
        cover("n4", true),
        cover("n5", true),
      ],
      3,
      new Set(),
      seen,
    );
    spy.mockRestore();
    expect(picked.map((item) => Boolean(item.cover))).toEqual([true, true, true]);
    expect(picked.map((item) => item.id).sort()).toEqual(["n3", "n4", "n5"]);
  });
});

describe("interleaveByPlatform", () => {
  it("平台轮询混排且尊重上限", () => {
    const group = (platform: DiscoveryPlaylist["source"], ids: string[]): DiscoveryPlaylist[] =>
      ids.map((id) => ({ ...cover(id), source: platform }));
    const groups = [group("netease", ["n1", "n2"]), group("qqmusic", ["q1", "q2"])];
    const random = createSeededRandom(11);
    const mixed = interleaveByPlatform(groups, random, 10);
    expect(mixed).toHaveLength(4);
    expect(mixed[0]!.source).not.toBe(mixed[1]!.source);
    expect(mixed[2]!.source).toBe(mixed[0]!.source);
    expect(mixed[3]!.source).toBe(mixed[1]!.source);
    const capped = interleaveByPlatform(groups, createSeededRandom(11), 3);
    expect(capped).toHaveLength(3);
  });

  it("空组不阻塞其他平台", () => {
    const single: DiscoveryPlaylist[] = [{ ...cover("s1"), source: "kuwo" }];
    const mixed = interleaveByPlatform([[], single, []], createSeededRandom(3), 5);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.source).toBe("kuwo");
  });
});

describe("maxValidPage", () => {
  it("尊重 total 与页深上限", () => {
    expect(maxValidPage(150, 30, DISCOVERY_MAX_PAGE)).toBe(5);
    expect(maxValidPage(120, 30, 5)).toBe(4);
    expect(maxValidPage(300, 30, 5)).toBe(5);
    expect(maxValidPage(undefined, 30, 5)).toBe(5);
    expect(maxValidPage(0, 30, 5)).toBe(null);
    expect(maxValidPage(-1, 30, 5)).toBe(null);
  });
});

describe("retainOldItems", () => {
  const previous = (ids: string[]): DiscoveryPlaylist[] =>
    ids.map((id) => ({ ...cover(id), source: "netease" }));

  it("跳过与新批重复的旧项并保持原顺序", () => {
    const kept = retainOldItems(previous(["a", "b", "c"]), new Set(["netease:b"]), 10);
    expect(kept.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("受 limit 封顶并剔除旧列表内部重复", () => {
    const kept = retainOldItems(previous(["a", "a", "b", "c", "d"]), new Set(), 2);
    expect(kept.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
