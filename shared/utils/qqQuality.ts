/**
 * QQ 音乐音质档位模板（纯数据 + 纯函数，无 Node/Electron 依赖）
 *
 * 从 electron/main/apis/qqmusic/modules/song_url.ts 抽出，
 * 便于单测直接验证降级链，避免复制逻辑导致测试与实现漂移。
 */

export interface QQQualityCandidate {
  prefix: string;
  ext: string;
  level: string;
  label: string;
}

/**
 * 各档位对应的文件前缀（由高到低）。
 *
 * Q000 = 臻品母带 2.0（24bit/192kHz FLAC）
 * RS01 = 臻品音质 2.0
 * AI00 = Hi-Res FLAC
 * F000 = 无损 FLAC
 *
 * 之前只列到 AI00：选「臻品母带」时 findIndex 返回 -1、退化成整表，
 * 于是静默降回 hi-res——这是「QQ 音源老是拿不到高档位」的直接原因。
 */
export const QQ_QUALITY_CANDIDATE_TEMPLATES: readonly QQQualityCandidate[] = [
  { prefix: "Q000", ext: ".flac", level: "jymaster", label: "臻品母带 2.0" },
  { prefix: "RS01", ext: ".flac", level: "sky", label: "臻品音质 2.0" },
  { prefix: "AI00", ext: ".flac", level: "hi-res", label: "Hi-Res FLAC" },
  { prefix: "F000", ext: ".flac", level: "lossless", label: "无损 FLAC" },
  { prefix: "M800", ext: ".mp3", level: "hq", label: "320k MP3" },
  { prefix: "M500", ext: ".mp3", level: "sq", label: "128k MP3" },
  { prefix: "C400", ext: ".m4a", level: "lq", label: "标准 AAC" },
];

/**
 * 宿主档位 → QQ 模板档位映射。
 * 环绕声（jyeffect）只有网易官方接口提供，QQ 无对应实现，
 * 对齐到 QQ 最高档，避免 findIndex 落空后从头降级。
 */
const LEVEL_ALIAS: Readonly<Record<string, string>> = { jyeffect: "sky" };

/** 按用户首选音质生成顺位候选（从目标档开始向下降级） */
export const getQQQualityCandidates = (preferredLevel: string): QQQualityCandidate[] => {
  const target = String(preferredLevel || "hq").toLowerCase();
  const normalized = LEVEL_ALIAS[target] ?? target;
  const idx = QQ_QUALITY_CANDIDATE_TEMPLATES.findIndex((t) => t.level === normalized);
  return idx >= 0 ? QQ_QUALITY_CANDIDATE_TEMPLATES.slice(idx) : [...QQ_QUALITY_CANDIDATE_TEMPLATES];
};
