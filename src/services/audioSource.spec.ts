import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  netease: vi.fn(),
  qqmusic: vi.fn(),
  kugou: vi.fn(),
  error: vi.fn(),
  pluginResolveUrl: vi.fn(),
  songLevel: "hq" as string,
  pluginsList: [] as unknown[],
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    player: { songLevel: mocks.songLevel, allowTrialPlay: false },
    system: {},
  }),
}));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: mocks.pluginsList }) }));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({ isLoggedIn: false }) }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: vi.fn() }));
vi.mock("@/apis/song/netease", () => ({ resolveNeteaseUrl: mocks.netease }));
vi.mock("@/apis/song/qqmusic", () => ({ resolveQQMusicUrl: mocks.qqmusic }));
vi.mock("@/apis/song/kugou", () => ({ resolveKugouUrl: mocks.kugou }));
vi.mock("@/utils/errors", () => ({ handleError: mocks.error }));
import { resolveTrackSource } from "./audioSource";

/** 可用的网易云 musicUrl 插件 */
const WY_PLUGIN = {
  manifest: { id: "plugin-a" },
  enabled: true,
  status: { state: "ready", sources: { wy: { actions: ["musicUrl"] } } },
};

describe("官方降档时优先插件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "hq";
    mocks.pluginsList = [];
    (window as unknown as { api: unknown }).api = {
      plugins: { resolveUrl: mocks.pluginResolveUrl },
    };
  });

  it("官方直链档位达标时不调用插件", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("official");
    expect(res?.level).toBe("hi-res");
    expect(mocks.pluginResolveUrl).not.toHaveBeenCalled();
  });

  it("官方静默降档、插件承诺更高档位时改用插件", async () => {
    mocks.songLevel = "jymaster";
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/master.flac",
      quality: "jymaster",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("plugin");
    expect(res?.pluginId).toBe("plugin-a");
    expect(res?.level).toBe("jymaster");
  });

  it("插件档位不及官方降档结果时保留官方直链", async () => {
    mocks.songLevel = "jymaster";
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/lossless.flac",
      quality: "lossless",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("official");
    expect(res?.source).toBe("https://x/hires.flac");
    expect(res?.level).toBe("hi-res");
  });

  it("QQ 官方最高仅 hi-res，母带请求走插件", async () => {
    mocks.songLevel = "jymaster";
    mocks.pluginsList = [
      {
        manifest: { id: "plugin-tx" },
        enabled: true,
        status: { state: "ready", sources: { tx: { actions: ["musicUrl"] } } },
      },
    ];
    mocks.qqmusic.mockResolvedValueOnce({
      available: true,
      url: "https://qq/hires.flac",
      isTrial: false,
      level: "hi-res",
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/tx-master.flac",
      quality: "jymaster",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "qqmusic", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("plugin");
    expect(res?.level).toBe("jymaster");
  });
});

describe("音源解析失败原因", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "hq";
    mocks.pluginsList = [];
  });
  it.each(["netease", "qqmusic", "kugou"] as const)(
    "%s API 异常不会被无插件覆盖",
    async (source) => {
      mocks[source].mockRejectedValueOnce(new Error("fetch failed"));
      const onError = vi.fn();
      const track: Track = { id: "1", title: "test", source, artists: [], duration: 1000 };
      expect(await resolveTrackSource(track, { silent: true, onError })).toBeNull();
      expect(onError).toHaveBeenCalledExactlyOnceWith(ErrorCode.NETWORK_ERROR);
      expect(mocks.error).not.toHaveBeenCalled();
    },
  );
  it("歌曲无版权仍保留单曲错误", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    await resolveTrackSource({
      id: "1",
      title: "test",
      source: "netease",
      artists: [],
      duration: 1000,
    });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(ErrorCode.NETEASE_UNAVAILABLE);
  });
});
