import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  netease: vi.fn(),
  qqmusic: vi.fn(),
  kugou: vi.fn(),
  kuwo: vi.fn(),
  error: vi.fn(),
  pluginResolveUrl: vi.fn(),
  songLevel: "hq" as string,
  songQualitySelection: undefined as string | undefined,
  pluginsList: [] as unknown[],
  lookup: vi.fn(),
  cacheLookup: vi.fn(),
  settings: {
    // songLevel 走 getter 动态读 mocks.songLevel，测试内改档位即时生效
    get player() {
      return {
        songLevel: mocks.songLevel,
        songQualitySelection: mocks.songQualitySelection,
        allowTrialPlay: false,
      };
    },
    system: { cache: { songCache: { enabled: false } } },
  },
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => mocks.settings,
}));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: mocks.pluginsList }) }));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({ isLoggedIn: false }) }));
vi.mock("@/apis/song/netease", () => ({ resolveNeteaseUrl: mocks.netease }));
vi.mock("@/apis/song/qqmusic", () => ({ resolveQQMusicUrl: mocks.qqmusic }));
vi.mock("@/apis/song/kugou", () => ({ resolveKugouUrl: mocks.kugou }));
vi.mock("@/apis/song/kuwo", () => ({ resolveKuwoUrl: mocks.kuwo }));
vi.mock("@/utils/errors", () => ({ handleError: mocks.error }));
import { resolveTrackSource } from "./audioSource";

/** 可用的网易云 musicUrl 插件 */
const WY_PLUGIN = {
  manifest: { id: "plugin-a" },
  enabled: true,
  status: { state: "ready", sources: { wy: { actions: ["musicUrl"] } } },
};

/** 可用的酷狗 musicUrl 插件（独立插件来源曲目用） */
const KG_PLUGIN = {
  manifest: { id: "plugin-kg" },
  enabled: true,
  status: { state: "ready", sources: { kg: { actions: ["musicUrl"] } } },
};

describe("官方降档时优先插件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "hq";
    mocks.songQualitySelection = undefined;
    mocks.pluginsList = [];
    mocks.lookup.mockReset().mockResolvedValue(null);
    mocks.settings.system.cache.songCache.enabled = false;
    (window as unknown as { api: unknown }).api = {
      plugins: { resolveUrl: mocks.pluginResolveUrl },
      download: { lookup: mocks.lookup },
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

describe("优先播放下载文件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songQualitySelection = undefined;
    mocks.lookup.mockReset().mockResolvedValue(null);
    mocks.settings.system.cache.songCache.enabled = false;
    Object.assign(window, {
      api: {
        plugins: { resolveUrl: mocks.pluginResolveUrl },
        download: { lookup: mocks.lookup },
        cache: { song: { lookup: mocks.cacheLookup } },
      },
    });
  });

  it("远端流媒体只返回身份占位符，凭据和播放会话由主进程解析", async () => {
    const result = await resolveTrackSource({
      id: "server:remote",
      source: "streaming",
      serverId: "server",
      originalId: "remote",
      title: "歌曲",
      artists: [],
      duration: 1000,
    });
    expect(result?.source).toBe("streaming://server/remote");
  });
  it("命中下载后跳过缓存和在线地址解析", async () => {
    mocks.settings.system.cache.songCache.enabled = true;
    mocks.lookup.mockResolvedValueOnce("C:/downloads/song.flac");
    const track: Track = { id: "1", title: "test", source: "netease", artists: [], duration: 1000 };
    expect(await resolveTrackSource(track)).toEqual({
      source: "C:/downloads/song.flac",
      fromCache: false,
      provider: "download",
    });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith({ source: "netease", id: "1" });
    expect(mocks.cacheLookup).not.toHaveBeenCalled();
    expect(mocks.netease).not.toHaveBeenCalled();
  });

  it("流媒体下载按服务器身份查询，并跳过远端地址解析", async () => {
    mocks.lookup.mockResolvedValueOnce("C:/downloads/stream.flac");
    await resolveTrackSource({
      id: "song",
      source: "streaming",
      serverId: "server",
      originalId: "remote",
      title: "stream",
      artists: [],
      duration: 1000,
    });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith({
      source: "streaming",
      id: "song",
      serverId: "server",
      originalId: "remote",
    });
  });

  it("下载查询异常时继续在线解析", async () => {
    mocks.lookup.mockRejectedValueOnce(new Error("database error"));
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://music/song",
      isTrial: false,
    });
    const result = await resolveTrackSource({
      id: "1",
      source: "netease",
      title: "test",
      artists: [],
      duration: 1000,
    });
    expect(result?.source).toBe("https://music/song");
    expect(mocks.netease).toHaveBeenCalledOnce();
  });
});

describe("音源解析失败原因", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "hq";
    mocks.songQualitySelection = undefined;
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

describe("插件取链来源证据", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "hq";
    mocks.songQualitySelection = undefined;
    mocks.lookup.mockReset().mockResolvedValue(null);
    mocks.settings.system.cache.songCache.enabled = false;
    (window as unknown as { api: unknown }).api = {
      plugins: { resolveUrl: mocks.pluginResolveUrl },
      download: { lookup: mocks.lookup },
    };
  });

  it("插件回传原生档位时证据为 plugin", async () => {
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/song.flac",
      quality: "hq",
      nativeTier: "2000k",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("plugin");
    expect(res?.level).toBe("hq");
    expect(res?.qualityProvenance).toEqual({
      provider: "plugin",
      pluginId: "plugin-a",
      sourceKey: "wy",
      nativeTier: "2000k",
      level: "hq",
      evidence: "plugin",
    });
  });

  it("插件只有 requestedTier（LX 请求回显）时降级为 request 证据", async () => {
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/song.flac",
      quality: "lossless",
      requestedTier: "flac",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.qualityProvenance).toEqual({
      provider: "plugin",
      pluginId: "plugin-a",
      sourceKey: "wy",
      requestedTier: "flac",
      level: "lossless",
      evidence: "request",
    });
  });

  it("旧插件只回请求换算档位时不虚构响应证据", async () => {
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/song.mp3", quality: "hq" });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.qualityProvenance).toEqual({
      provider: "plugin",
      pluginId: "plugin-a",
      sourceKey: "wy",
      level: "hq",
      evidence: "request",
    });
  });

  it("插件显式 actualSource 时映射平台，来源键仍保留请求值", async () => {
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/song.flac",
      quality: "hq",
      actualSource: "kg",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.qualityProvenance).toEqual({
      provider: "plugin",
      pluginId: "plugin-a",
      sourceKey: "wy",
      platform: "kugou",
      platformEvidence: "explicit",
      level: "hq",
      evidence: "request",
    });
  });

  it("独立插件曲目结果带档位与来源证据", async () => {
    mocks.pluginsList = [KG_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/kg.flac", quality: "lossless" });
    const res = await resolveTrackSource({
      id: "song-1",
      title: "test",
      source: "plugin",
      artists: [],
      duration: 1000,
      plugin: { pluginId: "plugin-kg", source: "kg", musicInfo: { id: "song-1", name: "test" } },
    });
    expect(res).toEqual({
      source: "https://p/kg.flac",
      fromCache: false,
      provider: "plugin",
      pluginId: "plugin-kg",
      level: "lossless",
      qualityProvenance: {
        provider: "plugin",
        pluginId: "plugin-kg",
        sourceKey: "kg",
        level: "lossless",
        evidence: "request",
      },
    });
  });
});

describe("官方降档保留来源证据", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "jymaster";
    mocks.songQualitySelection = undefined;
    mocks.lookup.mockReset().mockResolvedValue(null);
    mocks.settings.system.cache.songCache.enabled = false;
    (window as unknown as { api: unknown }).api = {
      plugins: { resolveUrl: mocks.pluginResolveUrl },
      download: { lookup: mocks.lookup },
    };
  });

  it("官方降档直链保留响应证据", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
      qualityProvenance: {
        provider: "official",
        platform: "netease",
        evidence: "response",
        nativeTier: "hires",
        level: "hi-res",
      },
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("official");
    expect(res?.level).toBe("hi-res");
    expect(res?.qualityProvenance).toEqual({
      provider: "official",
      platform: "netease",
      evidence: "response",
      nativeTier: "hires",
      level: "hi-res",
    });
  });

  it("官方降档、插件不及格时兜底直链证据不丢失", async () => {
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
      qualityProvenance: {
        provider: "official",
        platform: "netease",
        evidence: "response",
        nativeTier: "hires",
        level: "hi-res",
      },
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/l.flac", quality: "lossless" });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("official");
    expect(res?.source).toBe("https://x/hires.flac");
    expect(res?.qualityProvenance).toEqual({
      provider: "official",
      platform: "netease",
      evidence: "response",
      nativeTier: "hires",
      level: "hi-res",
    });
  });

  it("官方降档、插件更高档时证据切换为插件", async () => {
    mocks.pluginsList = [WY_PLUGIN];
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
      qualityProvenance: {
        provider: "official",
        platform: "netease",
        evidence: "response",
        nativeTier: "hires",
        level: "hi-res",
      },
    });
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/master.flac",
      quality: "jymaster",
      nativeTier: "master",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("plugin");
    expect(res?.qualityProvenance).toEqual({
      provider: "plugin",
      pluginId: "plugin-a",
      sourceKey: "wy",
      nativeTier: "master",
      level: "jymaster",
      evidence: "plugin",
    });
  });
});

describe("本地文件查询来源信息", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "hq";
    mocks.songQualitySelection = undefined;
    mocks.lookup.mockReset().mockResolvedValue(null);
    mocks.cacheLookup.mockReset().mockResolvedValue(null);
    mocks.pluginsList = [];
    mocks.netease.mockResolvedValue({
      available: true,
      url: "https://music/song",
      isTrial: false,
    });
  });

  it("下载 lookupInfo 命中时继承文件保存的来源信息", async () => {
    const lookupInfo = vi.fn().mockResolvedValue({
      path: "C:/downloads/song.flac",
      qualityProvenance: {
        provider: "official",
        platform: "netease",
        evidence: "response",
        nativeTier: "lossless",
        level: "lossless",
      },
    });
    (window as unknown as { api: unknown }).api = {
      download: { lookupInfo },
      cache: { song: { lookup: mocks.cacheLookup } },
    };
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("download");
    expect(res?.source).toBe("C:/downloads/song.flac");
    expect(res?.qualityProvenance).toEqual({
      provider: "official",
      platform: "netease",
      evidence: "response",
      nativeTier: "lossless",
      level: "lossless",
    });
    expect(mocks.netease).not.toHaveBeenCalled();
  });

  it("旧下载查询只回路径时不带来源信息", async () => {
    (window as unknown as { api: unknown }).api = {
      download: { lookup: mocks.lookup },
      cache: { song: { lookup: mocks.cacheLookup } },
    };
    mocks.lookup.mockResolvedValueOnce("C:/downloads/song.flac");
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("download");
    expect(res?.qualityProvenance).toBeUndefined();
  });

  it("缓存 lookupInfo 命中时继承文件保存的来源信息", async () => {
    mocks.settings.system.cache.songCache.enabled = true;
    const lookupInfo = vi.fn().mockResolvedValue({
      path: "C:/cache/song.flac",
      qualityProvenance: {
        provider: "plugin",
        pluginId: "plugin-a",
        sourceKey: "wy",
        evidence: "plugin",
        nativeTier: "2000k",
      },
    });
    (window as unknown as { api: unknown }).api = {
      download: { lookup: mocks.lookup },
      cache: { song: { lookupInfo } },
    };
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("cache");
    expect(res?.fromCache).toBe(true);
    expect(res?.qualityProvenance).toEqual({
      provider: "plugin",
      pluginId: "plugin-a",
      sourceKey: "wy",
      evidence: "plugin",
      nativeTier: "2000k",
    });
  });

  it("缓存 lookupInfo 带回非法来源信息时清除", async () => {
    mocks.settings.system.cache.songCache.enabled = true;
    const lookupInfo = vi.fn().mockResolvedValue({
      path: "C:/cache/song.flac",
      qualityProvenance: { provider: "spoofed", evidence: "response", junk: true },
    });
    (window as unknown as { api: unknown }).api = {
      download: { lookup: mocks.lookup },
      cache: { song: { lookupInfo } },
    };
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(res?.provider).toBe("cache");
    expect(res?.qualityProvenance).toBeUndefined();
  });
});

describe("具体平台音质选择", () => {
  /** 可用的 QQ musicUrl 插件 */
  const TX_PLUGIN = {
    manifest: { id: "plugin-tx" },
    enabled: true,
    status: { state: "ready", sources: { tx: { actions: ["musicUrl"] } } },
  };
  /** 可用的酷我 musicUrl 插件 */
  const KW_PLUGIN = {
    manifest: { id: "plugin-kw" },
    enabled: true,
    status: { state: "ready", sources: { kw: { actions: ["musicUrl"] } } },
  };
  const QQ_TRACK: Track = {
    id: "1",
    title: "test",
    source: "qqmusic",
    artists: [],
    duration: 1000,
  };
  const KUWO_TRACK: Track = { ...QQ_TRACK, source: "kuwo" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "hq";
    mocks.songQualitySelection = undefined;
    mocks.lookup.mockReset().mockResolvedValue(null);
    mocks.cacheLookup.mockReset().mockResolvedValue(null);
    mocks.settings.system.cache.songCache.enabled = false;
    (window as unknown as { api: unknown }).api = {
      plugins: { resolveUrl: mocks.pluginResolveUrl },
      download: { lookup: mocks.lookup },
      cache: { song: { lookup: mocks.cacheLookup } },
    };
  });

  it("官方支持的空间音频选择按选项档位请求官方 sky，达标即采用", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://n/sky.flac",
      isTrial: false,
      level: "sky",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true, qualitySelection: "netease:sky" },
    );
    expect(res?.provider).toBe("official");
    expect(res?.level).toBe("sky");
    expect(mocks.netease.mock.calls[0]?.[1]).toBe("sky");
    expect(mocks.pluginResolveUrl).not.toHaveBeenCalled();
  });

  it("QQ 臻品母带4.0 跳过官方通道，插件请求携带选择标识", async () => {
    mocks.pluginsList = [TX_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/master4.flac",
      quality: "jymaster",
    });
    const res = await resolveTrackSource(QQ_TRACK, {
      silent: true,
      qualitySelection: "qqmusic:qq-master-4.0",
    });
    expect(mocks.qqmusic).not.toHaveBeenCalled();
    expect(mocks.pluginResolveUrl.mock.calls[0]?.[0]).toMatchObject({
      source: "tx",
      quality: "jymaster",
      qualitySelection: "qqmusic:qq-master-4.0",
    });
    expect(res?.provider).toBe("plugin");
    expect(res?.level).toBe("jymaster");
  });

  it("QQ 全景声选择跳过官方通道，插件请求携带选择标识", async () => {
    mocks.pluginsList = [TX_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/atmos.flac", quality: "sky" });
    const res = await resolveTrackSource(QQ_TRACK, {
      silent: true,
      qualitySelection: "qqmusic:qq-spatial",
    });
    expect(mocks.qqmusic).not.toHaveBeenCalled();
    expect(mocks.pluginResolveUrl.mock.calls[0]?.[0]).toMatchObject({
      source: "tx",
      quality: "sky",
      qualitySelection: "qqmusic:qq-spatial",
    });
    expect(res?.provider).toBe("plugin");
    expect(res?.level).toBe("sky");
  });

  it("全景声选择拿不到时不冒用官方其他品牌档", async () => {
    mocks.pluginsList = [TX_PLUGIN];
    mocks.pluginResolveUrl.mockRejectedValueOnce(new Error("no atmos"));
    const res = await resolveTrackSource(QQ_TRACK, {
      silent: true,
      qualitySelection: "qqmusic:qq-spatial",
    });
    expect(res).toBeNull();
    expect(mocks.qqmusic).not.toHaveBeenCalled();
    expect(mocks.pluginResolveUrl).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ qualitySelection: "qqmusic:qq-spatial" }),
    );
  });

  it("QQ 全景声 plain 与 plus 同属 sky 但缓存键按选择 id 区分", async () => {
    mocks.settings.system.cache.songCache.enabled = true;
    mocks.pluginsList = [TX_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValue({ url: "https://p/song.flac", quality: "sky" });
    await resolveTrackSource(QQ_TRACK, { silent: true, qualitySelection: "qqmusic:qq-spatial" });
    expect(mocks.cacheLookup).toHaveBeenLastCalledWith("o:qqmusic:1:qqmusic:qq-spatial");
    await resolveTrackSource(QQ_TRACK, {
      silent: true,
      qualitySelection: "qqmusic:qq-spatial-2.0",
    });
    expect(mocks.cacheLookup).toHaveBeenLastCalledWith("o:qqmusic:1:qqmusic:qq-spatial-2.0");
  });

  it.each(["kuwo:kuwo-premium-2.0", "kuwo:kuwo-spatial", "kuwo:hires"])(
    "酷我已移除档位选择 %s 显式拒绝，不静默变低档",
    async (qualitySelection) => {
      // 插件在场也不得偷偷换档；官方通道同样不触达
      mocks.pluginsList = [KW_PLUGIN];
      const onError = vi.fn();
      const result = await resolveTrackSource(KUWO_TRACK, {
        silent: true,
        qualitySelection,
        onError,
      });
      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith(ErrorCode.URL_RESOLVE_FAILED);
      expect(mocks.kuwo).not.toHaveBeenCalled();
      expect(mocks.pluginResolveUrl).not.toHaveBeenCalled();
    },
  );

  it("无法映射的有效音效选择不改成其他平台档位", async () => {
    const onError = vi.fn();
    const result = await resolveTrackSource(QQ_TRACK, {
      silent: true,
      qualitySelection: "netease:jyeffect",
      onError,
    });
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith(ErrorCode.URL_RESOLVE_FAILED);
    expect(mocks.qqmusic).not.toHaveBeenCalled();
    expect(mocks.pluginResolveUrl).not.toHaveBeenCalled();
  });

  it.each(["qqmusic:qq-premium-2.0"])(
    "QQ 已下线选择 %s 显式拒绝，不触达任何音源通道",
    async (qualitySelection) => {
      const onError = vi.fn();
      const result = await resolveTrackSource(QQ_TRACK, {
        silent: true,
        qualitySelection,
        onError,
      });
      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith(ErrorCode.URL_RESOLVE_FAILED);
      expect(mocks.qqmusic).not.toHaveBeenCalled();
      expect(mocks.kuwo).not.toHaveBeenCalled();
      expect(mocks.pluginResolveUrl).not.toHaveBeenCalled();
    },
  );

  it("QQ 无选择 sky 请求映射具体全景声档，仅走插件不走官方旧通道", async () => {
    mocks.songLevel = "sky";
    mocks.pluginsList = [TX_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/atmos.flac", quality: "sky" });
    const res = await resolveTrackSource(QQ_TRACK, { silent: true });
    expect(mocks.qqmusic).not.toHaveBeenCalled();
    expect(mocks.pluginResolveUrl.mock.calls[0]?.[0]).toMatchObject({
      source: "tx",
      quality: "sky",
      qualitySelection: "qqmusic:qq-spatial",
    });
    expect(res?.provider).toBe("plugin");
    expect(res?.level).toBe("sky");
  });

  it("QQ 无选择请求环绕声档时拒绝，不隐式降用其他品牌档", async () => {
    mocks.songLevel = "jyeffect";
    const onError = vi.fn();
    const result = await resolveTrackSource(QQ_TRACK, { silent: true, onError });
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith(ErrorCode.URL_RESOLVE_FAILED);
    expect(mocks.qqmusic).not.toHaveBeenCalled();
    expect(mocks.kuwo).not.toHaveBeenCalled();
    expect(mocks.pluginResolveUrl).not.toHaveBeenCalled();
  });

  it("skipCache 只跳过缓存读取，缓存写入入口照常返回", async () => {
    mocks.settings.system.cache.songCache.enabled = true;
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://n/song",
      isTrial: false,
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true, skipCache: true },
    );
    expect(mocks.cacheLookup).not.toHaveBeenCalled();
    expect(typeof res?.cacheRequest).toBe("function");
  });

  it("设置保存的具体选择作为默认请求目标", async () => {
    mocks.songQualitySelection = "qqmusic:qq-spatial-2.0";
    mocks.pluginsList = [TX_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/atmos.flac", quality: "sky" });
    const res = await resolveTrackSource(QQ_TRACK, { silent: true });
    expect(mocks.qqmusic).not.toHaveBeenCalled();
    expect(mocks.pluginResolveUrl.mock.calls[0]?.[0]).toMatchObject({
      qualitySelection: "qqmusic:qq-spatial-2.0",
    });
    expect(res?.provider).toBe("plugin");
  });

  it("未保存选择时保持通用档位请求", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://n/song",
      isTrial: false,
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true },
    );
    expect(mocks.netease.mock.calls[0]?.[1]).toBe("hq");
    expect(res?.provider).toBe("official");
  });

  it("独立插件曲目不携带平台音质选择", async () => {
    mocks.pluginsList = [
      {
        manifest: { id: "plugin-kg" },
        enabled: true,
        status: { state: "ready", sources: { kg: { actions: ["musicUrl"] } } },
      },
    ];
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/kg.flac", quality: "lossless" });
    await resolveTrackSource({
      id: "song-1",
      title: "test",
      source: "plugin",
      artists: [],
      duration: 1000,
      plugin: { pluginId: "plugin-kg", source: "kg", musicInfo: { id: "song-1", name: "test" } },
    });
    expect(mocks.pluginResolveUrl.mock.calls[0]?.[0]).not.toHaveProperty("qualitySelection");
  });

  it("官方达标结果携带请求的具体选择标识", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://n/sky.flac",
      isTrial: false,
      level: "sky",
    });
    const res = await resolveTrackSource(
      { id: "1", title: "test", source: "netease", artists: [], duration: 1000 },
      { silent: true, qualitySelection: "netease:sky" },
    );
    expect(res?.qualitySelection).toBe("netease:sky");
    expect(res?.level).toBe("sky");
  });

  it("缓存命中携带请求的具体选择标识", async () => {
    mocks.settings.system.cache.songCache.enabled = true;
    const lookupInfo = vi.fn().mockResolvedValue({ path: "C:/cache/song.flac" });
    (window as unknown as { api: unknown }).api = {
      download: { lookup: mocks.lookup },
      cache: { song: { lookupInfo } },
    };
    const res = await resolveTrackSource(QQ_TRACK, {
      silent: true,
      qualitySelection: "qqmusic:qq-spatial",
    });
    expect(res?.provider).toBe("cache");
    expect(res?.qualitySelection).toBe("qqmusic:qq-spatial");
  });

  it("下载命中携带请求的具体选择标识", async () => {
    const lookupInfo = vi.fn().mockResolvedValue({ path: "C:/downloads/song.flac" });
    (window as unknown as { api: unknown }).api = {
      download: { lookupInfo },
      cache: { song: { lookup: mocks.cacheLookup } },
    };
    const res = await resolveTrackSource(QQ_TRACK, {
      silent: true,
      qualitySelection: "qqmusic:qq-spatial-2.0",
    });
    expect(res?.provider).toBe("download");
    expect(res?.qualitySelection).toBe("qqmusic:qq-spatial-2.0");
  });
});

describe("显式选择的已知降档防护", () => {
  /** 第二个网易云 musicUrl 插件 */
  const WY_PLUGIN_B = {
    manifest: { id: "plugin-b" },
    enabled: true,
    status: { state: "ready", sources: { wy: { actions: ["musicUrl"] } } },
  };
  const TRACK: Track = {
    id: "1",
    title: "test",
    source: "netease",
    artists: [],
    duration: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.songLevel = "jymaster";
    mocks.songQualitySelection = undefined;
    mocks.lookup.mockReset().mockResolvedValue(null);
    mocks.settings.system.cache.songCache.enabled = false;
    (window as unknown as { api: unknown }).api = {
      plugins: { resolveUrl: mocks.pluginResolveUrl },
      download: { lookup: mocks.lookup },
    };
  });

  it("已知降档回执不冒充成功，仍有无声明候选时不采用", async () => {
    mocks.netease.mockResolvedValue({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    mocks.pluginsList = [WY_PLUGIN, WY_PLUGIN_B];
    mocks.pluginResolveUrl
      .mockResolvedValueOnce({ url: "https://p/a.flac", quality: "lossless", nativeTier: "flac" })
      .mockResolvedValueOnce({ url: "https://p/b.flac" });
    const res = await resolveTrackSource(TRACK, {
      silent: true,
      qualitySelection: "netease:jymaster",
    });
    expect(res?.pluginId).toBe("plugin-b");
    expect(res?.level).toBeUndefined();
    expect(res?.qualitySelection).toBe("netease:jymaster");
  });

  it("通用请求仍按声明档位取最高者", async () => {
    mocks.netease.mockResolvedValue({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    mocks.pluginsList = [WY_PLUGIN, WY_PLUGIN_B];
    mocks.pluginResolveUrl
      .mockResolvedValueOnce({ url: "https://p/a.flac", quality: "lossless", nativeTier: "flac" })
      .mockResolvedValueOnce({ url: "https://p/b.flac" });
    const res = await resolveTrackSource(TRACK, { silent: true });
    expect(res?.pluginId).toBe("plugin-a");
    expect(res?.level).toBe("lossless");
  });

  it("全部候选都已知降档时仍返回最好的可播结果", async () => {
    mocks.netease.mockResolvedValue({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    mocks.pluginsList = [WY_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValue({
      url: "https://p/a.flac",
      quality: "lossless",
      nativeTier: "flac",
    });
    const res = await resolveTrackSource(TRACK, {
      silent: true,
      qualitySelection: "netease:jymaster",
    });
    expect(res?.pluginId).toBe("plugin-a");
    expect(res?.level).toBe("lossless");
  });

  it("品牌母带选择按最低物理规格判断已知降档，达标回执保留", async () => {
    const KG_PLUGIN_A = {
      manifest: { id: "kg-a" },
      enabled: true,
      status: { state: "ready", sources: { kg: { actions: ["musicUrl"] } } },
    };
    const KG_PLUGIN_B = {
      manifest: { id: "kg-b" },
      enabled: true,
      status: { state: "ready", sources: { kg: { actions: ["musicUrl"] } } },
    };
    const KUGOU_TRACK: Track = {
      id: "1",
      title: "test",
      source: "kugou",
      artists: [],
      duration: 1000,
    };
    mocks.pluginsList = [KG_PLUGIN_A, KG_PLUGIN_B];
    // 回执 lossless 低于 hi-res 物理下限时不冒充母带，无声明候选仍参与
    mocks.pluginResolveUrl
      .mockResolvedValueOnce({ url: "https://p/a.flac", quality: "lossless", nativeTier: "flac" })
      .mockResolvedValueOnce({ url: "https://p/b.flac" });
    const knownLower = await resolveTrackSource(KUGOU_TRACK, {
      silent: true,
      qualitySelection: "kugou:kugou-master",
    });
    expect(knownLower?.pluginId).toBe("kg-b");
    // 回执 hi-res 已达物理下限时不再视为已知降档
    mocks.pluginResolveUrl
      .mockResolvedValueOnce({ url: "https://p/a2.flac", quality: "hi-res", nativeTier: "high" })
      .mockResolvedValueOnce({ url: "https://p/b2.flac" });
    const atFloor = await resolveTrackSource(KUGOU_TRACK, {
      silent: true,
      qualitySelection: "kugou:kugou-master",
    });
    expect(atFloor?.pluginId).toBe("kg-a");
    expect(atFloor?.level).toBe("hi-res");
  });

  it("显式选择时请求回显的老插件不替换官方降档直链", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
    });
    mocks.pluginsList = [WY_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValueOnce({ url: "https://p/x.flac", quality: "jymaster" });
    const res = await resolveTrackSource(TRACK, {
      silent: true,
      qualitySelection: "netease:jymaster",
    });
    expect(res?.provider).toBe("official");
    expect(res?.source).toBe("https://x/hires.flac");
    expect(res?.level).toBe("hi-res");
  });

  it("显式选择时插件档位回执达标才替换官方降档直链", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://x/hires.flac",
      isTrial: false,
      level: "hi-res",
    });
    mocks.pluginsList = [WY_PLUGIN];
    mocks.pluginResolveUrl.mockResolvedValueOnce({
      url: "https://p/master.flac",
      quality: "jymaster",
      nativeTier: "master",
    });
    const res = await resolveTrackSource(TRACK, {
      silent: true,
      qualitySelection: "netease:jymaster",
    });
    expect(res?.provider).toBe("plugin");
    expect(res?.level).toBe("jymaster");
    expect(res?.qualityProvenance?.evidence).toBe("plugin");
  });
});
