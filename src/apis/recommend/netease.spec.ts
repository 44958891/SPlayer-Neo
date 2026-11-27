import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDiscoveryPlaylistPool } from "./netease";
import { netease } from "@/apis/netease";

vi.mock("@/apis/netease", () => ({
  netease: { personalized: vi.fn() },
}));

vi.mock("@/utils/format/netease", () => ({
  songsToTracks: vi.fn(),
  withPicSize: (url?: string) => url,
  toPlaylist: vi.fn(),
  toArtist: vi.fn(),
}));

vi.mock("@/utils/format/coverItem", () => ({
  playlistToCoverItem: vi.fn(),
  artistToCoverItem: vi.fn(),
}));

const personalizedMock = vi.mocked(netease.personalized);

beforeEach(() => {
  personalizedMock.mockReset();
});

describe("fetchDiscoveryPlaylistPool", () => {
  it("默认拉取 60 条候选并映射为封面卡片", async () => {
    personalizedMock.mockResolvedValue({
      result: [
        {
          id: 1,
          name: "华语流行精选",
          picUrl: "http://p/1",
          copywriter: "编辑推荐",
          trackCount: 20,
        },
        { id: 2, name: "深夜睡眠", picUrl: "http://p/2", trackCount: 30 },
      ],
    } as never);
    const pool = await fetchDiscoveryPlaylistPool();
    expect(personalizedMock).toHaveBeenCalledWith({ limit: 60 });
    expect(pool).toEqual([
      { id: "1", title: "华语流行精选", cover: "http://p/1", subtitle: "编辑推荐", trackCount: 20 },
      { id: "2", title: "深夜睡眠", cover: "http://p/2", subtitle: undefined, trackCount: 30 },
    ]);
  });

  it("支持自定义拉取数量", async () => {
    personalizedMock.mockResolvedValue({ result: [] } as never);
    await fetchDiscoveryPlaylistPool(30);
    expect(personalizedMock).toHaveBeenCalledWith({ limit: 30 });
  });

  it("过滤雷达类个性化歌单", async () => {
    personalizedMock.mockResolvedValue({
      result: [
        { id: 1, name: "私人雷达", picUrl: "http://p/r", trackCount: 1 },
        { id: 2, name: "经典老歌", picUrl: "http://p/2", trackCount: 2 },
      ],
    } as never);
    const pool = await fetchDiscoveryPlaylistPool();
    expect(pool.map((item) => item.id)).toEqual(["2"]);
  });

  it("接口返回空结果时得到空池", async () => {
    personalizedMock.mockResolvedValue({} as never);
    expect(await fetchDiscoveryPlaylistPool()).toEqual([]);
  });

  it("接口失败时错误向上传播", async () => {
    personalizedMock.mockRejectedValue(new Error("network"));
    await expect(fetchDiscoveryPlaylistPool()).rejects.toThrow("network");
  });
});
