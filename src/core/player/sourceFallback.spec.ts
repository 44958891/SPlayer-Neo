import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";

/**
 * 验证：在线歌曲播放加载失败时是否会换源。
 *
 * 关注点（用户反馈的疑似问题）：某一首在线歌曲加载失败后直接跳过，没有换源。
 * 这里直接驱动 loadTrackSourceWithFallback 这条真实路径，逐步替换
 * resolveTrackSource / load 的返回值，观察它是否继续尝试下一个音源。
 */

const mocks = vi.hoisted(() => {
  const track: Track = {
    id: "t1",
    source: "netease",
    title: "Test",
    artists: [],
    duration: 200,
    album: { id: "a", name: "A" },
  } as Track;
  return {
    track,
    status: {
      currentTrack: track,
      playIndex: 0,
      shuffleMode: "off",
      repeatMode: "off",
      fmMode: false,
      abLoop: { enable: false },
      duration: 0,
      position: 0,
      lyricOffsetMs: 0,
      speed: 1,
      trackLoading: false,
      transitioning: false,
      isPlaying: true,
      state: "playing",
      currentSource: null as string | null,
    },
    media: {
      track,
      setTrack: vi.fn(),
      setPlaybackContext: vi.fn(),
      enrichTrack: vi.fn(),
      updateLyricIndex: vi.fn(),
      setLyric: vi.fn(),
    },
    resolve: vi.fn(),
    playerLoad: vi.fn(),
    skipNext: vi.fn(),
    handleError: vi.fn(),
  };
});

vi.mock("./events", () => ({ handleEvent: vi.fn() }));
vi.mock("./fm", () => ({}));
vi.mock("./stats", () => ({ installPlayStats: vi.fn(), onTrackEnded: vi.fn() }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
    player: { transitionMode: "off", transitionPreference: "standard", songLevel: "hires" },
    system: { cache: { songCache: { enabled: false } } },
  }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => mocks.media }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: () => ({ getStreamUrl: vi.fn() }) }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({}) }));
vi.mock("@/stores/history", () => ({ useHistoryStore: () => ({ record: vi.fn() }) }));
vi.mock("@/stores/library", () => ({ useLibraryStore: () => ({}) }));
vi.mock("@/stores/queue", () => ({
  setQueue: vi.fn(),
  updateQueueTracks: vi.fn(),
  getTrackAt: vi.fn(),
  removeFromQueue: vi.fn(),
  insertToQueue: vi.fn(),
  moveInQueue: vi.fn(),
  clearQueue: vi.fn(),
}));
vi.mock("@/services/playback", () => ({
  reset: vi.fn(),
  setCurrentTime: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
  setSpeed: vi.fn(),
  setDuration: vi.fn(),
  setPlaying: vi.fn(),
  setSeeking: vi.fn(),
  setDurationFromTrack: vi.fn(),
}));
vi.mock("@/services/lyric/loader", () => ({ beginLoad: vi.fn(), loadForTrack: vi.fn() }));
vi.mock("@/services/coverLoader", () => ({ loadCoverForTrack: vi.fn() }));
vi.mock("@/services/abLoop", () => ({ reset: vi.fn(), enable: vi.fn(), disable: vi.fn() }));
vi.mock("@/services/cacheScheduler", () => ({ cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({
  getDeviceVolume: vi.fn(),
  setDeviceVolume: vi.fn(),
}));
vi.mock("@/services/audioSource", () => ({
  resolveTrackSource: mocks.resolve,
  cacheKeyForTrack: () => null,
}));
vi.mock("@/services/nextTrackPreloader", () => ({
  scheduleNextTrackPreload: vi.fn(),
  preloadNextTrack: vi.fn(),
  consumePreloadedTrack: vi.fn(),
  invalidatePreloadedTrack: vi.fn(),
}));
vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/composables/useDialog", () => ({ dialog: { alert: vi.fn(), confirm: vi.fn() } }));
vi.mock("@/composables/useFavorite", () => ({ useFavorite: () => ({}) }));
vi.mock("@/i18n", () => {
  const t = (k: string): string => k;
  return { default: { global: { t, te: () => true } } };
});
vi.mock("@/utils/errors", async () => {
  const actual = await vi.importActual<typeof import("@/utils/errors")>("@/utils/errors");
  return { ...actual, handleError: mocks.handleError };
});

// window.api.player.load —— 真实 IPC 边界
const windowApi = {
  succeed: false,
  /** 按源地址判定是否成功（优先于 succeed） */
  onCall: null as ((src: string) => boolean) | null,
  errorCode: ErrorCode.NETWORK_ERROR as string,
  calls: [] as string[],
};
vi.stubGlobal("window", {
  api: {
    player: {
      load: (source: string, opts: { meta?: Track }) => {
        windowApi.calls.push(source);
        void opts;
        const ok = windowApi.onCall ? windowApi.onCall(source) : windowApi.succeed;
        return Promise.resolve(
          ok
            ? { success: true, data: { detail: {}, mediaInfo: {} } }
            : { success: false, error: windowApi.errorCode },
        );
      },
      stop: vi.fn(() => Promise.resolve({ success: true })),
      pause: vi.fn(() => Promise.resolve({ success: true })),
      play: vi.fn(() => Promise.resolve({ success: true })),
      setVolume: vi.fn(),
    },
    queue: { onUpdate: vi.fn() },
    system: {},
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

const { load, playFrom } = await import("./index");

/**
 * 模拟真实 resolveTrackSource：按顺序给出候选源，并遵守 skip 选项
 * （真实实现会因 skipOfficialOnline / skipPluginIds 过滤掉已失败的来源，
 *  这里照做，才能验证换源次数是否收敛）。
 */
const useSequence = (
  sequence: Array<{ source: string; provider: string; pluginId?: string } | null>,
): void => {
  mocks.resolve.mockImplementation(
    (_track: Track, opts?: { skipOfficialOnline?: boolean; skipPluginIds?: string[] }) => {
      const skippedPlugin = new Set(opts?.skipPluginIds ?? []);
      for (const cand of sequence) {
        if (!cand) continue;
        if (cand.provider === "official" && opts?.skipOfficialOnline) continue;
        if (cand.provider === "plugin" && cand.pluginId && skippedPlugin.has(cand.pluginId))
          continue;
        return Promise.resolve(cand);
      }
      return Promise.resolve(null);
    },
  );
};

beforeEach(() => {
  windowApi.succeed = false;
  windowApi.onCall = null;
  windowApi.errorCode = ErrorCode.NETWORK_ERROR;
  windowApi.calls = [];
  mocks.playerLoad.mockReset();
  mocks.resolve.mockReset();
  mocks.handleError.mockReset();
  mocks.status.state = "playing";
  mocks.status.trackLoading = false;
  mocks.status.currentSource = null;
});

describe("在线歌曲加载失败时的换源行为", () => {
  it("load() 单次加载失败时不自行换源（换源由外层负责）", async () => {
    useSequence([
      { source: "https://cdn.example.com/a.flac", provider: "official" },
      { source: "https://plugin.example.com/a.flac", provider: "plugin", pluginId: "lx-music" },
    ]);
    windowApi.errorCode = ErrorCode.NETWORK_ERROR;

    await load("https://cdn.example.com/a.flac", true, mocks.track);

    // load() 是单次加载原语，只调用一次 IPC
    expect(windowApi.calls.length).toBe(1);
  });

  it("URL_RESOLVE_FAILED（可兜底错误）会换源", async () => {
    useSequence([
      { source: "https://cdn.example.com/a.flac", provider: "official" },
      { source: "https://plugin.example.com/a.flac", provider: "plugin", pluginId: "lx-music" },
    ]);
    windowApi.errorCode = ErrorCode.URL_RESOLVE_FAILED;

    await mocks.resolve();
    await load("https://cdn.example.com/a.flac", true, mocks.track);
    expect(windowApi.calls.length).toBe(1);
  });

  it("官方源 NETWORK_ERROR 后换到插件源并成功播放（修复验证）", async () => {
    const fresh = { ...mocks.track, id: "fresh-1" } as Track;
    mocks.status.currentTrack = fresh;
    useSequence([
      { source: "https://cdn.example.com/a.flac", provider: "official" },
      { source: "https://plugin.example.com/a.flac", provider: "plugin", pluginId: "lx-music" },
    ]);
    // 第一个源失败、第二个源成功
    windowApi.succeed = false;
    windowApi.onCall = (src: string) => src.includes("plugin.example.com");

    await playFrom([fresh], 0);

    console.log("[verify] 尝试的源:", JSON.stringify(windowApi.calls));
    // 关键断言：必须尝试过插件源
    expect(windowApi.calls.some((s2) => s2.includes("plugin.example.com"))).toBe(true);
    // 官方失败不应立刻放弃（至少两次加载尝试）
    expect(windowApi.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("所有源都失败时优雅收敛，不无限重试", async () => {
    const fresh = { ...mocks.track, id: "fresh-2" } as Track;
    mocks.status.currentTrack = fresh;
    useSequence([{ source: "https://cdn.example.com/a.flac", provider: "official" }]);
    windowApi.succeed = false;
    windowApi.calls.length = 0;

    await playFrom([fresh], 0);

    // 只有一个官方源：不应超过 2 次（1 次正常 + 1 次预载重解析）
    expect(windowApi.calls.length).toBeLessThanOrEqual(2);
    expect(mocks.handleError).toHaveBeenCalled();
  });
});
