import type { QualityFamily, QualityLevel } from "@shared/types/quality";
import type { BrandedQualityTier } from "@shared/utils/qualityProvenance";
import type { QualityBadgeView } from "@/utils/qualityBadge";

/** 各音质类别共用的 24px 线条图形，平台之间不再混用不同尺寸的图片 */
const GLYPHS = {
  standard: ["M5 7h14M5 12h10M5 17h6"],
  higher: ["M6 10v8M12 7v11M18 4v14"],
  hq: ["M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"],
  lossless: ["M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8C13 16 11 8 6 8a4 4 0 0 0 0 8Z"],
  "hi-res": [
    "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3",
    "M8 10v4M12 7v10M16 10v4",
  ],
  premium: [
    "m10.6 3.6-7 7a2 2 0 0 0 0 2.8l7 7a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8l-7-7a2 2 0 0 0-2.8 0Z",
    "M7 12h2l1.5-3.5 3 7L15 12h2",
  ],
  surround: [
    "M5.8 5.8a8.8 8.8 0 0 0 0 12.4M18.2 5.8a8.8 8.8 0 0 1 0 12.4M8.7 8.7a4.7 4.7 0 0 0 0 6.6M15.3 8.7a4.7 4.7 0 0 1 0 6.6M12 10.5v3",
  ],
  spatial: [
    "M20.2 7.3c1.3 2.3-1.3 6.3-5.8 8.9S5.1 19.1 3.8 16.7 5.1 10.4 9.6 7.8s9.3-2.8 10.6-.5Z",
    "M8.2 4.3C9.2 2.6 10.6 1.9 12 2.5c2.6 1.1 4.8 6.2 4.8 11.3 0 3.1-.8 5.8-2 6.9M12 10.5v3",
  ],
  master: [
    "M5.5 5h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z",
    "M9.75 10.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm9 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0ZM9.75 10.5h4.5M7 19l1.5-4h7l1.5 4",
  ],
} as const;

const LEVEL_FAMILIES: Readonly<Record<QualityLevel, QualityFamily>> = {
  lq: "standard",
  sq: "higher",
  hq: "hq",
  lossless: "lossless",
  "hi-res": "hi-res",
  jyeffect: "surround",
  sky: "spatial",
  jymaster: "master",
};

/** 品牌含义优先于兼容旧协议的 level，例如臻品音质的 sky 不代表全景声 */
const TIER_FAMILIES: Readonly<Record<BrandedQualityTier, QualityFamily>> = {
  "netease-master": "master",
  "netease-sky": "spatial",
  "netease-surround": "surround",
  "qq-master": "master",
  "qq-master-4": "master",
  "qq-premium": "premium",
  "qq-spatial": "spatial",
  "qq-spatial-2": "spatial-plus",
  "kuwo-master": "master",
  "kuwo-master-quality": "master",
  "kuwo-premium": "premium",
  "kuwo-spatial": "spatial",
  "kugou-master": "master",
  "kugou-spatial": "spatial",
  "migu-master": "master",
  "migu-premium": "premium",
  "migu-spatial": "spatial",
};

/** 统一矢量描述；路径坐标、笔画与颜色均与平台无关 */
export interface QualityArtwork {
  family: QualityFamily;
  paths: readonly string[];
}

/** 获取菜单和实际音质共用的图形
 * @param family - 现有目录的音质类别
 * @returns 24px 线条路径，空间声升级版通过名称区分版本
 */
export const qualityArtworkForFamily = (family: QualityFamily): QualityArtwork => ({
  family,
  paths: GLYPHS[family === "spatial-plus" ? "spatial" : family],
});

/** 根据已确认档位选择图形，参数矛盾时退回实际通用类别
 * @param view - 现有音质判定结果，不改变来源或文件规格
 * @returns 与菜单一致的矢量描述
 */
export const qualityArtworkFor = (
  view: Pick<QualityBadgeView, "level" | "tier" | "mismatch">,
): QualityArtwork =>
  qualityArtworkForFamily(
    view.tier && !view.mismatch ? TIER_FAMILIES[view.tier] : LEVEL_FAMILIES[view.level],
  );
