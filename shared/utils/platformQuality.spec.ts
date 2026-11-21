import { describe, expect, it } from "vitest";
import { ALL_PLATFORMS } from "../types/platform";
import {
  PLATFORM_QUALITY_OPTIONS,
  declaredQualitySupports,
  findPlatformQuality,
  normalizeStoredQualitySelection,
  resolvePlatformQuality,
  upgradePlatformQuality,
} from "./platformQuality";

describe("平台音质选项与默认目标", () => {
  it("每个平台只使用自己的选择标识，QQ 不出现网易环绕档", () => {
    for (const platform of ALL_PLATFORMS) {
      const options = PLATFORM_QUALITY_OPTIONS[platform];
      expect(new Set(options.map((item) => item.id)).size).toBe(options.length);
      expect(
        options.every((item) => item.platform === platform && item.id.startsWith(`${platform}:`)),
      ).toBe(true);
    }
    expect(PLATFORM_QUALITY_OPTIONS.qqmusic.some((item) => item.family === "surround")).toBe(false);
    expect(findPlatformQuality("netease:jyeffect", "qqmusic")).toBeUndefined();
  });

  it("菜单恰为 EM 实测 29 档：netease 8 / qqmusic 7 / kugou 6 / kuwo 4 / migu 4", () => {
    const expected: Record<(typeof ALL_PLATFORMS)[number], number> = {
      netease: 8,
      qqmusic: 7,
      kugou: 6,
      kuwo: 4,
      migu: 4,
    };
    for (const platform of ALL_PLATFORMS) {
      expect(PLATFORM_QUALITY_OPTIONS[platform], platform).toHaveLength(expected[platform]);
    }
    expect(ALL_PLATFORMS.reduce((sum, p) => sum + PLATFORM_QUALITY_OPTIONS[p].length, 0)).toBe(29);
  });

  it("QQ 恢复全景声并新增全景声 2.0，臻品增强仍移除", () => {
    const families = PLATFORM_QUALITY_OPTIONS.qqmusic.map((item) => item.family);
    expect(families).not.toContain("premium");
    expect(families).toContain("spatial");
    expect(families).toContain("spatial-plus");
    // 全景声只认 raw atmos，不包含 atmos_plus
    const spatial = findPlatformQuality("qqmusic:qq-spatial")!;
    expect(spatial.family).toBe("spatial");
    expect(spatial.lxCandidates[0]).toBe("atmos");
    expect(spatial.lxCandidates).not.toContain("atmos_plus");
    // 全景声 2.0 为独立 family，labelKey 用 family 避免点号
    const spatialPlus = findPlatformQuality("qqmusic:qq-spatial-2.0")!;
    expect(spatialPlus.family).toBe("spatial-plus");
    expect(spatialPlus.labelKey).toBe("quality.option.qqmusic.spatial-plus");
    expect(spatialPlus.lxCandidates[0]).toBe("atmos_plus");
    expect(spatialPlus.lxCandidates).toContain("臻品全景声2.0");
    expect(spatialPlus.lxCandidates).not.toContain("atmos");
    expect(findPlatformQuality("qqmusic:qq-premium-2.0")).toBeUndefined();
  });

  it("QQ 解析：retired 臻品增强同平台显式无解，generic sky 落普通全景声", () => {
    expect(resolvePlatformQuality("qqmusic", "sky", "qqmusic:qq-premium-2.0")).toBeUndefined();
    expect(resolvePlatformQuality("qqmusic", "sky", "qqmusic:qq-spatial")?.id).toBe(
      "qqmusic:qq-spatial",
    );
    expect(resolvePlatformQuality("qqmusic", "sky", "qqmusic:qq-spatial-2.0")?.id).toBe(
      "qqmusic:qq-spatial-2.0",
    );
    expect(resolvePlatformQuality("qqmusic", "sky")?.id).toBe("qqmusic:qq-spatial");
    expect(resolvePlatformQuality("qqmusic", "jyeffect")).toBeUndefined();
  });

  it("spatial-plus 跨平台无等价时显式无解，不降级为普通 spatial", () => {
    for (const platform of ["netease", "kugou", "kuwo", "migu"] as const) {
      expect(resolvePlatformQuality(platform, "sky", "qqmusic:qq-spatial-2.0")).toBeUndefined();
    }
    expect(resolvePlatformQuality("netease", "sky", "qqmusic:qq-spatial")?.id).toBe("netease:sky");
  });

  it("QQ 母带统一为 master，历史版本选择及声明兼容同一目标", () => {
    const master = findPlatformQuality("qqmusic:master")!;
    expect(master.id).toBe("qqmusic:master");
    expect(master.nativeTier).toBe("master");
    expect(master.level).toBe("jymaster");
    expect(master.official).toBe(false);
    expect(master.requiresDeclaration).toBe(true);
    expect(master.minimumLevel).toBe("jymaster");
    expect(master.lxCandidates[0]).toBe("master");
    for (const alias of master.lxCandidates) {
      expect(declaredQualitySupports(master, [alias]), alias).toBe(true);
      expect(findPlatformQuality(`qqmusic:${alias}`), alias).toBe(master);
      expect(normalizeStoredQualitySelection(`qqmusic:${alias}`), alias).toBe(master.id);
      expect(findPlatformQuality(`qqmusic:${alias}`, "netease"), alias).toBeUndefined();
    }
    expect(declaredQualitySupports(master, ["flac", "hires"])).toBe(false);
    expect(declaredQualitySupports(master, undefined)).toBe(false);
  });

  it("统一偏好跨平台映射名称，但文件自己的来源不参与修改", () => {
    const master = resolvePlatformQuality("netease", "jymaster", "qqmusic:qq-master-2.0");
    expect(master?.id).toBe("netease:jymaster");
    // 退休 QQ 臻品增强保留 premium 意图；当前无平台提供 premium → 全部显式无解
    expect(resolvePlatformQuality("kuwo", "sky", "qqmusic:qq-premium-2.0")).toBeUndefined();
    expect(resolvePlatformQuality("netease", "sky", "qqmusic:qq-spatial")?.id).toBe("netease:sky");
    expect(resolvePlatformQuality("migu", "sky", "qqmusic:qq-premium-2.0")).toBeUndefined();
  });

  it("退休酷我/咪咕品牌档：同平台显式无解，跨平台按旧 family 推等价", () => {
    expect(resolvePlatformQuality("kuwo", "hi-res", "kuwo:hires")).toBeUndefined();
    expect(resolvePlatformQuality("kuwo", "sky", "kuwo:kuwo-spatial")).toBeUndefined();
    expect(resolvePlatformQuality("kuwo", "sky", "kuwo:kuwo-premium-2.0")).toBeUndefined();
    expect(resolvePlatformQuality("migu", "jymaster", "migu:migu-master")).toBeUndefined();
    expect(resolvePlatformQuality("migu", "sky", "migu:migu-spatial")).toBeUndefined();
    expect(resolvePlatformQuality("netease", "hi-res", "kuwo:hires")?.id).toBe("netease:hires");
    expect(resolvePlatformQuality("netease", "sky", "kuwo:kuwo-spatial")?.id).toBe("netease:sky");
    expect(resolvePlatformQuality("kugou", "sky", "kuwo:kuwo-spatial")?.id).toBe(
      "kugou:kugou-spatial",
    );
    expect(resolvePlatformQuality("netease", "jymaster", "migu:migu-master")?.id).toBe(
      "netease:jymaster",
    );
    expect(resolvePlatformQuality("kugou", "sky", "migu:migu-spatial")?.id).toBe(
      "kugou:kugou-spatial",
    );
    // 旧咪咕至臻仅限平台内映射到规范 hires 档
    expect(resolvePlatformQuality("migu", "hi-res", "migu:migu-premium")?.id).toBe("migu:hires");
    expect(findPlatformQuality("migu:migu-premium", "netease")).toBeUndefined();
  });

  it("存档选择规范化：旧别名升级规范档，退休标识保留，未知清除", () => {
    expect(normalizeStoredQualitySelection("qqmusic:qq-master-2.0")).toBe("qqmusic:master");
    expect(normalizeStoredQualitySelection("qqmusic:qq-master-4.0")).toBe("qqmusic:master");
    expect(normalizeStoredQualitySelection("migu:migu-premium")).toBe("migu:hires");
    // 退休标识保留原值：由源入口显式报错，不清空后隐式按 sky 请求
    expect(normalizeStoredQualitySelection("qqmusic:qq-premium-2.0")).toBe(
      "qqmusic:qq-premium-2.0",
    );
    expect(normalizeStoredQualitySelection("kuwo:hires")).toBe("kuwo:hires");
    expect(normalizeStoredQualitySelection("kuwo:kuwo-premium-2.0")).toBe("kuwo:kuwo-premium-2.0");
    expect(normalizeStoredQualitySelection("kuwo:kuwo-spatial")).toBe("kuwo:kuwo-spatial");
    expect(normalizeStoredQualitySelection("migu:migu-master")).toBe("migu:migu-master");
    expect(normalizeStoredQualitySelection("migu:migu-spatial")).toBe("migu:migu-spatial");
    expect(normalizeStoredQualitySelection("netease:sky")).toBe("netease:sky");
    expect(normalizeStoredQualitySelection("qqmusic:qq-spatial")).toBe("qqmusic:qq-spatial");
    expect(normalizeStoredQualitySelection("qqmusic:master")).toBe("qqmusic:master");
    expect(normalizeStoredQualitySelection(undefined)).toBeUndefined();
  });

  it.each(ALL_PLATFORMS)("%s 的升级目标可以使用实际文件参数验证", (platform) => {
    for (const level of ["lossless", "hi-res", "jymaster"] as const) {
      const item = upgradePlatformQuality(platform, level);
      // 酷我实测无 HiRes、咪咕实测无母带：generic 目标显式无解
      if (
        (platform === "kuwo" && level === "hi-res") ||
        (platform === "migu" && level === "jymaster")
      ) {
        expect(item).toBeUndefined();
        continue;
      }
      expect(item?.level).toBe(level);
      // 升级母带保留 requiresDeclaration 约束，generic 回执不能冒充品牌母带
      expect(item?.requiresDeclaration).toBe(
        level === "jymaster" &&
          (platform === "kugou" || platform === "qqmusic" || platform === "kuwo"),
      );
      if (platform === "kugou" && level === "jymaster") expect(item?.minimumLevel).toBe("hi-res");
      if (platform === "kuwo" && level === "jymaster") {
        expect(item?.minimumLevel).toBe("jymaster");
        expect(item?.id).toBe("kuwo:kuwo-master");
      }
      if (platform === "qqmusic" && level === "jymaster") {
        expect(item?.minimumLevel).toBe("jymaster");
        expect(item?.id).toBe("qqmusic:master");
      }
      if (platform === "migu" && level === "hi-res") expect(item?.id).toBe("migu:hires");
    }
  });

  it("插件未明确声明品牌档位时不能用相邻 raw 冒充", () => {
    const spatialPlus = findPlatformQuality("qqmusic:qq-spatial-2.0")!;
    expect(declaredQualitySupports(spatialPlus, ["atmos", "master", "flac24bit"])).toBe(false);
    expect(declaredQualitySupports(spatialPlus, ["atmos_plus"])).toBe(true);
    expect(declaredQualitySupports(spatialPlus, ["臻品全景声2.0"])).toBe(true);
    const kugouSpatial = findPlatformQuality("kugou:kugou-spatial")!;
    expect(declaredQualitySupports(kugouSpatial, ["atmos", "蝰蛇全景声"])).toBe(true);
    expect(declaredQualitySupports(kugouSpatial, ["master", "flac24bit"])).toBe(false);
    const kuwoMaster = findPlatformQuality("kuwo:kuwo-master")!;
    expect(declaredQualitySupports(kuwoMaster, ["atmos", "flac24bit"])).toBe(false);
    expect(declaredQualitySupports(kuwoMaster, ["master", "大师音质"])).toBe(true);
    expect(declaredQualitySupports(spatialPlus, undefined)).toBe(false);
  });

  it("非法或其他平台选择不从原型对象或模糊前缀匹配", () => {
    expect(findPlatformQuality("__proto__:master")).toBeUndefined();
    expect(findPlatformQuality("qqmusic:master-unknown")).toBeUndefined();
    expect(resolvePlatformQuality("qqmusic", "hq", "bad:value")?.family).toBe("hq");
  });
});
