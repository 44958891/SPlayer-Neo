import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { DownloadTask } from "@shared/types/download";
import type { PluginInfo } from "@shared/types/plugin";
import type { QualityLevel } from "@shared/types/quality";

const mocks = vi.hoisted(() => {
  return {
    settings: {
      player: { songLevel: "hq" as string, songQualitySelection: undefined as string | undefined },
      system: {
        download: {
          enabled: true,
          quality: "hq",
          qualitySelection: undefined as string | undefined,
          embedCover: true,
          embedMeta: true,
          embedLyric: true,
          writeLrc: false,
          saveTtml: false,
          lyricFileFormat: "lrc" as "lrc" | "enhanced-lrc",
        },
      },
    },
    plugins: { list: [] as PluginInfo[] },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    downloadApi: { start: vi.fn(), startMany: vi.fn(), retry: vi.fn() },
  };
});

vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => mocks.plugins }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

/** 构造就绪插件 */
const plugin = (
  id: string,
  pluginSource: string,
  opts: { qualities?: QualityLevel[]; nativeQualities?: string[] } = {},
): PluginInfo => ({
  manifest: {
    id,
    name: id,
    version: "1.0.0",
    grant: [],
    apiLevel: 1,
    hash: "h",
    installedAt: 0,
    fileName: `${id}.js`,
  },
  enabled: true,
  status: {
    state: "ready",
    sources: {
      [pluginSource]: {
        name: pluginSource,
        actions: ["musicUrl"],
        ...(opts.qualities ? { qualities: opts.qualities } : {}),
        ...(opts.nativeQualities ? { nativeQualities: opts.nativeQualities } : {}),
      },
    },
  },
});

const trackOf = (source: Track["source"]): Track => ({
  id: `${source}-1`,
  source,
  title: "歌",
  artists: [{ id: "a", name: "歌手" }],
  duration: 200000,
});

import { buildDownloadQualityItems, resolveDownloadTarget, useDownload } from "./useDownload";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.player = { songLevel: "hq", songQualitySelection: undefined };
  mocks.settings.system.download.quality = "hq";
  mocks.settings.system.download.qualitySelection = undefined;
  mocks.plugins.list = [];
  mocks.downloadApi.start.mockResolvedValue({ ok: true });
  mocks.downloadApi.startMany.mockResolvedValue([{ ok: true }]);
  mocks.downloadApi.retry.mockResolvedValue({ ok: true });
  Object.assign(window, { api: { download: mocks.downloadApi } });
});

describe("旧默认目标兼容映射（resolveDownloadTarget）", () => {
  it("全局 hq 无具体选择 → 五个平台各自映射本平台 HQ 档", () => {
    const expected: Record<string, string> = {
      netease: "netease:exhigh",
      qqmusic: "qqmusic:M800",
      kugou: "kugou:320",
      kuwo: "kuwo:320kmp3",
      migu: "migu:HQ",
    };
    for (const [platform, id] of Object.entries(expected)) {
      const target = resolveDownloadTarget(platform as Platform, "hq", undefined);
      expect(target.ok).toBe(true);
      if (!target.ok) continue;
      expect(target.qualitySelection).toBe(id);
      expect(target.level).toBe("hq");
    }
  });

  it("全局 sq 在缺较高档的平台回落 HQ（不静默降为标准）", () => {
    const migu = resolveDownloadTarget("migu", "sq", undefined);
    expect(migu.ok && migu.qualitySelection).toBe("migu:HQ");
    const netease = resolveDownloadTarget("netease", "sq", undefined);
    expect(netease.ok && netease.qualitySelection).toBe("netease:higher");
  });

  it("环绕声目标落到无环绕声的平台 → 判定不支持，不静默降级", () => {
    expect(resolveDownloadTarget("qqmusic", "jyeffect", undefined)).toEqual({
      ok: false,
      reason: "unsupported",
    });
    // 网易有环绕声档 → 正常映射
    const netease = resolveDownloadTarget("netease", "jyeffect", undefined);
    expect(netease.ok && netease.qualitySelection).toBe("netease:jyeffect");
  });

  it("跨平台已存选择按意图映射到本平台，无对应音效则拒绝", () => {
    // QQ 恢复全景声：空间意图映射到具体全景声档
    const qq = resolveDownloadTarget("qqmusic", "hq", "netease:sky");
    expect(qq.ok && qq.qualitySelection).toBe("qqmusic:qq-spatial");
    // 酷我已移除空间档：空间意图不再映射，显式不支持
    const kuwo = resolveDownloadTarget("kuwo", "hq", "netease:sky");
    expect(kuwo).toEqual({ ok: false, reason: "unsupported" });
    // 空间意图映射到仍有该音效的平台
    const netease = resolveDownloadTarget("netease", "hq", "kugou:kugou-spatial");
    expect(netease.ok && netease.qualitySelection).toBe("netease:sky");
  });

  it("QQ 旧臻品/已移除酷我音效的存档选择不再跨平台映射（kw4 已无对应档）", () => {
    const premium = resolveDownloadTarget("kuwo", "hq", "qqmusic:qq-premium-2.0");
    expect(premium).toEqual({ ok: false, reason: "unsupported" });
    const spatial = resolveDownloadTarget("kuwo", "hq", "qqmusic:qq-spatial");
    expect(spatial).toEqual({ ok: false, reason: "unsupported" });
  });

  it("旧母带 2.0 显式选择归一到母带 4.0 目标", () => {
    const target = resolveDownloadTarget("qqmusic", "hq", undefined, {
      qualitySelection: "qqmusic:qq-master-2.0",
    });
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.qualitySelection).toBe("qqmusic:qq-master-4.0");
    expect(target.level).toBe("jymaster");
  });

  it("显式旧档位覆盖时忽略全局具体选择，只按档位映射", () => {
    const target = resolveDownloadTarget("netease", "hq", "netease:sky", { quality: "lossless" });
    expect(target.ok && target.qualitySelection).toBe("netease:lossless");
  });

  it("显式平台选择匹配平台时原样透传", () => {
    const target = resolveDownloadTarget("netease", "hq", undefined, {
      qualitySelection: "netease:lossless",
    });
    expect(target.ok && target.qualitySelection).toBe("netease:lossless");
    // QQ 全景声 plain/plus 均为本平台合法档
    const plain = resolveDownloadTarget("qqmusic", "hq", undefined, {
      qualitySelection: "qqmusic:qq-spatial",
    });
    expect(plain.ok && plain.qualitySelection).toBe("qqmusic:qq-spatial");
    const plus = resolveDownloadTarget("qqmusic", "hq", undefined, {
      qualitySelection: "qqmusic:qq-spatial-2.0",
    });
    expect(plus.ok && plus.qualitySelection).toBe("qqmusic:qq-spatial-2.0");
  });

  it.each([
    "netease:sky",
    "qqmusic:missing",
    "invalid:value",
    "qqmusic:qq-premium-2.0",
    "kuwo:kuwo-premium-2.0",
  ])("QQ 的显式选择 %s 无效时直接拒绝", (qualitySelection) => {
    expect(resolveDownloadTarget("qqmusic", "hq", undefined, { qualitySelection })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("非在线平台（流媒体）保持旧通用档位且无平台选择", () => {
    const target = resolveDownloadTarget(undefined, "lossless", "netease:lossless");
    expect(target).toEqual({ ok: true, level: "lossless" });
  });
});

describe("下载菜单（buildDownloadQualityItems）", () => {
  it("五平台菜单只含本平台条目，key 为 download:<选择标识>", () => {
    for (const platform of ["netease", "qqmusic", "kugou", "kuwo", "migu"] as const) {
      const items = buildDownloadQualityItems("跟随默认", "download:", platform);
      // 默认项 + 平台目录；默认项展示该平台实际映射到的目标（非裸的全局档位）
      expect(items[0].key).toBe("download:");
      expect(items[0].label).toContain("跟随默认");
      expect(items[0].label).not.toBe("跟随默认");
      const keys = items.slice(1).map((item) => item.key);
      expect(keys).toHaveLength(PLATFORM_CATALOG_LENGTH[platform]);
      for (const key of keys) {
        expect(key.startsWith(`download:${platform}:`)).toBe(true);
      }
    }
  });

  it("QQ 菜单含母带4.0与全景声 plain/plus，不含已下线臻品与网易专属档", () => {
    const items = buildDownloadQualityItems("跟随默认", "download:", "qqmusic");
    const keys = items.slice(1).map((item) => item.key);
    expect(keys).toContain("download:qqmusic:qq-master-4.0");
    expect(keys).toContain("download:qqmusic:qq-spatial");
    expect(keys).toContain("download:qqmusic:qq-spatial-2.0");
    expect(
      items.some(
        (item) =>
          item.key.includes("jyeffect") ||
          item.key.includes("netease:sky") ||
          item.key.includes("qq-premium-2.0"),
      ),
    ).toBe(false);
  });

  it("酷我菜单只含 kw4 四档，不含已移除的 hires/premium/全景声", () => {
    const items = buildDownloadQualityItems("跟随默认", "download:", "kuwo");
    const keys = items.slice(1).map((item) => item.key);
    expect(keys).toEqual([
      "download:kuwo:128kmp3",
      "download:kuwo:320kmp3",
      "download:kuwo:flac",
      "download:kuwo:kuwo-master",
    ]);
  });

  it("无插件 → 全部档位置灰并标注需音源插件", () => {
    const items = buildDownloadQualityItems("跟随默认", "download:", "netease");
    for (const item of items.slice(1)) {
      expect(item.disabled).toBe(true);
      expect(item.label).toContain("需音源插件支持");
    }
  });

  it("旧脚本未声明档位 → 物理档可用、增强/空间档置灰标注未声明", () => {
    mocks.plugins.list = [plugin("old", "wy")];
    const items = buildDownloadQualityItems("跟随默认", "download:", "netease");
    const byTier = new Map(items.map((item) => [item.key, item]));
    expect(byTier.get("download:netease:lossless")?.disabled).toBe(false);
    expect(byTier.get("download:netease:standard")?.disabled).toBe(false);
    expect(byTier.get("download:netease:jyeffect")?.disabled).toBe(true);
    expect(byTier.get("download:netease:jyeffect")?.label).toContain("当前音源未声明支持");
    expect(byTier.get("download:netease:sky")?.disabled).toBe(true);
  });

  it("声明覆盖的插件放行精确档位", () => {
    mocks.plugins.list = [plugin("p", "wy", { nativeQualities: ["jyeffect", "flac"] })];
    const items = buildDownloadQualityItems("跟随默认", "download:", "netease");
    const byTier = new Map(items.map((item) => [item.key, item]));
    expect(byTier.get("download:netease:jyeffect")?.disabled).toBe(false);
    expect(byTier.get("download:netease:lossless")?.disabled).toBe(false);
    expect(byTier.get("download:netease:sky")?.disabled).toBe(true);
  });

  it("无平台上下文（流媒体）回落旧通用档位菜单", () => {
    const items = buildDownloadQualityItems("跟随默认", "download:", "streaming");
    expect(items[0]).toEqual({ key: "download:", label: "跟随默认" });
    expect(items.some((item) => item.key === "download:jymaster")).toBe(true);
    expect(items.every((item) => item.disabled === undefined)).toBe(true);
  });
});

/** 各平台目录档数：wy8 / kg6 不变；qq7、kw4、mg4 为本轮新目录 */
const PLATFORM_CATALOG_LENGTH: Record<string, number> = {
  netease: 8,
  qqmusic: 7,
  kugou: 6,
  kuwo: 4,
  migu: 4,
};

describe("入队与批量", () => {
  it("单曲入队携带平台具体选择与映射后的档位", async () => {
    const { enqueue } = useDownload();
    const ok = await enqueue(trackOf("netease"), { qualitySelection: "netease:lossless" });
    expect(ok).toBe(true);
    expect(mocks.downloadApi.start).toHaveBeenCalledTimes(1);
    const req = mocks.downloadApi.start.mock.calls[0][0];
    expect(req.qualityLevel).toBe("lossless");
    expect(req.qualitySelection).toBe("netease:lossless");
  });

  it("平台不支持目标 → 显式报错不入队，不静默降级", async () => {
    const { enqueue } = useDownload();
    mocks.settings.system.download.quality = "jyeffect";
    const ok = await enqueue(trackOf("qqmusic"));
    expect(ok).toBe(false);
    expect(mocks.downloadApi.start).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalled();
  });

  it("混合批量：各按自身平台映射默认目标，不支持的平台单独计数上报", async () => {
    const { enqueueMany } = useDownload();
    mocks.settings.system.download.quality = "jyeffect"; // 仅网易有环绕声
    await enqueueMany([trackOf("netease"), trackOf("qqmusic"), trackOf("kugou")]);
    expect(mocks.downloadApi.startMany).toHaveBeenCalledTimes(1);
    const requests = mocks.downloadApi.startMany.mock.calls[0][0];
    expect(requests).toHaveLength(1);
    expect(requests[0].qualitySelection).toBe("netease:jyeffect");
    expect(requests[0].qualityLevel).toBe("jyeffect");
    expect(mocks.toast.success).toHaveBeenCalled();
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining("2"));
  });

  it("重试沿用任务保存的选择与 taskId", async () => {
    const { retry } = useDownload();
    const task = {
      taskId: "task-1",
      status: "failed",
      track: trackOf("kugou"),
      qualityLevel: "jymaster",
      qualitySelection: "kugou:kugou-master",
    } as DownloadTask;
    await retry(task);
    expect(mocks.downloadApi.retry).toHaveBeenCalledTimes(1);
    const req = mocks.downloadApi.retry.mock.calls[0][0];
    expect(req.taskId).toBe("task-1");
    expect(req.qualityLevel).toBe("jymaster");
    expect(req.qualitySelection).toBe("kugou:kugou-master");
  });

  it("旧请求兼容：只有通用档位时映射本平台目标且带选择标识", async () => {
    const { enqueue } = useDownload();
    await enqueue(trackOf("kuwo"), { quality: "lossless" });
    const req = mocks.downloadApi.start.mock.calls[0][0];
    expect(req.qualityLevel).toBe("lossless");
    expect(req.qualitySelection).toBe("kuwo:flac");
  });
});
