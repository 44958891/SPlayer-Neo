/**
 * 下载档位校验（共享纯函数）
 *
 * 下载请求携带平台具体选择（qualitySelection）时，通用等级的线性大小序不再够用：
 * 臻品音质与全景声同为 sky 档，却分别要求 Hi-Res 物理规格与提供者明确的档位声明，
 * 仅靠 levelMeets 会把任意高等级文件当成达标。这里按选择项逐条校验实际文件与解析依据，
 * 无选择时返回 undefined，调用方沿用原有通用下限行为
 */
import type { AudioQuality } from "../types/player";
import type { Platform } from "../types/platform";
import type { PluginQuality } from "../types/plugin";
import type { PlatformQualityOption, QualityFamily, QualityProvenance } from "../types/quality";
import { isPlatform } from "../types/platform";
import { findPlatformQuality } from "./platformQuality";
import { levelMeets } from "./quality";
import { resolveQualityBadge, type BrandedQualityTier } from "./qualityProvenance";

/** 需要档位声明的家族 → 平台品牌档位规范名（nativeTier 别名归一后仍比对规范名） */
const DECLARED_TIER: Partial<
  Record<Platform, Partial<Record<QualityFamily, readonly BrandedQualityTier[]>>>
> = {
  netease: { surround: ["netease-surround"], spatial: ["netease-sky"] },
  // 母带回执统一归一 canonical qq-master；旧 4.0 规范名仅为类型兼容，回执已不再产出，保留无害
  qqmusic: {
    master: ["qq-master", "qq-master-4"],
    spatial: ["qq-spatial"],
    "spatial-plus": ["qq-spatial-2"],
  },
  kuwo: { master: ["kuwo-master-quality", "kuwo-master"] },
  kugou: { spatial: ["kugou-spatial"], master: ["kugou-master"] },
};

/** 取链阶段只检查档位回执，文件规格仍由落盘后的完整校验负责
 * @param option - 当前平台的具体目标
 * @param provenance - 提供者返回的来源与原生档位证据
 * @returns 来源和品牌回执是否与目标一致
 */
export const qualityDeclarationMeets = (
  option: PlatformQualityOption,
  provenance: QualityProvenance | undefined,
): boolean => {
  if (!option.requiresDeclaration) return true;
  if (
    provenance?.platform !== option.platform ||
    (provenance.evidence !== "response" && provenance.evidence !== "plugin")
  )
    return false;
  const expected = DECLARED_TIER[option.platform]?.[option.family];
  const badge = resolveQualityBadge(undefined, provenance);
  return Boolean(expected && badge.tier && expected.includes(badge.tier));
};

/** 校验输入 */
export interface DownloadQualityCheck {
  /** 请求携带的平台具体选择标识 */
  selection?: string;
  /** 请求的通用档位，须与选择项档位一致 */
  qualityLevel: PluginQuality;
  /** 歌曲来源，须与选择项平台一致 */
  source: string;
  /** 本次解析回传的档位依据（调用方先经 validateQualityProvenance 校验） */
  provenance?: QualityProvenance;
  /** 落盘前探测出的实际音频参数 */
  quality?: AudioQuality | null;
}

/**
 * 带平台选择的下载档位校验
 * - 无选择返回 undefined：调用方沿用原有通用下限（levelMeets），行为完全不变
 * - 选择标识未知、来源平台不匹配、档位不一致、解码不出有效音频 → false
 * - 普通物理档位（含升级目标）：沿用 levelMeets 比对文件规格
 * - 声明类档位（premium/ spatial/ surround）：要求解析依据来自 response/plugin、
 *   平台与选择一致、nativeTier 归一后命中品牌规范档位（requestedTier 仅是请求回显，
 *   不作证据），且实测规格与声明不矛盾（premium 按 Hi-Res 物理规格核对）
 * @param check - 校验输入
 * @returns undefined 表示无选择走旧逻辑；true 达标；false 未达标
 */
export const downloadQualityMeets = (check: DownloadQualityCheck): boolean | undefined => {
  if (!check.selection) return undefined;
  const option = findPlatformQuality(check.selection);
  if (!option) return false;
  if (!isPlatform(check.source) || option.platform !== check.source) return false;
  if (option.level !== check.qualityLevel) return false;
  if (!check.quality?.codec || check.quality.codec === "unknown") return false;
  if (!option.requiresDeclaration)
    return levelMeets(check.quality, option.minimumLevel ?? option.level);
  if (option.minimumLevel && !levelMeets(check.quality, option.minimumLevel)) return false;
  if (!qualityDeclarationMeets(option, check.provenance)) return false;
  // 已匹配回执仍须通过文件实测，取链阶段的优先级不能替代物理规格校验
  const badge = resolveQualityBadge(check.quality, check.provenance);
  return Boolean(badge.tier && !badge.mismatch);
};
