import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverItem } from "@/types/artist";
import type { Platform } from "@shared/types/platform";
import { fetchDiscoveryPlaylists } from "./discovery";
import { searchPlaylists } from "@/apis/search";
import { fetchMiguDiscoverPlaylists } from "./migu";
import { fetchDiscoveryPlaylistPool } from "./netease";
import { discoveryKey, type DiscoveryPlaylist } from "@/utils/playlistDiscovery";

vi.mock("@/apis/search", () => ({ searchPlaylists: vi.fn() }));
vi.mock("./netease", () => ({ fetchDiscoveryPlaylistPool: vi.fn() }));
vi.mock("./migu", () => ({ fetchMiguDiscoverPlaylists: vi.fn() }));

const searchMock = vi.mocked(searchPlaylists);
const neteasePoolMock = vi.mocked(fetchDiscoveryPlaylistPool);
const miguMock = vi.mocked(fetchMiguDiscoverPlaylists);

const coverOf = (id: string): CoverItem => ({
  id,
  title: `标题-${id}`,
  cover: `cover-${id}`,
  trackCount: 1,
});

const idsOf = (_platform: Platform, prefix: string, count: number): CoverItem[] =>
  Array.from({ length: count }, (_, i) => coverOf(`${prefix}${i}`));

const oldItem = (id: string, source: Platform = "netease"): DiscoveryPlaylist => ({
  ...coverOf(id),
  source,
});

/** 固定时间戳与洗牌随机值，保证断言确定 */
const stubTimings = () => {
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  return vi.spyOn(Math, "random").mockReturnValue(0.9);
};

const defaultSources = () => {
  neteasePoolMock.mockResolvedValue(idsOf("netease", "n", 60));
  searchMock.mockImplementation(async (platform) => {
    const prefix = platform === "qqmusic" ? "q" : platform === "kugou" ? "k" : "w";
    return {
      items: idsOf(platform, prefix, 30),
      total: 150,
      hasMore: true,
    };
  });
  miguMock.mockResolvedValue(
    idsOf("migu", "m", 30).map((item) => ({ ...item, source: "migu" as const })),
  );
};

beforeEach(() => {
  searchMock.mockReset();
  neteasePoolMock.mockReset();
  miguMock.mockReset();
});

describe("fetchDiscoveryPlaylists", () => {
  it("五平台全成功时按目标混排 30 条，每平台 6 条", async () => {
    stubTimings();
    defaultSources();
    const { items, failedPlatforms, reusedCount, freshCount } = await fetchDiscoveryPlaylists();
    expect(items).toHaveLength(30);
    expect(freshCount).toBe(30);
    expect(reusedCount).toBe(0);
    expect(failedPlatforms).toEqual([]);
    const countBySource = new Set(items.slice(0, 5).map((item) => item.source));
    expect(countBySource.size).toBe(5);
    for (const platform of ["netease", "qqmusic", "kugou", "kuwo", "migu"] as Platform[]) {
      expect(items.filter((item) => item.source === platform)).toHaveLength(6);
    }
    expect(neteasePoolMock).toHaveBeenCalledWith(60);
    expect(miguMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 30, page: 1 }));
    expect(searchMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 0, 30);
    const keys = items.map(discoveryKey);
    expect(new Set(keys).size).toBe(30);
  });

  it("候选选择避开上一批条目", async () => {
    stubTimings();
    defaultSources();
    const previous = [oldItem("n0"), oldItem("q0", "qqmusic"), oldItem("m0", "migu")];
    const { items } = await fetchDiscoveryPlaylists(previous);
    const keys = new Set(items.map(discoveryKey));
    expect(keys.has("netease:n0")).toBe(false);
    expect(keys.has("qqmusic:q0")).toBe(false);
    expect(keys.has("migu:m0")).toBe(false);
    expect(items).toHaveLength(30);
  });

  it("咪咕两轮失败计独立失败，其余平台溢出补齐 30 条", async () => {
    stubTimings();
    defaultSources();
    miguMock.mockRejectedValue(new Error("migu down"));
    const { items, failedPlatforms, freshCount } = await fetchDiscoveryPlaylists();
    expect(miguMock).toHaveBeenCalledTimes(2);
    expect(failedPlatforms).toEqual(["migu"]);
    expect(items).toHaveLength(30);
    expect(freshCount).toBe(30);
    expect(items.filter((item) => item.source !== "migu")).toHaveLength(30);
  });

  it("酷狗失败时其余四平台补齐且不产出酷狗条目", async () => {
    stubTimings();
    defaultSources();
    searchMock.mockImplementation(async (platform) => {
      if (platform === "kugou") throw new Error("kg down");
      const prefix = platform === "qqmusic" ? "q" : platform === "kuwo" ? "w" : "n";
      const items =
        platform === "netease" ? idsOf("netease", "n", 60) : idsOf(platform, prefix, 30);
      return { items, total: 150, hasMore: true };
    });
    const { items, failedPlatforms } = await fetchDiscoveryPlaylists();
    expect(failedPlatforms).toEqual(["kugou"]);
    expect(items).toHaveLength(30);
    expect(items.every((item) => item.source !== "kugou")).toBe(true);
  });

  it("第二轮沿用同主题随机有效页，页深封顶内", async () => {
    const randomSpy = stubTimings();
    neteasePoolMock.mockResolvedValue(idsOf("netease", "n", 60));
    miguMock.mockRejectedValue(new Error("migu down"));
    searchMock.mockImplementation(async (platform, _theme, offset) => {
      // QQ 首轮只回 2 条触发第二轮补取
      if (platform === "qqmusic") {
        return offset === 0
          ? { items: idsOf("qqmusic", "q", 2), total: 150, hasMore: true }
          : { items: idsOf("qqmusic", "q2", 30), total: 150, hasMore: true };
      }
      const prefix = platform === "kugou" ? "k" : "w";
      return { items: idsOf(platform, prefix, 30), total: 150, hasMore: true };
    });
    await fetchDiscoveryPlaylists();
    const qqCalls = searchMock.mock.calls.filter(([platform]) => platform === "qqmusic");
    expect(qqCalls).toHaveLength(2);
    const [first, second] = qqCalls as [
      [Platform, string, number, number],
      [Platform, string, number, number],
    ];
    expect(first[2]).toBe(0);
    expect(second[1]).toBe(first[1]);
    expect([30, 60, 90, 120]).toContain(second[2]);
    randomSpy.mockRestore();
  });

  it("新批不足 25 时用未重复旧项补齐到 30，无重复键", async () => {
    stubTimings();
    neteasePoolMock.mockResolvedValue(idsOf("netease", "n", 6));
    searchMock.mockImplementation(async (platform) => {
      const prefix = platform === "qqmusic" ? "q" : platform === "kugou" ? "k" : "w";
      return { items: idsOf(platform, prefix, 6), total: 6, hasMore: false };
    });
    miguMock.mockRejectedValue(new Error("migu down"));
    neteasePoolMock.mockResolvedValue(idsOf("netease", "n", 6));
    searchMock.mockImplementation(async (platform) => ({
      items: idsOf(platform, platform, 6),
      total: 6,
      hasMore: false,
    }));
    const previous = Array.from({ length: 30 }, (_, i) => oldItem(`old${i}`));
    const { items, reusedCount, freshCount, failedPlatforms } =
      await fetchDiscoveryPlaylists(previous);
    expect(freshCount).toBe(24);
    expect(items).toHaveLength(30);
    expect(reusedCount).toBe(6);
    expect(failedPlatforms).toEqual(["migu"]);
    const keys = items.map(discoveryKey);
    expect(new Set(keys).size).toBe(30);
    expect(items.slice(24).every((item) => item.id.startsWith("old"))).toBe(true);
  });

  it("全部平台失败时保旧去重封顶 30，freshCount 为 0 且失败平台完整", async () => {
    stubTimings();
    neteasePoolMock.mockRejectedValue(new Error("net"));
    searchMock.mockRejectedValue(new Error("search down"));
    miguMock.mockRejectedValue(new Error("migu down"));
    const previous = [
      ...Array.from({ length: 20 }, (_, i) => oldItem(`old${i}`)),
      ...Array.from({ length: 15 }, (_, i) => oldItem(`old${i}`)),
    ];
    const { items, failedPlatforms, freshCount, reusedCount } =
      await fetchDiscoveryPlaylists(previous);
    expect(freshCount).toBe(0);
    expect(reusedCount).toBe(20);
    expect(items.map((item) => item.id)).toEqual(Array.from({ length: 20 }, (_, i) => `old${i}`));
    expect(failedPlatforms).toEqual(["netease", "qqmusic", "kugou", "kuwo", "migu"]);
  });

  it("全部平台成功但返回空池时不误报失败，保旧并 freshCount 为 0", async () => {
    stubTimings();
    neteasePoolMock.mockResolvedValue([]);
    searchMock.mockResolvedValue({ items: [], total: 0, hasMore: false });
    miguMock.mockResolvedValue([]);
    const previous = Array.from({ length: 12 }, (_, i) => oldItem(`old${i}`));
    const { items, failedPlatforms, freshCount, reusedCount } =
      await fetchDiscoveryPlaylists(previous);
    expect(failedPlatforms).toEqual([]);
    expect(freshCount).toBe(0);
    expect(items).toHaveLength(12);
    expect(reusedCount).toBe(12);
  });

  it("同 id 跨平台各自保留", async () => {
    stubTimings();
    neteasePoolMock.mockResolvedValue([coverOf("dup")]);
    searchMock.mockResolvedValue({ items: [coverOf("dup")], total: 1, hasMore: false });
    miguMock.mockResolvedValue([{ ...coverOf("dup"), source: "migu" as const }]);
    const { items } = await fetchDiscoveryPlaylists();
    const dupKeys = items.filter((item) => item.id === "dup").map(discoveryKey);
    expect([...dupKeys].sort()).toEqual(
      ["netease:dup", "qqmusic:dup", "kugou:dup", "kuwo:dup", "migu:dup"].sort(),
    );
  });

  it("相同输入下两次刷新结果完全一致（RNG 确定）", async () => {
    stubTimings();
    defaultSources();
    const first = await fetchDiscoveryPlaylists();
    const second = await fetchDiscoveryPlaylists();
    expect(second.items.map(discoveryKey)).toEqual(first.items.map(discoveryKey));
    expect(second.failedPlatforms).toEqual(first.failedPlatforms);
  });
});
