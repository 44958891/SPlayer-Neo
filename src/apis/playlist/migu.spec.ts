import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMiguPlaylist } from "./migu";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/apis/migu", () => ({
  migu: new Proxy({}, { get: (_target, name) => (params: unknown) => mocks.call(name, params) }),
}));

/** 构建咪咕歌单分页中的真实字段形状 */
const song = (id: number) => ({
  songId: String(id),
  songName: `Song ${id}`,
  copyrightId: `copyright-${id}`,
  duration: 200,
  singerList: [{ id: "singer", name: "Artist" }],
});

beforeEach(() => vi.clearAllMocks());

describe("咪咕歌单详情完整分页", () => {
  it("按50+50+3加载全部103首并保留播放所需copyrightId与毫秒时长", async () => {
    mocks.call.mockImplementation(async (name: string, params: { page?: number }) => {
      if (name === "playlist")
        return {
          code: "000000",
          data: { musicListId: "real-id", title: "Playlist", musicNum: 103 },
        };
      const start = ((params.page ?? 1) - 1) * 50;
      const count = Math.min(50, 103 - start);
      return {
        code: "000000",
        data: {
          totalCount: 103,
          songList: Array.from({ length: count }, (_, index) => song(start + index)),
        },
      };
    });
    const result = await fetchMiguPlaylist("real-id", "fallback");
    expect(result.tracks).toHaveLength(103);
    expect(
      result.tracks.every(
        (track) => track.source === "migu" && track.extId && track.duration === 200000,
      ),
    ).toBe(true);
    expect(new Set(result.tracks.map((track) => track.id)).size).toBe(103);
    expect(result.playlist.trackCount).toBe(103);
    expect(
      mocks.call.mock.calls
        .filter(([name]) => name === "playlist_songs")
        .map(([, params]) => params.page),
    ).toEqual([1, 2, 3]);
  });

  it("重复整页时停止，不重复追加曲目或无限请求", async () => {
    mocks.call.mockImplementation(async (name: string) =>
      name === "playlist"
        ? { code: "000000", data: { title: "Playlist" } }
        : {
            code: "000000",
            data: {
              totalCount: 100,
              songList: Array.from({ length: 50 }, (_, index) => song(index)),
            },
          },
    );
    const result = await fetchMiguPlaylist("real-id", "fallback");
    expect(result.tracks).toHaveLength(50);
    expect(mocks.call.mock.calls.filter(([name]) => name === "playlist_songs")).toHaveLength(2);
  });

  it("曲目分页业务错误明确失败，不把未完成列表当作完整歌单", async () => {
    mocks.call.mockImplementation(async (name: string) =>
      name === "playlist" ? { code: "000000", data: { title: "Playlist" } } : { code: "403" },
    );
    await expect(fetchMiguPlaylist("real-id", "fallback")).rejects.toThrow("403");
  });
});
