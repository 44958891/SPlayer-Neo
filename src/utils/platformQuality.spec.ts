import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { PluginInfo } from "@shared/types/plugin";
import type { QualityLevel } from "@shared/types/quality";
import { ALL_PLATFORMS } from "@shared/types/platform";
import {
  PLATFORM_QUALITY_OPTIONS,
  canDownloadQualityOption,
  canPlayQualityOption,
  collectQualityCapabilities,
  findPlatformQuality,
  platformOf,
} from "./platformQuality";

/** 构造就绪音源插件 */
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

const trackOf = (source: Platform): Track => ({
  id: "1",
  source,
  title: "歌",
  artists: [{ id: "a", name: "歌手" }],
  duration: 200000,
});

describe("平台音质目录", () => {
  it("五个平台各有独立菜单，选项 id 带平台前缀，总量恰 29 档", () => {
    const expectedTiers: Record<Platform, number> = {
      netease: 8,
      qqmusic: 7,
      kugou: 6,
      kuwo: 4,
      migu: 4,
    };
    for (const platform of ALL_PLATFORMS) {
      const options = PLATFORM_QUALITY_OPTIONS[platform];
      expect(options.length).toBe(expectedTiers[platform]);
      for (const option of options) {
        expect(option.platform).toBe(platform);
        expect(option.id).toBe(`${platform}:${option.nativeTier}`);
        expect(option.labelKey).toBe(`quality.option.${platform}.${option.family}`);
      }
    }
    expect(ALL_PLATFORMS.reduce((sum, p) => sum + PLATFORM_QUALITY_OPTIONS[p].length, 0)).toBe(29);
  });

  it("菜单不串平台：QQ 无臻品增强/环绕声，实测档位分布保持", () => {
    const qqTiers = PLATFORM_QUALITY_OPTIONS.qqmusic.map((option) => option.nativeTier);
    expect(qqTiers).not.toContain("jyeffect");
    expect(qqTiers).not.toContain("sky");
    const qqFamilies = PLATFORM_QUALITY_OPTIONS.qqmusic.map((option) => option.family);
    expect(qqFamilies).not.toContain("premium");
    expect(qqFamilies).not.toContain("surround");
    expect(qqFamilies).toContain("spatial");
    expect(qqFamilies).toContain("spatial-plus");
    const neteaseFamilies = PLATFORM_QUALITY_OPTIONS.netease.map((option) => option.family);
    expect(neteaseFamilies).toContain("surround");
    expect(neteaseFamilies).toContain("spatial");
    // 每个平台都有基础物理档；HiRes 除酷我、母带除咪咕，空间档限网易/QQ/酷狗
    for (const platform of ALL_PLATFORMS) {
      const families = PLATFORM_QUALITY_OPTIONS[platform].map((option) => option.family);
      for (const base of ["standard", "hq", "lossless"]) {
        expect(families, `${platform} 缺少 ${base}`).toContain(base);
      }
      if (platform !== "kuwo") expect(families, `${platform} 缺少 hi-res`).toContain("hi-res");
      if (platform !== "migu") expect(families, `${platform} 缺少 master`).toContain("master");
      if (platform === "netease" || platform === "qqmusic" || platform === "kugou") {
        expect(families, `${platform} 缺少 spatial`).toContain("spatial");
      } else {
        expect(families, `${platform} 不应含 spatial`).not.toContain("spatial");
      }
    }
  });

  it("findPlatformQuality 只在匹配平台时命中", () => {
    expect(findPlatformQuality("netease:sky", "netease")?.family).toBe("spatial");
    expect(findPlatformQuality("netease:sky", "qqmusic")).toBeUndefined();
    expect(findPlatformQuality(undefined)).toBeUndefined();
    // 旧母带选择归一到 qqmusic:master，跨平台仍拒绝
    expect(findPlatformQuality("qqmusic:qq-master-4.0", "qqmusic")?.id).toBe("qqmusic:master");
    expect(findPlatformQuality("qqmusic:qq-master-2.0", "netease")).toBeUndefined();
  });
});

describe("插件能力汇总", () => {
  it("无就绪插件 → hasPlugin=false", () => {
    const caps = collectQualityCapabilities("netease", [plugin("p", "tx")]);
    expect(caps.hasPlugin).toBe(false);
    expect(caps.declared).toBe(false);
  });

  it("旧脚本未声明任何档位 → hasUndeclaredPlugin，declared=false", () => {
    const caps = collectQualityCapabilities("netease", [plugin("old", "wy")]);
    expect(caps.hasPlugin).toBe(true);
    expect(caps.hasUndeclaredPlugin).toBe(true);
    expect(caps.declared).toBe(false);
  });

  it("多插件混合：旧脚本 + 仅声明 128k 的脚本 → 并集保留且存在未声明者", () => {
    const caps = collectQualityCapabilities("qqmusic", [
      plugin("oldA", "tx"),
      plugin("b", "tx", { qualities: ["lq"], nativeQualities: ["128k"] }),
    ]);
    expect(caps.hasPlugin).toBe(true);
    expect(caps.declared).toBe(true);
    expect(caps.hasUndeclaredPlugin).toBe(true);
    expect([...(caps.nativeTiers ?? [])]).toEqual(["128k"]);
    expect(caps.levels?.has("lq")).toBe(true);
  });

  it("忽略未启用与未就绪的插件", () => {
    const disabled = plugin("x", "wy");
    disabled.enabled = false;
    const loading: PluginInfo = {
      ...plugin("y", "wy", { nativeQualities: ["flac"] }),
      status: { state: "loading" },
    };
    const caps = collectQualityCapabilities("netease", [disabled, loading]);
    expect(caps.hasPlugin).toBe(false);
  });
});

const neteaseLossless = findPlatformQuality("netease:lossless", "netease")!;

describe("播放菜单可用性", () => {
  const neteaseSky = findPlatformQuality("netease:sky", "netease")!;
  const kugouMaster = findPlatformQuality("kugou:kugou-master", "kugou")!;

  it("官方档位在任何插件状态下都可用", () => {
    expect(
      canPlayQualityOption(neteaseLossless, {
        hasPlugin: false,
        hasUndeclaredPlugin: false,
        declared: false,
      }),
    ).toBe(true);
    expect(
      canPlayQualityOption(neteaseSky, {
        hasPlugin: false,
        hasUndeclaredPlugin: false,
        declared: false,
      }),
    ).toBe(true);
  });

  it("插件专属档位：无插件不可用；声明覆盖后可用", () => {
    expect(
      canPlayQualityOption(kugouMaster, {
        hasPlugin: false,
        hasUndeclaredPlugin: false,
        declared: false,
      }),
    ).toBe(false);
    const declared = collectQualityCapabilities("kugou", [
      plugin("p", "kg", { nativeQualities: ["Kugou-Master"] }),
    ]);
    expect(canPlayQualityOption(kugouMaster, declared)).toBe(true);
    const other = collectQualityCapabilities("kugou", [
      plugin("p", "kg", { nativeQualities: ["320k"] }),
    ]);
    expect(canPlayQualityOption(kugouMaster, other)).toBe(false);
  });

  it("精确增强/空间档必须命中原生声明；母带统一目标按归一候选命中", () => {
    const undeclared = collectQualityCapabilities("netease", [plugin("old", "wy")]);
    expect(canPlayQualityOption(neteaseSky, undeclared)).toBe(true); // 官方档不受影响
    // QQ 母带统一目标：规范 id 与旧 4.0 选择都归一到 qqmusic:master，需要插件声明
    const qqMaster = findPlatformQuality("qqmusic:master", "qqmusic")!;
    const qqLegacy4 = findPlatformQuality("qqmusic:qq-master-4.0", "qqmusic")!;
    expect(qqMaster.id).toBe("qqmusic:master");
    expect(qqLegacy4.id).toBe("qqmusic:master");
    expect(qqLegacy4.nativeTier).toBe("master");
    expect(
      canPlayQualityOption(qqMaster, {
        hasPlugin: false,
        hasUndeclaredPlugin: false,
        declared: false,
      }),
    ).toBe(false);
    const qqUndeclared = collectQualityCapabilities("qqmusic", [plugin("old", "tx")]);
    expect(canDownloadQualityOption(qqMaster, qqUndeclared)).toBe(false);
    // 统一后旧 2.0/4.0 历史回执与 generic master 都是母带候选
    const legacy2Hit = collectQualityCapabilities("qqmusic", [
      plugin("p", "tx", { nativeQualities: ["qq-master-2.0", "QQ-Master-4.0"] }),
    ]);
    expect(canDownloadQualityOption(qqLegacy4, legacy2Hit)).toBe(true);
    const genericHit = collectQualityCapabilities("qqmusic", [
      plugin("p", "tx", { nativeQualities: ["Master"] }),
    ]);
    expect(canDownloadQualityOption(qqMaster, genericHit)).toBe(true);
    expect(canPlayQualityOption(qqLegacy4, genericHit)).toBe(true);
    const kugouSky = findPlatformQuality("kugou:kugou-spatial", "kugou")!;
    const atmosMiss = collectQualityCapabilities("kugou", [
      plugin("p", "kg", { nativeQualities: ["flac"] }),
    ]);
    expect(canPlayQualityOption(kugouSky, atmosMiss)).toBe(false);
    const atmosHit = collectQualityCapabilities("kugou", [
      plugin("p", "kg", { nativeQualities: ["atmos_plus"] }),
    ]);
    expect(canPlayQualityOption(kugouSky, atmosHit)).toBe(true);
    // QQ 全景声只认 atmos；atmos_plus 属于 2.0 档，不点亮普通全景声
    const qqSpatial = findPlatformQuality("qqmusic:qq-spatial", "qqmusic")!;
    const qqFlacOnly = collectQualityCapabilities("qqmusic", [
      plugin("p", "tx", { nativeQualities: ["flac"] }),
    ]);
    expect(canPlayQualityOption(qqSpatial, qqFlacOnly)).toBe(false);
    const qqAtmosHit = collectQualityCapabilities("qqmusic", [
      plugin("p", "tx", { nativeQualities: ["Atmos"] }),
    ]);
    expect(canPlayQualityOption(qqSpatial, qqAtmosHit)).toBe(true);
    const qqAtmosPlusOnly = collectQualityCapabilities("qqmusic", [
      plugin("p", "tx", { nativeQualities: ["atmos_plus"] }),
    ]);
    expect(canPlayQualityOption(qqSpatial, qqAtmosPlusOnly)).toBe(false);
    const qqPlusHit = collectQualityCapabilities("qqmusic", [
      plugin("p", "tx", { nativeQualities: ["atmos_plus"] }),
    ]);
    const qqSpatialPlus = findPlatformQuality("qqmusic:qq-spatial-2.0", "qqmusic")!;
    expect(canPlayQualityOption(qqSpatialPlus, qqPlusHit)).toBe(true);
  });

  it("酷我母带为插件专属且需要明确声明", () => {
    const kuwoMaster = findPlatformQuality("kuwo:kuwo-master", "kuwo")!;
    expect(kuwoMaster.official).toBe(false);
    expect(kuwoMaster.requiresDeclaration).toBe(true);
    expect(kuwoMaster.minimumLevel).toBe("jymaster");
    expect(
      canPlayQualityOption(kuwoMaster, {
        hasPlugin: false,
        hasUndeclaredPlugin: false,
        declared: false,
      }),
    ).toBe(false);
    const undeclared = collectQualityCapabilities("kuwo", [plugin("old", "kw")]);
    expect(canDownloadQualityOption(kuwoMaster, undeclared)).toBe(false);
    const hit = collectQualityCapabilities("kuwo", [
      plugin("p", "kw", { nativeQualities: ["Master"] }),
    ]);
    expect(canDownloadQualityOption(kuwoMaster, hit)).toBe(true);
  });
});

describe("下载菜单可用性", () => {
  const neteaseJyeffect = findPlatformQuality("netease:jyeffect", "netease")!;
  const neteaseMaster = findPlatformQuality("netease:jymaster", "netease")!;
  const neteaseExhigh = findPlatformQuality("netease:exhigh", "netease")!;

  it("下载全走插件：无插件时所有档位不可用（含官方档）", () => {
    const caps = { hasPlugin: false, hasUndeclaredPlugin: false, declared: false };
    expect(canDownloadQualityOption(neteaseLossless, caps)).toBe(false);
    expect(canDownloadQualityOption(neteaseJyeffect, caps)).toBe(false);
  });

  it("精确环绕声档需要任一插件的原生声明", () => {
    const miss = collectQualityCapabilities("netease", [
      plugin("p", "wy", { nativeQualities: ["flac"] }),
    ]);
    expect(canDownloadQualityOption(neteaseJyeffect, miss)).toBe(false);
    const hit = collectQualityCapabilities("netease", [
      plugin("p", "wy", { nativeQualities: ["jyeffect"] }),
    ]);
    expect(canDownloadQualityOption(neteaseJyeffect, hit)).toBe(true);
  });

  it("物理档：存在未声明旧脚本时放行（多插件场景不被另一脚本的小并集误杀）", () => {
    const mixed = collectQualityCapabilities("netease", [
      plugin("oldA", "wy"),
      plugin("b", "wy", { qualities: ["lq"], nativeQualities: ["128k"] }),
    ]);
    expect(canDownloadQualityOption(neteaseMaster, mixed)).toBe(true);
    expect(canDownloadQualityOption(neteaseExhigh, mixed)).toBe(true);
    // 全部插件都声明过且未覆盖目标 → 不可用
    const declaredOnly = collectQualityCapabilities("netease", [
      plugin("b", "wy", { qualities: ["lq"], nativeQualities: ["128k"] }),
    ]);
    expect(canDownloadQualityOption(neteaseMaster, declaredOnly)).toBe(false);
    expect(canDownloadQualityOption(neteaseExhigh, declaredOnly)).toBe(false);
    // 声明覆盖目标 → 可用
    const covered = collectQualityCapabilities("netease", [
      plugin("b", "wy", { qualities: ["hq"], nativeQualities: ["320k", "master"] }),
    ]);
    expect(canDownloadQualityOption(neteaseExhigh, covered)).toBe(true);
    expect(canDownloadQualityOption(neteaseMaster, covered)).toBe(true);
  });
});

describe("platformOf", () => {
  it("支持曲目对象与来源字符串", () => {
    expect(platformOf(trackOf("kuwo"))).toBe("kuwo");
    expect(platformOf("migu")).toBe("migu");
    expect(platformOf("streaming")).toBeUndefined();
    expect(platformOf("plugin")).toBeUndefined();
    expect(platformOf(undefined)).toBeUndefined();
  });
});
