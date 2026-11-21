import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";
import type { QualityProvenance } from "@shared/types/quality";
import { getQualityLevel, QUALITY_ORDER, type QualityLevel } from "@/utils/quality";
import { kugouCall } from "@/apis/kugou";

export type KugouPlayUrlResult =
  | {
      available: true;
      url: string;
      isTrial: boolean;
      level: QualityLevel;
      qualityProvenance?: QualityProvenance;
    }
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
      // 返回档位是请求前 clamp 的结果（请求证据），非官方明确下发的原生档位，
      // 不虚构蝰蛇母带等品牌档；平台按官方通道已知填写
      const qualityProvenance: QualityProvenance = {
        provider: "official",
        platform: "kugou",
        evidence: "request",
        level: clamped,
      };
      return {
        available: true,
        url: result.data.url,
        isTrial: false,
        level: clamped,
        qualityProvenance,
      };
    }
  } catch (error) {
    console.warn("[kugou] resolve URL failed:", error);
  }
  return { available: false, errorCode: ErrorCode.URL_RESOLVE_FAILED };
};
