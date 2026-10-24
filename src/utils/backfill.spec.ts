import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import type { BackfillTagInfo } from "./backfill";
import { buildBackfillEdit, hasAnyNeed, needsKey, pickBackfillNeeds } from "./backfill";

const track = (over: Partial<Track> = {}): Track => ({
  id: "1",
  source: "local",
  title: "晴天",
  path: "C:\\Music\\晴天 - 周杰伦.flac",
  artists: [{ id: "a", name: "周杰伦" }],
  duration: 269000,
  ...over,
});

const tags = (over: Partial<BackfillTagInfo> = {}): BackfillTagInfo => ({
  hasCover: false,
  lyrics: "",
  ...over,
});

describe("pickBackfillNeeds 缺什么判定", () => {
  it("无封面无歌词 → 两项都缺", () => {
    expect(pickBackfillNeeds(tags())).toEqual({ cover: true, lyric: true });
  });

  it("有封面无歌词 → 只缺歌词", () => {
    expect(pickBackfillNeeds(tags({ hasCover: true }))).toEqual({ cover: false, lyric: true });
  });

  it("有歌词无封面 → 只缺封面", () => {
    expect(pickBackfillNeeds(tags({ lyrics: "[00:01]词" }))).toEqual({
      cover: true,
      lyric: false,
    });
  });

  it("两项都有 → 不缺", () => {
    expect(pickBackfillNeeds(tags({ hasCover: true, lyrics: "[00:01]词" }))).toEqual({
      cover: false,
      lyric: false,
    });
  });

  it("歌词只有空白 → 视为缺", () => {
    expect(pickBackfillNeeds(tags({ lyrics: "   \n  " })).lyric).toBe(true);
  });

  it("读取失败（null）→ 不判缺（避免误写）", () => {
    expect(pickBackfillNeeds(null)).toEqual({ cover: false, lyric: false });
    expect(pickBackfillNeeds(undefined)).toEqual({ cover: false, lyric: false });
  });
});

describe("hasAnyNeed / needsKey", () => {
  it("任一缺失即为需补", () => {
    expect(hasAnyNeed({ cover: true, lyric: false })).toBe(true);
    expect(hasAnyNeed({ cover: false, lyric: true })).toBe(true);
    expect(hasAnyNeed({ cover: false, lyric: false })).toBe(false);
  });
  it("短标识", () => {
    expect(needsKey({ cover: true, lyric: true })).toBe("cl");
    expect(needsKey({ cover: false, lyric: true })).toBe("l");
    expect(needsKey({ cover: false, lyric: false })).toBe("");
  });
});

describe("buildBackfillEdit 组装写入请求", () => {
  it("只补缺失字段：已有封面时不再写封面", () => {
    const edit = buildBackfillEdit(
      track(),
      { cover: false, lyric: true },
      { coverUrl: "https://cdn.example.com/c.jpg", lyricText: "[00:01]词" },
    );
    expect(edit).toEqual({ path: "C:\\Music\\晴天 - 周杰伦.flac", lyrics: "[00:01]词" });
    expect(edit?.coverUrl).toBeUndefined();
  });

  it("只补缺失字段：已有歌词时不再写歌词", () => {
    const edit = buildBackfillEdit(
      track(),
      { cover: true, lyric: false },
      { coverUrl: "https://cdn.example.com/c.jpg", lyricText: "[00:01]词" },
    );
    expect(edit).toEqual({
      path: "C:\\Music\\晴天 - 周杰伦.flac",
      coverUrl: "https://cdn.example.com/c.jpg",
    });
    expect(edit?.lyrics).toBeUndefined();
  });

  it("两项都缺且都拿到 → 两项都写", () => {
    const edit = buildBackfillEdit(
      track(),
      { cover: true, lyric: true },
      { coverUrl: "https://cdn.example.com/c.jpg", lyricText: "[00:01]词" },
    );
    expect(edit?.coverUrl).toBe("https://cdn.example.com/c.jpg");
    expect(edit?.lyrics).toBe("[00:01]词");
  });

  it("没拿到任何内容 → null（不产生空写入）", () => {
    expect(buildBackfillEdit(track(), { cover: true, lyric: true }, {})).toBeNull();
  });

  it("非 http(s) 封面地址被丢弃", () => {
    const edit = buildBackfillEdit(
      track(),
      { cover: true, lyric: false },
      { coverUrl: "ftp://x/c.jpg" },
    );
    expect(edit).toBeNull();
  });

  it("空白歌词被丢弃", () => {
    const edit = buildBackfillEdit(track(), { cover: false, lyric: true }, { lyricText: "  \n " });
    expect(edit).toBeNull();
  });

  it("无 path 返回 null", () => {
    expect(
      buildBackfillEdit(
        track({ path: undefined }),
        { cover: true, lyric: true },
        {
          coverUrl: "https://x/c.jpg",
          lyricText: "词",
        },
      ),
    ).toBeNull();
  });
});
