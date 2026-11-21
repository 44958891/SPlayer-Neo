import { beforeEach, describe, expect, it, vi } from "vitest";
import { albums, artists, playlists, songs } from "./qqmusic";
import { qqmusic } from "@/apis/qqmusic";

vi.mock("@/apis/qqmusic", () => ({
  qqmusic: { search: vi.fn() },
}));

vi.mock("@/utils/format/qqmusic", () => ({
  qqSongToTrack: (song: { id: string }) => ({ id: song.id, kind: "track" }),
  qqAlbumToCoverItem: (album: { id: string }) => ({ id: album.id, kind: "album" }),
  qqArtistToCoverItem: (artist: { id: string }) => ({ id: artist.id, kind: "artist" }),
  qqPlaylistToCoverItem: (playlist: { id: string }) => ({ id: playlist.id, kind: "playlist" }),
}));

const searchMock = vi.mocked(qqmusic.search);

const recovery = { kind: "cache" as const, cachedAt: 1700000000000 };

beforeEach(() => {
  searchMock.mockReset();
});

describe("QM 搜索适配器的缓存恢复元数据传播", () => {
  it.each([
    {
      name: "songs",
      fn: songs,
      itemKey: "songs",
      item: { id: "s1" },
      type: 0,
      kind: "track",
    },
    {
      name: "albums",
      fn: albums,
      itemKey: "albums",
      item: { id: "a1" },
      type: 8,
      kind: "album",
    },
    {
      name: "artists",
      fn: artists,
      itemKey: "artists",
      item: { id: "r1" },
      type: 9,
      kind: "artist",
    },
    {
      name: "playlists",
      fn: playlists,
      itemKey: "playlists",
      item: { id: "p1" },
      type: 2,
      kind: "playlist",
    },
  ])("$name 命中缓存恢复时向结果传播 searchRecovery", async ({ fn, itemKey, item, type, kind }) => {
    searchMock.mockResolvedValue({
      total: 150,
      [itemKey]: [item],
      searchRecovery: recovery,
    });
    const res = await fn("周杰伦", 50, 50);
    expect(res.searchRecovery).toEqual(recovery);
    expect(res.items).toEqual([{ id: item.id, kind }]);
    expect(res.total).toBe(150);
    expect(res.hasMore).toBe(true);
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ keywords: "周杰伦", type }));
  });

  it.each([
    { name: "songs", fn: songs, itemKey: "songs" },
    { name: "albums", fn: albums, itemKey: "albums" },
    { name: "artists", fn: artists, itemKey: "artists" },
    { name: "playlists", fn: playlists, itemKey: "playlists" },
  ])("$name 未命中恢复时不添加 searchRecovery 字段", async ({ fn, itemKey }) => {
    searchMock.mockResolvedValue({ total: 1, [itemKey]: [{ id: "x" }] });
    const res = await fn("kw", 0, 50);
    expect(res.searchRecovery).toBeUndefined();
    expect(res.hasMore).toBe(false);
  });

  it("歌单稀疏页使用请求页宽推进，空页停止继续加载", async () => {
    searchMock.mockResolvedValueOnce({
      total: 200,
      playlists: Array.from({ length: 44 }, (_, i) => ({ id: String(i) })),
    });
    const first = await playlists("许嵩", 0, 50);
    expect(first.nextOffset).toBe(50);
    expect(first.hasMore).toBe(true);
    searchMock.mockResolvedValueOnce({ total: 200, playlists: [] });
    const empty = await playlists("许嵩", first.nextOffset!, 50);
    expect(searchMock).toHaveBeenLastCalledWith({ keywords: "许嵩", type: 2, page: 2, limit: 50 });
    expect(empty.nextOffset).toBe(100);
    expect(empty.hasMore).toBe(false);
  });

  it("artists 超过 30 上限时按 requestLimit 换算分页", async () => {
    searchMock.mockResolvedValue({ total: 100, artists: [{ id: "r1" }], searchRecovery: recovery });
    await artists("kw", 60, 50);
    expect(searchMock).toHaveBeenCalledWith({
      keywords: "kw",
      type: 9,
      page: 3,
      limit: 30,
    });
  });
});
