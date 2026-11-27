// @vitest-environment node
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PLATFORMS } from "@shared/types/platform";
import type { PlaylistFavoriteInput } from "@shared/types/playlist";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import {
  addPlaylistFavorite,
  listPlaylistFavorites,
  removePlaylistFavorite,
} from "./playlistFavorites";

const FAVORITES_TABLE = `
  CREATE TABLE playlist_favorites (
    source TEXT NOT NULL,
    origin_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cover TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source, origin_id)
  );
`;

/** 构造收藏输入 */
const makeInput = (overrides?: Partial<PlaylistFavoriteInput>): PlaylistFavoriteInput => ({
  source: "netease",
  originId: "123",
  title: "我的收藏",
  ...overrides,
});

/** 把全部收藏行改成按 originId 数值递增的固定收藏时间 */
const pinCreatedAt = (base: number): void => {
  state.db?.exec(`UPDATE playlist_favorites SET created_at = ${base} + CAST(origin_id AS INTEGER)`);
};

describe("在线歌单收藏", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(FAVORITES_TABLE);
  });
  afterEach(() => {
    // 磁盘库用例已自行关闭，避免重复 close 报错
    if (state.db?.open) state.db.close();
  });

  it("五个平台均可收藏并列出，按收藏时间倒序", () => {
    [...ALL_PLATFORMS].reverse().forEach((source, index) => {
      addPlaylistFavorite(makeInput({ source, originId: `${index}` }));
    });
    pinCreatedAt(1000);
    const list = listPlaylistFavorites();
    expect(list.map((item) => item.source)).toEqual(ALL_PLATFORMS);
    expect(list.every((item) => typeof item.createTime === "number")).toBe(true);
    expect(list[0]).toMatchObject({ source: "netease", originId: "4", createTime: 1004 });
  });

  it("跨源同 ID 互不影响，取消收藏仅命中该复合键", () => {
    addPlaylistFavorite(makeInput({ source: "netease", originId: "123", title: "网易歌单" }));
    addPlaylistFavorite(makeInput({ source: "kuwo", originId: "123", title: "酷我歌单" }));
    expect(listPlaylistFavorites()).toHaveLength(2);
    removePlaylistFavorite("netease", "123");
    const rest = listPlaylistFavorites();
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ source: "kuwo", originId: "123", title: "酷我歌单" });
  });

  it("重复收藏不新增行，保留原收藏时间仅刷新元数据", () => {
    addPlaylistFavorite(makeInput({ cover: "https://example.com/old.jpg" }));
    state.db!.exec("UPDATE playlist_favorites SET created_at = 1000");
    const updated = addPlaylistFavorite(
      makeInput({ title: "改名后的收藏", cover: "https://example.com/new.jpg" }),
    );
    expect(updated).toEqual({
      source: "netease",
      originId: "123",
      title: "改名后的收藏",
      cover: "https://example.com/new.jpg",
      createTime: 1000,
    });
    const count = state.db!.prepare("SELECT COUNT(*) AS n FROM playlist_favorites").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it("同一收藏时间按复合键确定性排序", () => {
    addPlaylistFavorite(makeInput({ source: "qqmusic", originId: "b" }));
    addPlaylistFavorite(makeInput({ source: "migu", originId: "a" }));
    addPlaylistFavorite(makeInput({ source: "qqmusic", originId: "a" }));
    state.db!.exec("UPDATE playlist_favorites SET created_at = 5000");
    expect(listPlaylistFavorites().map((item) => `${item.source}:${item.originId}`)).toEqual([
      "migu:a",
      "qqmusic:a",
      "qqmusic:b",
    ]);
  });

  it("重开磁盘数据库后收藏仍在", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "splayer-fav-"));
    const dbPath = path.join(dir, "library.db");
    try {
      state.db = new DatabaseSync(dbPath);
      state.db.exec(FAVORITES_TABLE);
      addPlaylistFavorite(makeInput({ source: "kugou", originId: "kg1", title: "酷狗歌单" }));
      state.db.close();
      state.db = new DatabaseSync(dbPath);
      const list = listPlaylistFavorites();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        source: "kugou",
        originId: "kg1",
        title: "酷狗歌单",
        cover: undefined,
      });
    } finally {
      state.db?.close();
      // 置空避免 afterEach 重复 close 已关闭的磁盘库
      state.db = null;
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("收藏输入校验", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(FAVORITES_TABLE);
  });
  afterEach(() => state.db?.close());

  /**
   * 断言非法输入被拒绝：抛错、错误信息不携带原始值、不落库
   * @param bad - 非法输入
   * @param secret - 不应出现在错误信息里的原始值片段
   */
  const expectReject = (bad: PlaylistFavoriteInput, secret?: string): void => {
    const before = listPlaylistFavorites().length;
    let message = "";
    try {
      addPlaylistFavorite(bad);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    if (secret) expect(message).not.toContain(secret);
    expect(listPlaylistFavorites()).toHaveLength(before);
  };

  it("非法来源平台拒绝，含非在线类型", () => {
    for (const source of ["local", "cloud", "streaming", "plugin", "", "netease2", 123, null]) {
      expectReject(makeInput({ source: source as never }));
    }
    expect(() => addPlaylistFavorite(makeInput({ source: "netease" }))).not.toThrow();
  });

  it("空或超长歌单 ID 拒绝，边界长度可用", () => {
    expectReject(makeInput({ originId: "" }));
    expectReject(makeInput({ originId: "   " }));
    expectReject(makeInput({ originId: "x".repeat(129) }), "x".repeat(129));
    expect(() => addPlaylistFavorite(makeInput({ originId: "x".repeat(128) }))).not.toThrow();
  });

  it("空或超长标题拒绝，边界长度可用", () => {
    expectReject(makeInput({ title: "" }));
    expectReject(makeInput({ title: " \t" }));
    expectReject(makeInput({ title: "名".repeat(201) }), "名".repeat(201));
    expect(() => addPlaylistFavorite(makeInput({ title: "名".repeat(200) }))).not.toThrow();
  });

  it("封面仅接受 http(s)，空串与纯空白视为未提供", () => {
    // 合法：undefined / 空串 / 纯空白 / http / https / 前后空白
    expect(addPlaylistFavorite(makeInput())).toMatchObject({ cover: undefined });
    expect(addPlaylistFavorite(makeInput({ originId: "1", cover: "" }))).toMatchObject({
      cover: undefined,
    });
    expect(addPlaylistFavorite(makeInput({ originId: "2", cover: "   " }))).toMatchObject({
      cover: undefined,
    });
    expect(
      addPlaylistFavorite(makeInput({ originId: "3", cover: "http://a.com/1.jpg" })),
    ).toMatchObject({ cover: "http://a.com/1.jpg" });
    expect(
      addPlaylistFavorite(makeInput({ originId: "4", cover: "  https://a.com/2.jpg  " })),
    ).toMatchObject({ cover: "https://a.com/2.jpg" });
    // 非法协议 / 非法 URL / 超长 / 非字符串
    expectReject(makeInput({ originId: "9", cover: "ftp://a.com/x" }), "ftp://a.com/x");
    expectReject(makeInput({ originId: "9", cover: "javascript:alert(1)" }), "alert");
    expectReject(makeInput({ originId: "9", cover: "notaurl" }), "notaurl");
    expectReject(
      makeInput({ originId: "9", cover: `https://a.com/${"x".repeat(2048)}` }),
      "x".repeat(2048),
    );
    expectReject(makeInput({ originId: "9", cover: 123 as never }), "123");
  });
});
