import type { AudioQuality } from "@shared/types/player";

/** 音质等级（jymaster/sky/jyeffect 仅网易官方接口提供，其他平台自动回落最高档） */
export type QualityLevel =
  "jymaster" | "sky" | "jyeffect" | "hi-res" | "lossless" | "hq" | "sq" | "lq";

/** 音质档位由低到高的顺序，用于档位比较与降级选择 */
export const QUALITY_ORDER: readonly QualityLevel[] = [
  "lq",
  "sq",
  "hq",
  "lossless",
  "hi-res",
  "jyeffect",
  "sky",
  "jymaster",
];

/**
 * 取档位序号（越大越高）
 * @param level - 音质档位
 */
export const qualityRank = (level: QualityLevel): number => QUALITY_ORDER.indexOf(level);

/**
 * 判断实际档位是否达到请求档位；实际档位未知时视为满足
 * @param actual - 实际（或解析确认）档位
 * @param requested - 请求档位
 */
export const qualityMeets = (actual: QualityLevel | undefined, requested: QualityLevel): boolean =>
  !actual || qualityRank(actual) >= qualityRank(requested);

/** 无损及以上（含环绕声 / 母带档）档位 */
const LOSSLESS_LEVELS: ReadonlySet<QualityLevel> = new Set([
  "jymaster",
  "sky",
  "jyeffect",
  "hi-res",
  "lossless",
]);

/**
 * 判断档位是否为无损及以上
 * @param level - 音质档位
 */
export const isLosslessLevel = (level: QualityLevel): boolean => LOSSLESS_LEVELS.has(level);

/** 无损编解码器 */
const LOSSLESS_CODECS = new Set(["flac", "alac", "ape", "wav", "aiff", "wavpack", "tta"]);

/**
 * 判断编解码器是否为无损格式
 * @param codec - 编解码器名称
 * @returns 是否为无损格式
 */
export const isLosslessCodec = (codec: string): boolean => LOSSLESS_CODECS.has(codec.toLowerCase());

/** 等级短码文案 */
export const QUALITY_LABELS: Record<QualityLevel, string> = {
  jymaster: "Master",
  sky: "Sky",
  jyeffect: "Surround",
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "HQ",
  sq: "SQ",
  lq: "LQ",
};

/** 等级完整文案 */
const QUALITY_FULL_LABELS: Record<QualityLevel, string> = {
  jymaster: "Hi-Res Master",
  sky: "Spatial Audio (Sky)",
  jyeffect: "Surround Audio",
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "High Quality",
  sq: "Standard Quality",
  lq: "Low Quality",
};

/**
 * 判断音质等级；信息不全时回落到 LQ
 * 无损流按位深 + 采样率分级（对齐网易官方口径）：
 * 24bit 且采样率 ≥176.4kHz → 母带（jymaster）；24bit 且 ≥96kHz → Hi-Res；其余无损 → Lossless
 * 环绕声（jyeffect/sky）无法从流元数据分辨，不在此返回
 * @param quality - AudioQuality；undefined / 无 codec 时按最低档处理
 * @returns 音质等级
 */
export const getQualityLevel = (quality: AudioQuality | undefined): QualityLevel => {
  if (!quality || !quality.codec || quality.codec === "unknown") return "lq";
  const isLossless = isLosslessCodec(quality.codec);
  if (isLossless) {
    if (quality.sampleRate >= 176400 && quality.bitsPerSample >= 24) return "jymaster";
    if (quality.sampleRate >= 96000 && quality.bitsPerSample >= 24) return "hi-res";
    return "lossless";
  }
  const kbps = quality.bitRate / 1000;
  if (kbps >= 320) return "hq";
  if (kbps >= 192) return "sq";
  return "lq";
};

/**
 * 取音质等级短码文案
 * @param quality - 音质信息；缺少信息时使用默认 LQ
 * @returns 短码文案（LQ / SQ / HQ / Lossless / Hi-Res）
 */
export const getQualityLabel = (quality: AudioQuality | undefined): string =>
  QUALITY_LABELS[getQualityLevel(quality)];

/**
 * 取音质等级完整文案
 * @param quality - 音质信息；缺少信息时使用默认 Low Quality
 * @returns 完整文案（Low Quality / Standard Quality / High Quality / Lossless / Hi-Res）
 */
export const getQualityFullLabel = (quality: AudioQuality | undefined): string =>
  QUALITY_FULL_LABELS[getQualityLevel(quality)];

/** 是否为无损及以上级别（含母带档） */
export const isLosslessQuality = (quality: AudioQuality | undefined): boolean =>
  isLosslessLevel(getQualityLevel(quality));
