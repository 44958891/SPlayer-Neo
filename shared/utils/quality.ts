import type { AudioQuality } from "../types/player";

/** 音质档位（与渲染端 src/utils/quality.ts 保持同口径，主进程侧轻量复制） */
export type QualityLevel =
  "jymaster" | "sky" | "jyeffect" | "hi-res" | "lossless" | "hq" | "sq" | "lq";

/** 档位由低到高 */
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

/** 取档位序号（越大越高） */
export const qualityRank = (level: QualityLevel): number => QUALITY_ORDER.indexOf(level);

/** 无损编解码器 */
const LOSSLESS_CODECS = new Set(["flac", "alac", "ape", "wav", "aiff", "wavpack", "tta"]);

/**
 * 由音频元数据判定档位（与渲染端 getQualityLevel 同规则）
 * 24bit 且 ≥176.4kHz → 母带；24bit 且 ≥96kHz → Hi-Res；其余无损 → Lossless
 */
export const levelOfQuality = (quality: AudioQuality | undefined | null): QualityLevel => {
  if (!quality?.codec || quality.codec === "unknown") return "lq";
  if (LOSSLESS_CODECS.has(quality.codec.toLowerCase())) {
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
 * 实际文件档位是否达到目标档位
 * 用于下载落地后的校验：达不到即视为无效替换
 */
export const levelMeets = (
  actual: AudioQuality | undefined | null,
  requested: QualityLevel,
): boolean => qualityRank(levelOfQuality(actual)) >= qualityRank(requested);
