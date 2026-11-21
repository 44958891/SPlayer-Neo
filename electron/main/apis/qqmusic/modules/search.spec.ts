// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: "12345",
  request: vi.fn(),
}));

vi.mock("../core/request", () => ({
  getQQMusicUin: () => state.account,
  qmRequest: state.request,
  QMRequestError: class extends Error {
    constructor(
      public outerCode: number,
      public innerCode: number,
    ) {
      super(`QM API 错误: outer=${outerCode} inner=${innerCode}`);
    }
  },
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));

beforeEach(() => {
  state.account = "12345";
  state.request.mockReset();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 用最小合法网页回包验证格式适配 */
const json = (data: unknown): Response => new Response(JSON.stringify(data));

/** 加载独立搜索模块以隔离冷却状态 */
const load = async () => {
  const search = (await import("./search")).default;
  const { QMRequestError } = await import("../core/request");
  return { search, QMRequestError };
};

describe("QQ 搜索主备恢复", () => {
  it("主搜索使用统一 Mobile 参数，成功时不调用网页通道", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    state.request.mockResolvedValue({
      body: { item_song: [{ id: 1, mid: "song-mid", title: "许嵩", interval: 120 }] },
      meta: { sum: 12 },
    });
    const { search } = await load();
    const result = await search({ keywords: "许嵩", page: 2, limit: 10 });
    expect(state.request).toHaveBeenCalledWith(
      "music.search.SearchCgiService",
      "DoSearchForQQMusicMobile",
      expect.objectContaining({ query: "许嵩", page_num: 2, num_per_page: 10 }),
      { auth: true },
    );
    expect(result).toMatchObject({
      code: 200,
      total: 12,
      songs: [{ id: "1", mid: "song-mid", name: "许嵩", duration: 120000 }],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("2001 后使用 QQ 网页结果并短暂跳过失败主通道，账号切换后重新验证", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T00:00:00Z"));
    const { search, QMRequestError } = await load();
    state.request.mockRejectedValue(new QMRequestError(0, 2001));
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        json({
          code: 0,
          data: {
            song: {
              totalnum: 9,
              list: [
                {
                  songid: 42,
                  songmid: "web-mid",
                  songname: "灰色头像",
                  interval: 289,
                  albummid: "album",
                  albumname: "寻雾启示",
                  singer: [{ name: "许嵩", mid: "artist" }],
                  size128: 12,
                  size320: 34,
                  sizeflac: 56,
                  strMediaMid: "media",
                  pay: { payplay: 1, payalbum: 0 },
                },
              ],
            },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await search({ keywords: "许嵩", page: 2, limit: 3 });
    expect(result).toMatchObject({
      code: 200,
      total: 9,
      songs: [
        {
          id: "42",
          mid: "web-mid",
          name: "灰色头像",
          artist: "许嵩",
          mediaMid: "media",
          duration: 289000,
          sizeFlac: 56,
        },
      ],
    });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.hostname).toBe("c.y.qq.com");
    expect(url.searchParams.get("p")).toBe("2");
    expect(url.searchParams.get("n")).toBe("3");
    await search({ keywords: "许嵩", page: 3, limit: 3 });
    expect(state.request).toHaveBeenCalledTimes(1);
    state.account = "67890";
    await search({ keywords: "许嵩" });
    expect(state.request).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-11-21T00:01:01Z"));
    await search({ keywords: "许嵩" });
    expect(state.request).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      8,
      "album",
      "albums",
      {
        albumID: 5,
        albumMID: "album-mid",
        albumName: "自定义",
        albumPic: "http://y.gtimg.cn/a.jpg",
        singerMID: "singer-mid",
        singerName: "许嵩",
        song_count: 9,
      },
      {
        id: "album-mid",
        name: "自定义",
        artist: "许嵩",
        artistMid: "singer-mid",
        trackCount: 9,
        cover: "https://y.gtimg.cn/a.jpg",
      },
    ],
    [
      9,
      "singer",
      "artists",
      {
        singerID: 7,
        singerMID: "artist-mid",
        singerName: "许嵩",
        singerPic: "http://y.gtimg.cn/b.jpg",
        albumNum: 5,
        songNum: 100,
      },
      { id: "artist-mid", name: "许嵩", albumCount: 5, songCount: 100 },
    ],
    [
      2,
      "playlist",
      "playlists",
      {
        dissid: "list-id",
        dissname: "<em>许嵩</em>精选",
        imgurl: "http://y.gtimg.cn/c.jpg",
        creator: { name: "听众" },
        song_count: 20,
        listennum: 1000,
      },
      { id: "list-id", name: "许嵩精选", creator: "听众", trackCount: 20, playCount: 1000 },
    ],
  ] as const)(
    "分类 %s 备用结果保留真实 QQ 标识与分页",
    async (type, groupName, resultKey, item, expected) => {
      state.request.mockRejectedValue(new Error("network down"));
      const group = { totalnum: 99, sum: 99, list: [item] };
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          json({ code: 0, data: groupName === "playlist" ? group : { [groupName]: group } }),
        );
      vi.stubGlobal("fetch", fetcher);
      const { search } = await load();
      const result = await search({ keywords: "许嵩", type, page: 2, limit: 10 });
      expect(result).toMatchObject({ code: 200, total: 99, [resultKey]: [expected] });
      const url = new URL(fetcher.mock.calls[0][0]);
      if (type === 2) {
        expect(url.searchParams.get("page_no")).toBe("1");
        expect(url.pathname).toContain("client_music_search_songlist");
      } else expect(url.searchParams.get("t")).toBe(String(type));
    },
  );

  it("合法空结果保持成功，缺失结构不会伪装为空", async () => {
    const { search } = await load();
    const original = new Error("primary unavailable");
    state.request.mockRejectedValue(original);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ code: 0, data: { song: { totalnum: 0, list: [] } } }))
      .mockResolvedValueOnce(json({ code: 0, data: {} }));
    vi.stubGlobal("fetch", fetcher);
    expect(await search({ keywords: "无结果" })).toEqual({ code: 200, total: 0, songs: [] });
    await expect(search({ keywords: "坏结果" })).rejects.toBe(original);
  });

  it("主结果结构损坏时也尝试备用；全部失败时保留失败", async () => {
    state.request.mockResolvedValue({ body: {}, meta: { sum: 100 } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ code: 500, data: {} })));
    const { search } = await load();
    await expect(search({ keywords: "许嵩" })).rejects.toThrow("invalid result structure");
  });
});
