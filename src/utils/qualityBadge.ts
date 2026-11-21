import type { AudioQuality } from "@shared/types/player";
import type { PlaybackQualityStatus } from "@shared/types/playbackQuality";
import { PLATFORM_NAME } from "@shared/types/platform";
import type { Platform } from "@shared/types/platform";
import type { QualityEvidence, QualityLevel, QualityProvenance } from "@shared/types/quality";
import {
  resolveQualityBadge,
  validateQualityProvenance,
  type QualityBadgeDescriptor,
} from "@shared/utils/qualityProvenance";
import { findPlatformQuality } from "@shared/utils/platformQuality";
import { QUALITY_LABELS } from "@/utils/quality";
import i18n from "@/i18n";

/** 徽标解析结果，在共享判定上补充证据与实测标记供文案使用 */
export interface QualityBadgeView extends QualityBadgeDescriptor {
  /** 档位证据类型，无来源信息时为空 */
  evidence?: QualityEvidence;
  /** 来源明确回传的原生档位，保留未知档位供提示 */
  nativeTier?: string;
  /** 参数是否来自实际文件解码 */
  measured: boolean;
  /** 平台身份依据，source 表示插件来源通道回执而非明确声明 */
  platformEvidence?: QualityProvenance["platformEvidence"];
  /** 本次播放请求的选择标识，与实际档位分开提示 */
  requestedSelection?: string;
  /** 提供者回显的请求原生档位，仅作对照参考 */
  requestedTier?: string;
}

/** 徽标渲染文案 */
export interface QualityBadgeText {
  /** 徽标短文案：专属档位为平台专属标签，通用档位为短码 */
  label: string;
  /** 悬浮提示：完整名称、技术规格、证据说明与矛盾告警 */
  tooltip: string;
}

/**
 * 解析音质徽标视图（透传共享判定并补充证据、实测与请求对照标记）
 *
 * 请求对照与平台身份依据取自共享校验器的输出，非法数据不会进入视图
 * @param quality - 音频参数；目录声明参数传 measured=false
 * @param provenance - 提供者保留的档位证据
 * @param measured - 参数是否来自实际解码
 * @returns 徽标视图
 */
export const resolveQualityBadgeView = (
  quality: AudioQuality | undefined,
  provenance: QualityProvenance | undefined,
  measured = true,
): QualityBadgeView => {
  const info = validateQualityProvenance(provenance);
  return {
    ...resolveQualityBadge(quality, info, measured),
    evidence: info?.evidence,
    nativeTier: info?.nativeTier,
    measured,
    ...(info?.platformEvidence ? { platformEvidence: info.platformEvidence } : {}),
    ...(info?.requestedSelection ? { requestedSelection: info.requestedSelection } : {}),
    ...(info?.requestedTier ? { requestedTier: info.requestedTier } : {}),
  };
};

/**
 * 平台专属档位的本地化标签（如 臻品全景声 2.0）
 * @param tier - 共享层归一的专属档位键
 * @returns 本地化标签
 */
export const qualityTierLabel = (tier: string): string => i18n.global.t(`quality.tier.${tier}`);

/**
 * 通用档位的本地化名称
 * @param level - 宿主通用档位
 * @returns 本地化名称
 */
export const qualityLevelLabel = (level: QualityLevel): string =>
  i18n.global.t(`quality.level.${level}`);

/**
 * 请求选择的本地化名称，按菜单目录翻译，不回显原始来源键
 * @param selection - 保存的选择标识（platform:tier）
 * @param platform - 可选的平台约束
 * @returns 本地化名称，未知选择返回空
 */
export const qualitySelectionLabel = (
  selection: string | undefined,
  platform?: Platform,
): string => {
  const option = findPlatformQuality(selection, platform);
  return option ? i18n.global.t(option.labelKey) : "";
};

/** 请求目标与实际交付的对照文案 */
export interface PlaybackStatusText {
  /** 警示提示；met 或无对照时为空，不渲染警示标记 */
  tooltip: string;
  /** 请求目标的本地化名称，未知选择为空 */
  requested: string;
  /** 实际交付档位的本地化名称 */
  actual: string;
}

/**
 * 组装请求与实际交付的对照文案；met 属正常交付，不产生警示
 * @param status - 主进程回传的播放音质对照
 * @returns 对照文案
 */
export const playbackStatusText = (
  status: PlaybackQualityStatus | undefined | null,
): PlaybackStatusText => {
  const t = i18n.global.t;
  const requested = status ? qualitySelectionLabel(status.selection, status.platform) : "";
  const actual = status?.actualLevel ? qualityLevelLabel(status.actualLevel) : "";
  if (!status || status.state === "met") return { tooltip: "", requested, actual };
  const requestedName = requested || t("quality.playback.targetUnavailable");
  const actualName = actual || "—";
  const lines = [
    t("quality.playback.requested", { quality: requestedName }),
    ...(actual ? [t("quality.playback.actual", { quality: actual })] : []),
    t(`quality.playback.${status.state}`, { requested: requestedName, actual: actualName }),
  ];
  return { tooltip: lines.join("\n"), requested, actual };
};

/**
 * 组装技术规格文本，仅保留已知字段
 * @param quality - 音频参数
 * @returns 规格文本，全部未知时为空
 */
const specText = (quality: AudioQuality): string => {
  const parts: string[] = [];
  if (quality.codec && quality.codec !== "unknown") parts.push(quality.codec.toUpperCase());
  if (quality.bitsPerSample > 0) parts.push(`${quality.bitsPerSample}bit`);
  if (quality.sampleRate > 0) parts.push(`${(quality.sampleRate / 1000).toFixed(1)}kHz`);
  if (quality.bitRate > 0) parts.push(`${Math.round(quality.bitRate / 1000)}kbps`);
  return parts.join(" · ");
};

/**
 * 取徽标短文案与本地化悬浮提示
 *
 * 请求目标单独成行，与实际档位、原生档位原文分开列出；来源通道回执的
 * 平台身份附加免责声明，避免把插件请求通道当作官方音源声明
 * @param view - 徽标视图
 * @param quality - 音频参数，用于列出规格
 * @returns 徽标文案
 */
export const qualityBadgeText = (
  view: QualityBadgeView,
  quality?: AudioQuality,
): QualityBadgeText => {
  const t = i18n.global.t;
  const tierLabel = view.tier ? qualityTierLabel(view.tier) : "";
  const label = tierLabel || QUALITY_LABELS[view.level];
  const lines: string[] = [];
  const title = tierLabel || qualityLevelLabel(view.level);
  lines.push(view.platform ? `${PLATFORM_NAME[view.platform]} · ${title}` : title);
  const spec = quality ? specText(quality) : "";
  if (spec) lines.push(spec);
  const requested = qualitySelectionLabel(view.requestedSelection, view.platform);
  if (requested) lines.push(t("quality.playback.requested", { quality: requested }));
  if (view.measured) lines.push(t("quality.evidence.measured"));
  if (view.nativeTier) lines.push(t("quality.tooltip.nativeTier", { tier: view.nativeTier }));
  if (view.evidence) lines.push(t(`quality.evidence.${view.evidence}`));
  else if (!view.measured) lines.push(t("quality.evidence.catalog"));
  if (view.platformEvidence === "source") lines.push(t("quality.playback.sourceChannel"));
  if (view.mismatch) lines.push(t("quality.tooltip.mismatch"));
  return { label, tooltip: lines.join("\n") };
};
