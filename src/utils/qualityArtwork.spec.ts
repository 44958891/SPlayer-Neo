import { describe, expect, it } from "vitest";
import type { AudioQuality } from "@shared/types/player";
import type { PlatformQualityOption, QualityFamily, QualityLevel } from "@shared/types/quality";
import { PLATFORM_QUALITY_OPTIONS } from "@shared/utils/platformQuality";
import type { BrandedQualityTier } from "@shared/utils/qualityProvenance";
import { qualityArtworkFor, qualityArtworkForFamily } from "./qualityArtwork";
import { resolveQualityBadgeView } from "./qualityBadge";

/** 全部矢量类别，与共享 QualityFamily 覆盖面一致 */
const FAMILIES: readonly QualityFamily[] = [
  "standard",
  "higher",
  "hq",
  "lossless",
  "hi-res",
  "premium",
  "surround",
  "spatial",
  "spatial-plus",
  "master",
];

/** 构造有损规格文件
 * @param bitRate - 比特率
 * @returns MP3 音频参数
 */
const mp3 = (bitRate: number): AudioQuality => ({
  codec: "mp3",
  sampleRate: 44100,
  bitsPerSample: 16,
  bitRate,
  channels: 2,
});

/** 构造无损规格文件
 * @param sampleRate - 采样率
 * @param bitsPerSample - 位深
 * @returns FLAC 音频参数
 */
const flac = (sampleRate: number, bitsPerSample: number): AudioQuality => ({
  codec: "flac",
  sampleRate,
  bitsPerSample,
  bitRate: 1000000,
  channels: 2,
});

/** 各类别对应的规范文件规格：基础档按码率，无损以上按位深与采样率 */
const FAMILY_FIXTURES: Readonly<Record<QualityFamily, AudioQuality>> = {
  standard: mp3(128000),
  higher: mp3(192000),
  hq: mp3(320000),
  lossless: flac(44100, 16),
  "hi-res": flac(96000, 24),
  premium: flac(96000, 24),
  surround: flac(44100, 16),
  spatial: flac(44100, 16),
  "spatial-plus": flac(44100, 16),
  master: flac(192000, 24),
};

/** 品牌档位到类别的全部 17 项映射；level 取该品牌声明的通用档位，用于校验品牌含义优先 */
const TIER_FAMILY_CASES: readonly (readonly [BrandedQualityTier, QualityLevel, QualityFamily])[] = [
  ["netease-master", "jymaster", "master"],
  ["netease-sky", "sky", "spatial"],
  ["netease-surround", "jyeffect", "surround"],
  ["qq-master", "jymaster", "master"],
  ["qq-master-4", "jymaster", "master"],
  ["qq-premium", "sky", "premium"],
  ["qq-spatial", "sky", "spatial"],
  ["qq-spatial-2", "sky", "spatial-plus"],
  ["kuwo-master", "jymaster", "master"],
  ["kuwo-master-quality", "jymaster", "master"],
  ["kuwo-premium", "sky", "premium"],
  ["kuwo-spatial", "sky", "spatial"],
  ["kugou-master", "jymaster", "master"],
  ["kugou-spatial", "sky", "spatial"],
  ["migu-master", "jymaster", "master"],
  ["migu-premium", "hi-res", "premium"],
  ["migu-spatial", "sky", "spatial"],
];

/** 通用档位到类别的全部 8 项映射 */
const LEVEL_FAMILY_CASES: readonly (readonly [QualityLevel, QualityFamily])[] = [
  ["lq", "standard"],
  ["sq", "higher"],
  ["hq", "hq"],
  ["lossless", "lossless"],
  ["hi-res", "hi-res"],
  ["jyeffect", "surround"],
  ["sky", "spatial"],
  ["jymaster", "master"],
];

/** 全部平台目录选项，共 29 项 */
const ALL_OPTIONS: readonly PlatformQualityOption[] =
  Object.values(PLATFORM_QUALITY_OPTIONS).flat();

/** 按目录选项构造已确认来源的徽标视图：level 与 nativeTier 均取自选项，规格与选项类别一致
 * @param option - 平台音质选项
 * @returns 无矛盾的徽标视图
 */
const viewForOption = (option: PlatformQualityOption) =>
  resolveQualityBadgeView(FAMILY_FIXTURES[option.family], {
    provider: "plugin",
    platform: option.platform,
    nativeTier: option.nativeTier,
    level: option.level,
    evidence: "plugin",
  });

describe("统一音质矢量图形", () => {
  it("只导出 family 与 paths，不携带任何位图字段", () => {
    expect(Object.keys(qualityArtworkFor({ level: "jymaster", mismatch: false })).sort()).toEqual([
      "family",
      "paths",
    ]);
    expect(Object.keys(qualityArtworkForFamily("master")).sort()).toEqual(["family", "paths"]);
  });

  it.each(FAMILIES)("%s 图形由纯矢量路径数据组成", (family) => {
    const { paths } = qualityArtworkForFamily(family);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toMatch(/^[a-z0-9 ,.-]+$/i);
    }
  });

  it("除 spatial-plus 复用 spatial 外，各类别图形互不相同", () => {
    const glyphs = FAMILIES.filter((family) => family !== "spatial-plus").map((family) =>
      qualityArtworkForFamily(family).paths.join("|"),
    );
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("spatial-plus 与 spatial 使用同一组路径", () => {
    expect(qualityArtworkForFamily("spatial-plus").paths).toBe(
      qualityArtworkForFamily("spatial").paths,
    );
  });

  it.each(LEVEL_FAMILY_CASES)("通用档位 %s 归入 %s 类别", (level, family) => {
    const artwork = qualityArtworkFor({ level, mismatch: false });
    expect(artwork.family).toBe(family);
    expect(artwork.paths).toBe(qualityArtworkForFamily(family).paths);
  });

  it.each(TIER_FAMILY_CASES)("品牌档位 %s 归入目标类别", (tier, level, family) => {
    expect(qualityArtworkFor({ level, tier, mismatch: false }).family).toBe(family);
  });

  it("QQ 臻品音质归入 premium 类别，不落回 spatial", () => {
    const artwork = qualityArtworkFor({ level: "sky", tier: "qq-premium", mismatch: false });
    expect(artwork.family).toBe("premium");
    expect(artwork.family).not.toBe("spatial");
  });

  it("全景声 2.0 档与普通全景声共用同一图形，仅类别名区分", () => {
    const plus = qualityArtworkFor({ level: "sky", tier: "qq-spatial-2", mismatch: false });
    expect(plus.family).toBe("spatial-plus");
    expect(plus.paths).toBe(qualityArtworkForFamily("spatial").paths);
    expect(plus.paths).toBe(qualityArtworkForFamily("spatial-plus").paths);
  });

  it("实测矛盾时忽略品牌档位，按实际等级取图形", () => {
    const contradicted = qualityArtworkFor({ level: "sky", tier: "qq-master", mismatch: true });
    expect(contradicted.family).toBe("spatial");
    expect(contradicted.paths).toBe(qualityArtworkForFamily("spatial").paths);
    expect(qualityArtworkFor({ level: "sky", tier: "qq-master", mismatch: false }).family).toBe(
      "master",
    );
  });

  it("本地无来源文件按实测等级取图形，永远有统一矢量结果", () => {
    const local = qualityArtworkFor({ level: "hi-res", tier: undefined, mismatch: false });
    expect(local.family).toBe("hi-res");
    expect(local.paths.length).toBeGreaterThan(0);
    expect(local.paths).toBe(qualityArtworkForFamily("hi-res").paths);
  });
});

describe("平台目录图形覆盖", () => {
  it("目录共 29 项，各平台为 网易8 / QQ7 / 酷狗6 / 酷我4 / 咪咕4", () => {
    expect(ALL_OPTIONS).toHaveLength(29);
    expect(PLATFORM_QUALITY_OPTIONS.netease).toHaveLength(8);
    expect(PLATFORM_QUALITY_OPTIONS.qqmusic).toHaveLength(7);
    expect(PLATFORM_QUALITY_OPTIONS.kugou).toHaveLength(6);
    expect(PLATFORM_QUALITY_OPTIONS.kuwo).toHaveLength(4);
    expect(PLATFORM_QUALITY_OPTIONS.migu).toHaveLength(4);
  });

  it.each(ALL_OPTIONS)("$id 按 $family 规格解析出对应类别图形", (option) => {
    const view = viewForOption(option);
    expect(view.mismatch).toBe(false);
    const artwork = qualityArtworkFor(view);
    expect(artwork.family).toBe(option.family);
    expect(artwork.paths).toBe(qualityArtworkForFamily(option.family).paths);
  });

  it("同一类别在所有平台使用完全相同的图形", () => {
    const byFamily = new Map<QualityFamily, PlatformQualityOption[]>();
    for (const option of ALL_OPTIONS) {
      byFamily.set(option.family, [...(byFamily.get(option.family) ?? []), option]);
    }
    for (const [family, options] of byFamily) {
      const paths = qualityArtworkForFamily(family).paths;
      for (const option of options) {
        expect(qualityArtworkFor(viewForOption(option)).paths, option.id).toBe(paths);
      }
    }
    // 无损在全部五个平台都存在，图形不再按平台区分
    expect(
      byFamily
        .get("lossless")!
        .map((option) => option.platform)
        .sort(),
    ).toEqual(["kugou", "kuwo", "migu", "netease", "qqmusic"]);
  });

  it("酷狗母带按 hi-res 规格回执不判矛盾，仍归母带类别", () => {
    const view = resolveQualityBadgeView(flac(96000, 24), {
      provider: "plugin",
      platform: "kugou",
      nativeTier: "kugou-master",
      level: "jymaster",
      evidence: "plugin",
    });
    expect(view.mismatch).toBe(false);
    expect(qualityArtworkFor(view).family).toBe("master");
  });

  it("网易母带声明配 hi-res 规格文件判为矛盾，回退实际等级图形", () => {
    const view = resolveQualityBadgeView(flac(96000, 24), {
      provider: "official",
      platform: "netease",
      nativeTier: "jymaster",
      evidence: "response",
    });
    expect(view.mismatch).toBe(true);
    expect(qualityArtworkFor(view).family).toBe("hi-res");
  });

  it("酷我 kuwo-master 保留历史母带语义，类别仍为 master", () => {
    const view = resolveQualityBadgeView(FAMILY_FIXTURES.master, {
      provider: "plugin",
      platform: "kuwo",
      nativeTier: "kuwo-master",
      level: "jymaster",
      evidence: "plugin",
    });
    expect(view.tier).toBe("kuwo-master");
    expect(qualityArtworkFor(view).family).toBe("master");
  });
});
