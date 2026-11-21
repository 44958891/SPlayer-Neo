import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { MusicUrlRes } from "@shared/types/plugin";
import type { AudioProbeResult } from "@shared/utils/audioProbe";

/** 真实解析链路（声明严检用例）使用的 resolveByPluginBest 类型 */
type RealResolveByPluginBest = typeof import("@/services/audioSource").resolveByPluginBest;

const mocks = vi.hoisted(() => ({
  resolveByPluginBest: vi.fn(),
  /** 声明严检用例置真：mock 透传真实解析实现，验证与 resolveDownloadSource 的集成 */
  useRealResolver: false,
  /** mock 工厂阶段捕获的原始 audioSource 模块 */
  real: null as { resolveByPluginBest: RealResolveByPluginBest } | null,
  /** 真实解析链路读取的插件注册表 */
  pluginList: [] as unknown[],
  pluginResolveUrl: vi.fn(),
  pluginProbeUrl: vi.fn(),
  pluginsHealth: vi.fn(),
  pluginsHealthReport: vi.fn(),
}));

vi.mock("@/services/audioSource", async () => {
  const actual =
    await vi.importActual<typeof import("@/services/audioSource")>("@/services/audioSource");
  mocks.real = actual;
  return { ...actual, resolveByPluginBest: mocks.resolveByPluginBest };
});

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    player: { songLevel: "hq", songQualitySelection: undefined, allowTrialPlay: false },
    system: { cache: { songCache: { enabled: false } } },
  }),
}));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: mocks.pluginList }) }));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({ isLoggedIn: false }) }));
vi.mock("@/apis/song/netease", () => ({ resolveNeteaseUrl: vi.fn() }));
vi.mock("@/apis/song/qqmusic", () => ({ resolveQQMusicUrl: vi.fn() }));
vi.mock("@/apis/song/kugou", () => ({ resolveKugouUrl: vi.fn() }));
vi.mock("@/apis/song/kuwo", () => ({ resolveKuwoUrl: vi.fn() }));
vi.mock("@/utils/errors", () => ({ handleError: vi.fn() }));

import { resolveDownloadSource } from "./source";
import { ErrorCode } from "@shared/types/errors";

const trackOf = (source: Track["source"]): Track => ({
  id: `${source}-1`,
  source,
  title: "歌",
  artists: [{ id: "a", name: "歌手" }],
  duration: 200000,
});

beforeEach(() => {
  mocks.useRealResolver = false;
  mocks.pluginList = [];
  mocks.resolveByPluginBest.mockReset();
  mocks.resolveByPluginBest.mockImplementation(
    async (...args: Parameters<RealResolveByPluginBest>) => {
      if (!mocks.useRealResolver) {
        return { ok: true, url: "https://example.com/a.flac", isTrial: false, provider: "plugin" };
      }
      const real = mocks.real?.resolveByPluginBest;
      if (!real) throw new Error("actual audioSource not loaded");
      return real(...args);
    },
  );
});

describe("下载源解析的音质目标映射", () => {
  it("平台具体选择透传为解析器第五参，档位取自目录", async () => {
    const res = await resolveDownloadSource(trackOf("netease"), "hq", "netease:lossless");
    expect(res.ok).toBe(true);
    expect(mocks.resolveByPluginBest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "netease" }),
      "lossless",
      [],
      true,
      "netease:lossless",
    );
  });

  it("旧通用档位映射本平台目标：migu 的 hi-res 目标（canonical migu:hires）", async () => {
    await resolveDownloadSource(trackOf("migu"), "hi-res");
    expect(mocks.resolveByPluginBest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "migu" }),
      "hi-res",
      [],
      true,
      "migu:hires",
    );
  });

  it("legacy migu:migu-premium 存档选择按 alias 落到 hires 目标", async () => {
    const res = await resolveDownloadSource(trackOf("migu"), "hq", "migu:migu-premium");
    expect(res.ok).toBe(true);
    expect(mocks.resolveByPluginBest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "migu" }),
      "hi-res",
      [],
      true,
      "migu:hires",
    );
  });

  it("环绕声目标落到无环绕声平台（QQ）→ DOWNLOAD_QUALITY_NOT_MET，不调用解析器", async () => {
    const res = await resolveDownloadSource(trackOf("qqmusic"), "jyeffect");
    expect(res).toEqual({ ok: false, errorCode: ErrorCode.DOWNLOAD_QUALITY_NOT_MET });
    expect(mocks.resolveByPluginBest).not.toHaveBeenCalled();
  });

  it("不匹配当前平台的显式选择直接拒绝，不静默变成另一档位", async () => {
    const result = await resolveDownloadSource(trackOf("qqmusic"), "hq", "netease:sky");
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.DOWNLOAD_QUALITY_NOT_MET });
    expect(mocks.resolveByPluginBest).not.toHaveBeenCalled();
  });

  it("解析器失败与试听拒绝按原因码带出", async () => {
    mocks.resolveByPluginBest.mockResolvedValue({
      ok: false,
      errorCode: ErrorCode.NO_PLUGIN_AVAILABLE,
    });
    const res = await resolveDownloadSource(trackOf("kugou"), "hq");
    expect(res).toEqual({ ok: false, errorCode: ErrorCode.NO_PLUGIN_AVAILABLE });
  });

  it("流媒体曲目直接取流地址不走插件", async () => {
    const track = trackOf("streaming");
    track.serverId = "srv";
    track.originalId = "orig";
    const res = await resolveDownloadSource(track, "hq");
    expect(res.ok).toBe(true);
    expect(mocks.resolveByPluginBest).not.toHaveBeenCalled();
  });
});

describe("下载源声明回执严检（真实解析链路）", () => {
  /** 可用 QQ musicUrl 插件工厂 */
  const txPlugin = (id: string) => ({
    manifest: { id },
    enabled: true,
    status: { state: "ready", sources: { tx: { actions: ["musicUrl"] } } },
  });
  /** 可用网易云 musicUrl 插件工厂 */
  const wyPlugin = (id: string) => ({
    manifest: { id },
    enabled: true,
    status: { state: "ready", sources: { wy: { actions: ["musicUrl"] } } },
  });
  /** EM 类插件回执：母带原生档 + 版本化回执确认 QQ 平台 */
  const emMaster = (): MusicUrlRes => ({
    url: "https://p/em.flac",
    quality: "jymaster",
    nativeTier: "master",
    sourceEvidence: "gzPlayback-v1",
  });
  /** 裸链接 + 请求档位回显（无实际档位证据） */
  const nakedJymaster = (url: string): MusicUrlRes => ({ url, quality: "jymaster" });
  /** 探针通过（42MB） */
  const probeOk = (sizeBytes = 42_000_000): AudioProbeResult => ({
    ok: true,
    hard: false,
    message: "",
    sizeBytes,
    timedOut: false,
  });
  /** 探针硬拒：非音频内容（试听片段/防盗链页面同类） */
  const probeHardReject = (): AudioProbeResult => ({
    ok: false,
    hard: true,
    message: "返回内容非音频（application/json）",
    sizeBytes: 0,
    timedOut: false,
  });
  /** 打开真实解析链路并装配插件 IPC mocks */
  const setupRealChain = (): void => {
    mocks.useRealResolver = true;
    (window as unknown as { api: unknown }).api = {
      plugins: {
        resolveUrl: mocks.pluginResolveUrl,
        probeUrl: mocks.pluginProbeUrl,
        health: mocks.pluginsHealth,
        healthReport: mocks.pluginsHealthReport,
      },
    };
    mocks.pluginsHealth.mockResolvedValue({});
    mocks.pluginsHealthReport.mockResolvedValue(undefined);
  };
  /** 按插件 id 分发取链响应，未匹配即失败，避免测试间串扰 */
  const dispatchResolve = (byId: Record<string, MusicUrlRes>): void => {
    mocks.pluginResolveUrl.mockImplementation(async (args: { pluginId: string }) => {
      const res = byId[args.pluginId];
      if (!res) throw new Error(`unexpected plugin: ${args.pluginId}`);
      return { ...res };
    });
  };

  beforeEach(() => {
    mocks.pluginResolveUrl.mockReset();
    mocks.pluginProbeUrl.mockReset();
    mocks.pluginsHealth.mockReset();
    mocks.pluginsHealthReport.mockReset();
  });

  it("QQ 母带：确认母带的 EM 按声明择优，url/体积/来源证据完整透传", async () => {
    // 用户实际场景：IKUN 注册在前同档位稳定胜出，EM 确认母带反被压过导致下载失败
    setupRealChain();
    mocks.pluginList = [txPlugin("ikun"), txPlugin("em")];
    dispatchResolve({ ikun: nakedJymaster("https://p/ikun.flac"), em: emMaster() });
    mocks.pluginProbeUrl.mockResolvedValue(probeOk());
    const res = await resolveDownloadSource(trackOf("qqmusic"), "jymaster", "qqmusic:master");
    expect(res).toEqual({
      ok: true,
      url: "https://p/em.flac",
      size: 42_000_000,
      qualityProvenance: {
        provider: "plugin",
        evidence: "plugin",
        platform: "qqmusic",
        pluginId: "em",
        sourceKey: "tx",
        platformEvidence: "source",
        nativeTier: "master",
        level: "jymaster",
      },
    });
    // 集成契约保持：平台具体选择仍按第五参透传真实解析器
    expect(mocks.resolveByPluginBest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "qqmusic" }),
      "jymaster",
      [],
      true,
      "qqmusic:master",
    );
  });

  it("QQ 母带：全部候选仅裸链接回执时早拒 DOWNLOAD_QUALITY_NOT_MET", async () => {
    // 无任何声明达标者：解析器兜底返回裸链接，下载入口按声明缺失显式拒绝
    setupRealChain();
    mocks.pluginList = [txPlugin("ikun")];
    dispatchResolve({ ikun: nakedJymaster("https://p/ikun.flac") });
    mocks.pluginProbeUrl.mockResolvedValue(probeOk());
    const res = await resolveDownloadSource(trackOf("qqmusic"), "jymaster", "qqmusic:master");
    expect(res).toEqual({ ok: false, errorCode: ErrorCode.DOWNLOAD_QUALITY_NOT_MET });
  });

  it("QQ 母带：声明候选探针硬拒时不落回裸链接，按探针拒绝收场", async () => {
    setupRealChain();
    mocks.pluginList = [txPlugin("ikun"), txPlugin("em")];
    dispatchResolve({ ikun: nakedJymaster("https://p/ikun.flac"), em: emMaster() });
    mocks.pluginProbeUrl.mockImplementation(async (args: { url: string }) =>
      args.url.includes("em.flac") ? probeHardReject() : probeOk(30_000_000),
    );
    const res = await resolveDownloadSource(trackOf("qqmusic"), "jymaster", "qqmusic:master");
    expect(res).toEqual({ ok: false, errorCode: ErrorCode.SOURCE_PROBE_REJECTED });
    // 确认候选进入声明池后裸链接已被剔除：探针只触达 EM，旧好链接不参与兜底
    expect(mocks.pluginProbeUrl).toHaveBeenCalledTimes(1);
    expect(mocks.pluginProbeUrl).toHaveBeenCalledWith({
      url: "https://p/em.flac",
      durationSec: 200,
    });
  });

  it("普通物理档 hq：旧插件无声明回执照常通过，元数据保留", async () => {
    // 物理档位不要求声明：请求回显类旧插件不受严检影响
    setupRealChain();
    mocks.pluginList = [wyPlugin("wy-a")];
    dispatchResolve({ "wy-a": { url: "https://p/hq.mp3", quality: "hq" } });
    mocks.pluginProbeUrl.mockResolvedValue(probeOk(5_000_000));
    const res = await resolveDownloadSource(trackOf("netease"), "hq");
    expect(res).toEqual({
      ok: true,
      url: "https://p/hq.mp3",
      size: 5_000_000,
      qualityProvenance: {
        provider: "plugin",
        evidence: "request",
        pluginId: "wy-a",
        sourceKey: "wy",
        level: "hq",
      },
    });
  });

  it("通用档位 URL 探针异常时按未探测处理，保留声明档位最高者", async () => {
    setupRealChain();
    mocks.pluginList = [wyPlugin("wy-a"), wyPlugin("wy-b")];
    dispatchResolve({
      "wy-a": { url: "https://p/a.mp3", quality: "hq" },
      "wy-b": { url: "https://p/b.mp3", quality: "hq", nativeTier: "320k" },
    });
    mocks.pluginProbeUrl.mockRejectedValue(new Error("probe crashed"));
    const res = await resolveDownloadSource(trackOf("netease"), "hq");
    expect(res).toEqual({
      ok: true,
      url: "https://p/a.mp3",
      qualityProvenance: {
        provider: "plugin",
        evidence: "request",
        pluginId: "wy-a",
        sourceKey: "wy",
        level: "hq",
      },
    });
  });
});
