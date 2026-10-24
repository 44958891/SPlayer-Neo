import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";
import { getQualityLevel, QUALITY_ORDER, type QualityLevel } from "@/utils/quality";
import { kugouCall } from "@/apis/kugou";

export type KugouPlayUrlResult =
  | { available: true; url: string; isTrial: boolean; level: QualityLevel }
  | { available: false; errorCode: ErrorCode };

interface SongUrlResponse {
  code: number;
  data?: { url?: string };
}

// 酷狗探测/请求最高到 hi-res；环绕声与母带档请求时被 clamp 到 hi-res
// （getQualityLevel 现在会把 24bit/192k 的探测结果判为 jymaster，官方请求档需额外封顶）
const clampQuality = (requested: QualityLevel, track: Track): QualityLevel => {
  const available = getQualityLevel(track.quality);
  const capped =
    QUALITY_ORDER[Math.min(QUALITY_ORDER.indexOf(available), QUALITY_ORDER.indexOf("hi-res"))];
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.indexOf(requested), QUALITY_ORDER.indexOf(capped))];
};

export const resolveKugouUrl = async (
  track: Track,
  level: QualityLevel,
): Promise<KugouPlayUrlResult> => {
  const clamped = clampQuality(level, track);
  try {
    const result = await kugouCall<SongUrlResponse>("song_url", {
      hash: track.id,
      audioId: track.extId,
      albumId: track.album?.id,
      level: clamped,
    });
    if (result.code === 200 && result.data?.url) {
      return { available: true, url: result.data.url, isTrial: false, level: clamped };
    }
  } catch (error) {
    console.warn("[kugou] resolve URL failed:", error);
  }
  return { available: false, errorCode: ErrorCode.URL_RESOLVE_FAILED };
};
