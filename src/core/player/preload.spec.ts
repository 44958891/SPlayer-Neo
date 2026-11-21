import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { QualityProvenance } from "@shared/types/quality";

const mocks = vi.hoisted(() => {
  const track = { id: "next", source: "netease", title: "Next", artists: [], duration: 1000 };
  const media = {
    track: { ...track, id: "old" },
    setPlaybackContext: vi.fn(),
    enrichTrack: vi.fn(),
    updateLyricIndex: vi.fn(),
    setLyric: vi.fn(),
    setPlaybackQuality: vi.fn(),
  };
  return {
    track,
    transitionPreference: "standard" as "conservative" | "standard" | "eager",
    media,
    status: {
      currentTrack: { ...track, id: "old" },
      playIndex: 0,
      shuffleMode: "off",
      repeatMode: "off",
      fmMode: false,
      abLoop: { enable: false },
      duration: 10000,
      position: 0,
      lyricOffsetMs: 0,
      speed: 1,
      trackLoading: false,
      transitioning: false,
      isPlaying: true,
      state: "playing",
      currentSource: "old",
    },
    consume: vi.fn(),
    peek: vi.fn(),
    transition: vi.fn(),
    finishTransition: vi.fn(),
    onTrackEnded: vi.fn(),
    resolve: vi.fn(),
    load: vi.fn(),
    stop: vi.fn(),
    invalidate: vi.fn(),
    assess: vi.fn(),
  };
});
vi.mock("./events", () => ({ handleEvent: vi.fn() }));
vi.mock("./fm", () => ({}));
vi.mock("./stats", () => ({ installPlayStats: vi.fn(), onTrackEnded: mocks.onTrackEnded }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
    player: { transitionMode: "crossfade", transitionPreference: mocks.transitionPreference },
  }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({
  useMediaStore: () => ({
    ...mocks.media,
    setTrack: (track: typeof mocks.track) => {
      mocks.media.track = track;
    },
  }),
}));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: vi.fn() }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: vi.fn() }));
vi.mock("@/stores/history", () => ({ useHistoryStore: () => ({ record: vi.fn() }) }));
vi.mock("@/stores/library", () => ({ useLibraryStore: vi.fn() }));
vi.mock("@/stores/queue", () => ({
  queue: { value: [{ ...mocks.track, id: "old" }, mocks.track] },
  queueLength: { value: 2 },
  setQueue: vi.fn(),
  updateQueueTracks: vi.fn(),
}));
vi.mock("@/services/playback", () => ({
  reset: vi.fn(),
  setCurrentTime: vi.fn(),
  getCurrentTime: vi.fn(() => mocks.status.position),
  setSpeed: vi.fn(),
  setDuration: vi.fn(),
  setPlaying: vi.fn(),
  setSeeking: vi.fn(),
}));
vi.mock("@/services/lyric/loader", () => ({ beginLoad: vi.fn(), loadForTrack: vi.fn() }));
vi.mock("@/services/coverLoader", () => ({ loadCoverForTrack: vi.fn() }));
vi.mock("@/services/abLoop", () => ({ reset: vi.fn() }));
vi.mock("@/services/cacheScheduler", () => ({ cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({ getDeviceVolume: vi.fn(), setDeviceVolume: vi.fn() }));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: mocks.resolve }));
vi.mock("@/services/nextTrackPreloader", () => ({
  invalidateNextTrackPreload: mocks.invalidate,
  consumePreloadedTrack: mocks.consume,
  beginPreparedTransition: (_track: Track, expectedId?: string) => {
    const result = mocks.peek();
    if (!result || (expectedId && result.preparedId !== expectedId)) return null;
    mocks.consume();
    return result;
  },
  finishPreparedTransition: mocks.finishTransition,
  disposeNextTrackPreload: vi.fn(),
  installNextTrackPreloadWatchers: vi.fn(),
  scheduleNextTrackPreload: vi.fn(),
}));
vi.mock("@/composables/useFavorite", () => ({ useFavorite: vi.fn() }));
vi.mock("@/composables/useToast", () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("@shared/utils/playbackQuality", () => ({
  assessPlaybackQuality: mocks.assess,
}));
vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));
vi.mock("@/utils/errors", () => ({
  handleError: vi.fn(),
  isSkippableError: (code: string) => code === "FILE_DECODE_ERROR",
}));
vi.mock("@/utils/preset/skipKeywords", () => ({ shouldSkipKeywordTrack: () => false }));
vi.mock("@/i18n", () => ({
  default: { global: { t: (value: string) => value, te: () => true } },
}));

describe("切歌消费真实预载", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // 模块转换属于测试准备，避免首个用例超时后在下一用例继续消费异步回包
    await import("./index");
    mocks.media.track = { ...mocks.track, id: "old" };
    mocks.status.currentTrack = { ...mocks.track, id: "old" };
    mocks.status.playIndex = 0;
    mocks.load.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1000 } },
    });
    mocks.stop.mockResolvedValue({ success: true });
    Object.assign(window, {
      api: { player: { load: mocks.load, stop: mocks.stop, transitionPrepared: mocks.transition } },
    });
  });

  it.each([false, true])("下载文件失效后只换源一次，预载=%s", async (preloaded) => {
    mocks.status.currentTrack = mocks.track;
    const downloaded = {
      source: "C:/downloads/next.flac",
      fromCache: false,
      provider: "download",
    };
    mocks.consume.mockReturnValue(
      preloaded
        ? {
            trackId: "next",
            preparedId: "next-slot",
            source: downloaded,
          }
        : null,
    );
    mocks.resolve.mockReset();
    if (!preloaded) mocks.resolve.mockResolvedValueOnce(downloaded);
    mocks.resolve.mockResolvedValueOnce({
      source: "https://music/next",
      fromCache: false,
      provider: "official",
    });
    mocks.load.mockResolvedValueOnce({ success: false, error: "FILE_NOT_FOUND" });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.resolve).toHaveBeenLastCalledWith(
      mocks.track,
      expect.objectContaining({
        skipDownloaded: true,
        skipOfficialOnline: false,
      }),
    );
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load.mock.calls[1]?.[0]).toBe("https://music/next");
    expect(mocks.media.track.source).toBe("netease");
    expect(mocks.media.track.id).toBe("next");
  });

  it.each(["NETWORK_ERROR", "NETWORK_TIMEOUT"])("%s 保留真实错误并停止自动跳曲", async (error) => {
    mocks.consume.mockReturnValue(null);
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      fromCache: false,
      provider: "official",
    });
    // 每次加载都失败（真实环境下换源后同样会失败），而不是仅第一次
    mocks.load.mockResolvedValue({ success: false, error });
    const timer = vi.spyOn(globalThis, "setTimeout");
    const { playFrom } = await import("./index");
    const { handleError } = await import("@/utils/errors");
    await playFrom([mocks.track as Track]);
    // 网络类错误现在会继续换源（官方 → 插件），因此解析可能被调用多次；
    // 真正要守住的是：错误只上报一次，且不触发自动跳曲定时器
    expect(mocks.resolve.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(handleError).toHaveBeenCalledExactlyOnceWith(error);
    expect(timer.mock.calls.some((call) => call[1] === 1000)).toBe(false);
    expect(mocks.status.state).toBe("idle");
  });

  it("解析接口网络失败不会当成无音源连续跳曲", async () => {
    mocks.consume.mockReturnValue(null);
    mocks.resolve.mockImplementationOnce((_track, options) => {
      options.onError("NETWORK_ERROR");
      return null;
    });
    const timer = vi.spyOn(globalThis, "setTimeout");
    const { playFrom } = await import("./index");
    const { handleError } = await import("@/utils/errors");
    await playFrom([mocks.track as Track]);
    expect(handleError).toHaveBeenCalledExactlyOnceWith("NETWORK_ERROR");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(timer.mock.calls.some((call) => call[1] === 1000)).toBe(false);
  });

  it("换源耗尽时保留原加载错误，不替换为缺少插件", async () => {
    mocks.resolve.mockResolvedValueOnce({
      source: "https://music/next",
      fromCache: false,
      provider: "official",
    });
    mocks.resolve.mockImplementationOnce((_track, options) => {
      options.onError("NO_PLUGIN_AVAILABLE");
      return null;
    });
    mocks.load.mockResolvedValueOnce({ success: false, error: "FILE_DECODE_ERROR" });
    const { reloadCurrentTrack } = await import("./index");
    const { handleError } = await import("@/utils/errors");
    expect(await reloadCurrentTrack(false)).toBe(false);
    expect(handleError).toHaveBeenCalledExactlyOnceWith("FILE_DECODE_ERROR");
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("主动停止在等待主进程响应前就作废预载", async () => {
    let finish!: (result: { success: boolean }) => void;
    mocks.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { stop } = await import("./index");
    const pending = stop();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    finish({ success: true });
    await pending;
  });

  it.each([false, true])("当前解析或预载的音质依据传入加载，预载=%s", async (preloaded) => {
    const qualityProvenance: QualityProvenance = {
      provider: "plugin",
      pluginId: "p",
      platform: "qqmusic",
      nativeTier: "臻品母带2.0",
      level: "jymaster",
      evidence: "plugin",
    };
    const source = {
      source: "https://music/new-source",
      fromCache: false,
      provider: "plugin",
      pluginId: "p",
      qualityProvenance,
    };
    mocks.consume.mockReturnValue(preloaded ? { preparedId: "quality-slot", source } : null);
    mocks.resolve.mockReset().mockResolvedValue(source);
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.load).toHaveBeenCalledWith(
      source.source,
      expect.objectContaining({ qualityProvenance }),
    );
  });

  it("准备完成的槽位直接交给 load，不能先 stop 清除它", async () => {
    mocks.consume.mockReturnValue({
      preparedId: "prepared",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledWith(
      "C:/cache/next.bin",
      expect.objectContaining({ preparedId: "prepared" }),
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("显式选择新音质时绕过下载文件与旧缓存，按选择重新取源", async () => {
    mocks.status.position = 0;
    mocks.resolve.mockResolvedValue({
      source: "https://music/new-quality",
      provider: "official",
      fromCache: false,
    });
    const { reloadCurrentTrack } = await import("./index");
    expect(await reloadCurrentTrack(false, true)).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipDownloaded: true, skipCache: true }),
    );
  });

  it("重载当前音源后作废旧槽位并重新准备下一首", async () => {
    mocks.status.position = 0;
    mocks.resolve.mockResolvedValue({
      source: "https://music/current",
      fromCache: false,
      provider: "official",
    });
    const { reloadCurrentTrack } = await import("./index");
    const preloader = await import("@/services/nextTrackPreloader");

    expect(await reloadCurrentTrack(false)).toBe(true);
    expect(preloader.invalidateNextTrackPreload).toHaveBeenCalledOnce();
    expect(preloader.scheduleNextTrackPreload).toHaveBeenCalledOnce();
  });

  it.each(["nextTrack", "playAtIndex"] as const)(
    "手动调用 %s 时复用预载槽位且不交叉淡化",
    async (method) => {
      mocks.status.currentTrack = mocks.track;
      mocks.consume.mockReturnValue({
        preparedId: "prepared",
        source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
      });
      const player = await import("./index");
      await (method === "nextTrack" ? player.nextTrack() : player.playAtIndex(1));
      expect(mocks.load).toHaveBeenCalledWith(
        "C:/cache/next.bin",
        expect.objectContaining({ preparedId: "prepared" }),
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    },
  );

  it("没有就绪槽位时保留正常停止、解析和加载流程", async () => {
    mocks.consume.mockReturnValue(null);
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      fromCache: false,
      provider: "official",
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledWith(
      "https://music/next",
      expect.objectContaining({ preparedId: undefined }),
    );
  });

  it("缓存音源失效后重新解析，并且不能把旧槽位代次带到重试中", async () => {
    mocks.consume.mockReturnValue({
      preparedId: "stale",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    mocks.load.mockResolvedValueOnce({ success: false, error: "FILE_DECODE_ERROR" });
    mocks.resolve.mockResolvedValue({
      source: "https://music/retry",
      fromCache: false,
      provider: "official",
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load.mock.calls[1]).toEqual([
      "https://music/retry",
      expect.objectContaining({ preparedId: undefined }),
    ]);
  });
});

describe("交叉过渡的队列交接", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // 模块转换属于测试准备，避免首个用例超时后在下一用例继续消费异步回包
    await import("./index");
    mocks.media.track = { ...mocks.track, id: "old" };
    mocks.status.currentTrack = { ...mocks.track, id: "old" };
    mocks.status.playIndex = 0;
    mocks.status.duration = 10000;
    mocks.status.isPlaying = true;
    mocks.status.speed = 1;
    mocks.status.position = 0;
    mocks.status.state = "playing";
    mocks.status.trackLoading = false;
    mocks.status.repeatMode = "off";
    mocks.status.abLoop.enable = false;
    mocks.status.fmMode = false;
    mocks.transitionPreference = "standard";
    mocks.peek.mockReturnValue({
      preparedId: "next-slot",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    mocks.consume.mockReturnValueOnce({ preparedId: "next-slot" }).mockReturnValue(null);
    mocks.transition.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1000 } },
    });
    Object.assign(window, {
      api: { player: { load: mocks.load, stop: mocks.stop, transitionPrepared: mocks.transition } },
    });
  });

  it("交叉交接传递的是下一首已准备音源的档位依据", async () => {
    const qualityProvenance: QualityProvenance = {
      provider: "official",
      platform: "netease",
      nativeTier: "sky",
      level: "sky",
      evidence: "response",
    };
    mocks.peek.mockReturnValue({
      preparedId: "quality-slot",
      source: {
        source: "C:/cache/spatial.bin",
        fromCache: true,
        provider: "cache",
        qualityProvenance,
      },
    });
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).toHaveBeenCalledWith(
      "quality-slot",
      "C:/cache/spatial.bin",
      5000,
      "standard",
      expect.objectContaining({ qualityProvenance }),
    );
  });

  it("交接成功后更新队列和曲目，且不重新加载输出流", async () => {
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      5000,
      "standard",
      expect.objectContaining({ meta: mocks.track }),
    );
    expect(mocks.status.playIndex).toBe(1);
    expect(mocks.media.track.id).toBe("next");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.onTrackEnded).toHaveBeenCalledWith(false);
  });

  it("交接采用真实锚点并保留暂停状态，不将歌词归零", async () => {
    mocks.transition.mockResolvedValue({
      success: true,
      data: {
        detail: {},
        mediaInfo: { duration: 1000 },
        playback: { position: 400, state: "paused", speed: 1.25, timestamp: Date.now() - 200 },
      },
    });
    const { trySmartTransition } = await import("./index");
    const clock = await import("@/services/playback");
    await trySmartTransition(5000);
    expect(mocks.status.position).toBe(400);
    expect(mocks.status.state).toBe("paused");
    expect(mocks.status.speed).toBe(1.25);
    expect(clock.setCurrentTime).toHaveBeenCalledWith(400, { force: true });
    expect(clock.setCurrentTime).not.toHaveBeenCalledWith(0, expect.anything());
    expect(mocks.media.updateLyricIndex).toHaveBeenCalledWith(400);
    expect(mocks.consume).toHaveBeenCalledTimes(1);
  });

  it("长静音尾部按有效结尾提前交接，保留原始时长", async () => {
    mocks.status.duration = 40000;
    mocks.transition.mockResolvedValue({ success: false });
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(20000, "next-slot", 25250);
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      5250,
      "standard",
      expect.any(Object),
    );
    expect(mocks.status.duration).toBe(40000);
  });

  it("积极档在两倍速下也能提前安排九秒窗口内的交接", async () => {
    mocks.status.duration = 40000;
    mocks.status.speed = 2;
    mocks.transitionPreference = "eager";
    mocks.transition.mockResolvedValue({ success: false });
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(23000, "next-slot");
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      8500,
      "eager",
      expect.any(Object),
    );
  });

  it("忽略后台迟到的其他槽位通知", async () => {
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000, "old-slot");
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it.each(["conservative", "eager"] as const)("%s 档向原生引擎传递交接倾向", async (preference) => {
    mocks.transitionPreference = preference;
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      5000,
      preference,
      expect.objectContaining({ meta: mocks.track }),
    );
  });

  it("交接等待期间切换播放列表后丢弃旧交接结果", async () => {
    let completeTransition!: (result: {
      success: boolean;
      data: { detail: object; mediaInfo: { duration: number } };
    }) => void;
    mocks.transition.mockImplementation(
      () => new Promise((resolve) => (completeTransition = resolve)),
    );
    mocks.resolve.mockResolvedValue({
      source: "C:/music/chosen.wav",
      fromCache: false,
      provider: "local",
    });
    mocks.load.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1000 } },
    });
    const player = await import("./index");
    const pending = player.trySmartTransition(5000);
    const chosen = { ...mocks.track, id: "chosen", title: "Chosen" };
    mocks.status.currentTrack = chosen;
    await player.playFrom([chosen as Track]);
    completeTransition({ success: true, data: { detail: {}, mediaInfo: { duration: 1000 } } });
    await pending;
    expect(mocks.media.track.id).toBe("chosen");
    expect(mocks.onTrackEnded).not.toHaveBeenCalled();
  });

  it("单曲循环时不提前交叉切换", async () => {
    mocks.status.repeatMode = "one";
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("停止后迟到的交接成功响应不能推进队列或恢复播放", async () => {
    let finish!: (value: unknown) => void;
    mocks.transition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const player = await import("./index");
    const pending = player.trySmartTransition(5000);
    await player.stop();
    mocks.consume.mockReturnValue(null);
    finish({ success: true, data: { detail: {}, mediaInfo: { duration: 1000 } } });
    await pending;
    expect(mocks.status.playIndex).toBe(0);
    expect(mocks.status.state).toBe("stopped");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.onTrackEnded).not.toHaveBeenCalled();
    expect(mocks.finishTransition).toHaveBeenCalledWith("next-slot");
  });

  it("seek 后迟到的交接成功响应不能切换曲目", async () => {
    let finish!: (value: unknown) => void;
    mocks.transition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    Object.assign(window.api.player, { seek: vi.fn().mockResolvedValue({ success: true }) });
    const player = await import("./index");
    const pending = player.trySmartTransition(5000);
    await player.seek(1000);
    finish({ success: true, data: { detail: {}, mediaInfo: { duration: 1000 } } });
    await pending;
    expect(mocks.status.playIndex).toBe(0);
    expect(mocks.status.position).toBe(1000);
    expect(mocks.media.track.id).toBe("old");
    expect(mocks.onTrackEnded).not.toHaveBeenCalled();
  });

  it("停止后迟到的交接错误不能触发下一曲兜底", async () => {
    let finish!: (value: unknown) => void;
    mocks.transition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const player = await import("./index");
    const pending = player.trySmartTransition(5000);
    await player.stop();
    finish({ success: false, error: "UNKNOWN" });
    await pending;
    expect(mocks.status.playIndex).toBe(0);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("交接持有已接管的音源，设置作废预载后也不重复加载", async () => {
    let finish!: (value: unknown) => void;
    mocks.transition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const player = await import("./index");
    const pending = player.trySmartTransition(5000);
    mocks.consume.mockReturnValue(null);
    finish({ success: true, data: { detail: {}, mediaInfo: { duration: 1000 } } });
    await pending;
    expect(mocks.status.playIndex).toBe(1);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.finishTransition).toHaveBeenCalledWith("next-slot");
  });

  it("停止 IPC 尚未返回时也拒绝交接结果", async () => {
    let finishTransition!: (value: unknown) => void;
    let finishStop!: (value: unknown) => void;
    mocks.transition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishTransition = resolve;
        }),
    );
    mocks.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStop = resolve;
        }),
    );
    const player = await import("./index");
    const transition = player.trySmartTransition(5000);
    const stopping = player.stop();
    finishTransition({ success: true, data: { detail: {}, mediaInfo: { duration: 1000 } } });
    await transition;
    expect(mocks.status.playIndex).toBe(0);
    expect(mocks.load).not.toHaveBeenCalled();
    finishStop({ success: true });
    await stopping;
    expect(mocks.status.state).toBe("stopped");
  });
});

describe("播放档位校验与降档兜底", () => {
  /** 主进程回传的未达标结论 */
  const below = {
    selection: "netease:jymaster",
    platform: "netease",
    state: "below",
    actualLevel: "lossless",
  };
  /** 主进程回传的达标结论 */
  const met = {
    selection: "netease:jymaster",
    platform: "netease",
    state: "met",
    actualLevel: "jymaster",
  };
  const okResult = (detail: Record<string, unknown>) => ({
    success: true,
    data: { detail, mediaInfo: { duration: 1000 } },
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // 模块转换属于测试准备，避免首个用例超时后在下一用例继续消费异步回包
    await import("./index");
    mocks.media.track = { ...mocks.track, id: "old" };
    mocks.status.currentTrack = mocks.track;
    mocks.status.playIndex = 0;
    mocks.status.position = 0;
    mocks.status.state = "playing";
    mocks.status.trackLoading = false;
    mocks.consume.mockReturnValue(null);
    mocks.stop.mockResolvedValue({ success: true });
    Object.assign(window, {
      api: { player: { load: mocks.load, stop: mocks.stop, seek: vi.fn() } },
    });
  });

  it("官方交付未达标时换到下一个来源再加载", async () => {
    mocks.resolve
      .mockResolvedValueOnce({
        source: "https://music/official",
        fromCache: false,
        provider: "official",
        qualitySelection: "netease:jymaster",
      })
      .mockResolvedValueOnce({
        source: "https://music/plugin",
        fromCache: false,
        provider: "plugin",
        pluginId: "p",
        qualitySelection: "netease:jymaster",
      });
    mocks.load
      .mockResolvedValueOnce(okResult({ playbackQuality: below }))
      .mockResolvedValueOnce(okResult({ playbackQuality: met }));
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.resolve.mock.calls[1]?.[1]).toMatchObject({ skipOfficialOnline: true });
    expect(mocks.load.mock.calls[1]?.[1]).toMatchObject({
      qualitySelection: "netease:jymaster",
    });
    const { handleError } = await import("@/utils/errors");
    expect(handleError).not.toHaveBeenCalled();
  });

  it("缓存内容与请求档位不符时作废缓存读取重新解析", async () => {
    mocks.resolve
      .mockResolvedValueOnce({
        source: "C:/cache/old.bin",
        fromCache: true,
        provider: "cache",
        qualitySelection: "netease:jymaster",
      })
      .mockResolvedValueOnce({
        source: "https://music/fresh",
        fromCache: false,
        provider: "official",
        qualitySelection: "netease:jymaster",
      });
    mocks.load
      .mockResolvedValueOnce(okResult({ playbackQuality: below }))
      .mockResolvedValueOnce(okResult({ playbackQuality: met }));
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.resolve.mock.calls[1]?.[1]).toMatchObject({ skipCache: true });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load.mock.calls[1]?.[1]).toMatchObject({ preparedId: undefined });
  });

  it("换源耗尽的降档兜底保留可播来源，不写缓存也不跳曲", async () => {
    const cacheRequest = vi.fn().mockResolvedValue("C:/cache/new.bin");
    mocks.resolve
      .mockResolvedValueOnce({
        source: "https://music/official",
        fromCache: false,
        provider: "official",
        qualitySelection: "netease:jymaster",
        cacheRequest,
      })
      .mockImplementationOnce((_track: Track, options: { onError: (e: string) => void }) => {
        options.onError("NO_PLUGIN_AVAILABLE");
        return Promise.resolve(null);
      });
    mocks.load.mockResolvedValue(okResult({ playbackQuality: below }));
    const timer = vi.spyOn(globalThis, "setTimeout");
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    const { handleError } = await import("@/utils/errors");
    const { toast } = await import("@/composables/useToast");
    const cacheScheduler = await import("@/services/cacheScheduler");
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(handleError).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(cacheScheduler.schedule).not.toHaveBeenCalled();
    expect(timer.mock.calls.some((call) => call[1] === 1000)).toBe(false);
  });

  it("兜底结果之后有失败加载时先重载兜底音源再返回", async () => {
    mocks.resolve
      .mockResolvedValueOnce({
        source: "https://music/official",
        fromCache: false,
        provider: "official",
        qualitySelection: "netease:jymaster",
      })
      .mockResolvedValueOnce({
        source: "https://music/plugin",
        fromCache: false,
        provider: "plugin",
        pluginId: "p",
        qualitySelection: "netease:jymaster",
      })
      .mockImplementationOnce((_track: Track, options: { onError: (e: string) => void }) => {
        options.onError("NO_PLUGIN_AVAILABLE");
        return Promise.resolve(null);
      });
    mocks.load
      .mockResolvedValueOnce(okResult({ playbackQuality: below }))
      .mockResolvedValueOnce({ success: false, error: "FILE_DECODE_ERROR" })
      .mockResolvedValueOnce(okResult({ playbackQuality: below }));
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    // 插件源加载失败后，用官方降档源重载一次恢复引擎状态
    expect(mocks.load).toHaveBeenCalledTimes(3);
    expect(mocks.load.mock.calls[2]?.[0]).toBe("https://music/official");
    expect(mocks.load.mock.calls[2]?.[1]).toMatchObject({ qualitySelection: "netease:jymaster" });
  });

  it("显式重载无提供者达标时恢复先前音源并提示目标不可达", async () => {
    mocks.status.position = 5000;
    mocks.status.currentSource = "https://music/old";
    mocks.resolve.mockResolvedValue({
      source: "https://music/new",
      fromCache: false,
      provider: "official",
      qualitySelection: "netease:jymaster",
    });
    mocks.load.mockImplementation((source: string) =>
      Promise.resolve(
        source === "https://music/old" ? okResult({}) : okResult({ playbackQuality: below }),
      ),
    );
    const seek = vi.fn().mockResolvedValue({ success: true });
    const play = vi.fn().mockResolvedValue({ success: true });
    Object.assign(window.api.player, { seek, play });
    const { reloadCurrentTrack } = await import("./index");
    const { toast } = await import("@/composables/useToast");
    const cacheScheduler = await import("@/services/cacheScheduler");
    expect(await reloadCurrentTrack(true, true)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("quality.playback.targetUnavailable");
    // 恢复加载为暂停态续播（autoPlay=false）；suppressErrorToast 是运行时选项不随 IPC 下发
    expect(mocks.load).toHaveBeenCalledWith(
      "https://music/old",
      expect.objectContaining({ autoPlay: false }),
    );
    expect(seek).toHaveBeenCalledWith(5000);
    expect(play).toHaveBeenCalledOnce();
    expect(cacheScheduler.schedule).not.toHaveBeenCalled();
  });

  it("达到请求档位的结果按请求档位写入缓存", async () => {
    const cacheRequest = vi.fn().mockResolvedValue("C:/cache/new.bin");
    mocks.resolve.mockResolvedValue({
      source: "https://music/official",
      fromCache: false,
      provider: "official",
      qualitySelection: "netease:jymaster",
      cacheRequest,
    });
    mocks.load.mockResolvedValue(okResult({ playbackQuality: met }));
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    const cacheScheduler = await import("@/services/cacheScheduler");
    expect(cacheScheduler.schedule).toHaveBeenCalledWith(mocks.track.id, cacheRequest);
    const { toast } = await import("@/composables/useToast");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("缺失解码参数的旧加载结果不参与档位校验", async () => {
    mocks.resolve.mockResolvedValue({
      source: "https://music/official",
      fromCache: false,
      provider: "official",
      qualitySelection: "netease:jymaster",
    });
    mocks.load.mockResolvedValue(okResult({}));
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.assess).not.toHaveBeenCalled();
    const { toast } = await import("@/composables/useToast");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("主进程未下结论时用解码参数本地复验", async () => {
    const decoded = {
      quality: {
        codec: "flac",
        sampleRate: 44100,
        bitsPerSample: 16,
        bitRate: 6000000,
        channels: 2,
      },
      externalLyrics: [],
    };
    mocks.resolve
      .mockResolvedValueOnce({
        source: "https://music/official",
        fromCache: false,
        provider: "official",
        qualitySelection: "netease:jymaster",
      })
      .mockResolvedValueOnce({
        source: "https://music/plugin",
        fromCache: false,
        provider: "plugin",
        pluginId: "p",
        qualitySelection: "netease:jymaster",
      });
    mocks.load.mockResolvedValue(okResult(decoded));
    mocks.assess.mockReturnValueOnce(below).mockReturnValueOnce(met);
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.assess).toHaveBeenCalledWith(
      expect.objectContaining({ selection: "netease:jymaster", source: "official" }),
    );
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it("下载文件播放不受档位校验约束", async () => {
    mocks.resolve.mockResolvedValue({
      source: "C:/downloads/song.flac",
      fromCache: false,
      provider: "download",
      qualitySelection: "netease:jymaster",
    });
    mocks.load.mockResolvedValue(okResult({ playbackQuality: below }));
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.assess).not.toHaveBeenCalled();
  });

  it("预载音源携带的具体选择随加载下发", async () => {
    mocks.consume.mockReturnValue({
      preparedId: "slot",
      source: {
        source: "C:/cache/next.bin",
        fromCache: true,
        provider: "cache",
        qualitySelection: "netease:jymaster",
      },
    });
    mocks.load.mockResolvedValue(okResult({ playbackQuality: met }));
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledWith(
      "C:/cache/next.bin",
      expect.objectContaining({ preparedId: "slot", qualitySelection: "netease:jymaster" }),
    );
  });
});
