import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";
import type { QualityProvenance } from "@shared/types/quality";
import { getQualityLevel, QUALITY_ORDER, type QualityLevel } from "@/utils/quality";
import { kuwoCall } from "@/apis/kuwo";

export type KuwoPlayUrlResult =
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
  url?: string;
  level?: QualityLevel;
  message?: string;
}

/**
 * 酷我官方 antiserver 无损常拒答，只有 mp3/aac 稳定；
 * 请求档位封顶到 sq（官方通道），更高档位交给插件 kw 通道。
 */
const clampQuality = (requested: QualityLevel, track: Track): QualityLevel => {
  const available = getQualityLevel(track.quality);
  const capped =
    QUALITY_ORDER[Math.min(QUALITY_ORDER.indexOf(available), QUALITY_ORDER.indexOf("lossless"))];
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.indexOf(requested), QUALITY_ORDER.indexOf(capped))];
};

export const resolveKuwoUrl = async (
  track: Track,
  level: QualityLevel,
): Promise<KuwoPlayUrlResult> => {
  const clamped = clampQuality(level, track);
  try {
    const result = await kuwoCall<SongUrlResponse>("song_url", { id: track.id, level: clamped });
    if (result.code === 200 && result.url) {
      // antiserver 返回档位即请求 clamp 档（请求证据），不虚构至臻母带等品牌档
      const qualityProvenance: QualityProvenance = {
        provider: "official",
        platform: "kuwo",
        evidence: "request",
        level: clamped,
      };
      return {
        available: true,
        url: result.url,
        isTrial: false,
        level: clamped,
        qualityProvenance,
      };
    }
  } catch (error) {
    console.warn("[kuwo] resolve URL failed:", error);
  }
  return { available: false, errorCode: ErrorCode.URL_RESOLVE_FAILED };
};
