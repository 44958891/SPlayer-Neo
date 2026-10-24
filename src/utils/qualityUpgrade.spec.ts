import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import {
  findUpgradeMatch,
  hasVersionWord,
  pathDirName,
  pathExt,
  rankUpgradeCandidates,
} from "./qualityUpgrade";

const track = (over: Partial<Track>): Track => ({
  id: "1",
  source: "netease",
  title: "老歌",
  artists: [{ id: "a1", name: "周杰伦" }],
  duration: 200000,
  ...over,
});

describe("findUpgradeMatch", () => {
  it("标题一致 + 歌手重合 + 时长接近 → 匹配", () => {
    const local = track({});
    const hit = findUpgradeMatch(local, [
      track({ id: "x", title: "老歌 Live" }),
      track({ id: "y", duration: 204000 }),
    ]);
    expect(hit?.id).toBe("y");
  });

  it("忽略大小写与空白差异", () => {
    const local = track({ title: "Shape of You", artists: [{ id: "a", name: "Ed Sheeran" }] });
    const hit = findUpgradeMatch(local, [
      track({ id: "z", title: "shape  of you", artists: [{ id: "a", name: "ed sheeran" }] }),
    ]);
    expect(hit?.id).toBe("z");
  });

  it("歌手不重合（翻唱/同名曲）→ 不匹配", () => {
    const local = track({});
    expect(
      findUpgradeMatch(local, [track({ id: "x", artists: [{ id: "a", name: "翻唱歌手" }] })]),
    ).toBeUndefined();
  });

  it("时长相差超过 5s → 不匹配", () => {
    const local = track({});
    expect(findUpgradeMatch(local, [track({ id: "x", duration: 206000 })])).toBeUndefined();
  });

  it("任一方缺时长 → 放行", () => {
    const local = track({ duration: 0 });
    expect(findUpgradeMatch(local, [track({ id: "x" })])?.id).toBe("x");
  });

  it("本地原版 + 候选 Live 版（标题带版本词）→ 直接排除", () => {
    const local = track({ title: "倒影", duration: 234000 });
    expect(
      findUpgradeMatch(local, [track({ id: "live", title: "倒影 (Live)", duration: 202000 })]),
    ).toBeUndefined();
  });

  it("本地原版 + 候选 Cover 版 → 排除", () => {
    const local = track({ title: "明明就", duration: 260000 });
    expect(
      findUpgradeMatch(local, [track({ id: "cover", title: "明明就(Cover)", duration: 257000 })]),
    ).toBeUndefined();
  });

  it("本地原版 + 候选伴奏版 → 排除", () => {
    const local = track({ title: "晴天", duration: 269000 });
    expect(
      findUpgradeMatch(local, [track({ id: "inst", title: "晴天（伴奏）", duration: 269000 })]),
    ).toBeUndefined();
  });

  it("本地本身就是 Live 版 → 允许匹配 Live 候选", () => {
    const local = track({ title: "倒影 (Live)", duration: 202000 });
    const hit = findUpgradeMatch(local, [
      track({ id: "live2", title: "倒影 (Live)", duration: 202500 }),
    ]);
    expect(hit?.id).toBe("live2");
  });

  it("多候选按分层得分择优：标题精确全匹配优先于去括号匹配", () => {
    const local = track({ title: "晴天", duration: 269000 });
    const ranked = rankUpgradeCandidates(local, [
      track({ id: "bracket", title: "晴天（新版）", duration: 269100 }),
      track({ id: "exact", title: "晴天", duration: 269500 }),
    ]);
    expect(ranked[0].online.id).toBe("exact");
    expect(ranked[0].score).toBe(3);
  });

  it("同分按时长差排序", () => {
    const local = track({ title: "晴天", duration: 269000 });
    const ranked = rankUpgradeCandidates(local, [
      track({ id: "far", title: "晴天", duration: 273000 }),
      track({ id: "near", title: "晴天", duration: 270000 }),
    ]);
    expect(ranked[0].online.id).toBe("near");
  });
});

describe("hasVersionWord 版本词识别", () => {
  it("识别常见版本词", () => {
    expect(hasVersionWord("倒影 (Live)")).toBe(true);
    expect(hasVersionWord("明明就(Cover)")).toBe(true);
    expect(hasVersionWord("非酋(Remix)")).toBe(true);
    expect(hasVersionWord("晴天（伴奏）")).toBe(true);
    expect(hasVersionWord("星晴 (live)")).toBe(true);
    expect(hasVersionWord("阿刁 (Live版)")).toBe(true);
  });
  it("原版标题不误判", () => {
    expect(hasVersionWord("倒影")).toBe(false);
    expect(hasVersionWord("晴天")).toBe(false);
    expect(hasVersionWord("Living for Love")).toBe(false);
  });
});

describe("pathDirName / pathExt", () => {
  it("Windows 反斜杠取目录", () => {
    expect(pathDirName("D:\\Music\\周杰伦\\老歌.mp3")).toBe("D:\\Music\\周杰伦");
  });
  it("正斜杠取目录", () => {
    expect(pathDirName("D:/Music/老歌.flac")).toBe("D:/Music");
  });
  it("根目录原样返回", () => {
    expect(pathDirName("C:\\a.mp3")).toBe("C:\\");
  });
  it("取小写扩展名", () => {
    expect(pathExt("D:\\Music\\老歌.FLAC")).toBe(".flac");
  });
});
