import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";
import type { QualityProvenance } from "@shared/types/quality";
import type { QualityLevel } from "@/utils/quality";
import { qqmusicCall } from "@/apis/qqmusic";

export type QQMusicPlayUrlResult =
  | {
      available: true;
      url: string;
      isTrial: boolean;
      level?: QualityLevel;
      qualityProvenance?: QualityProvenance;
    }
  | { available: false; errorCode: ErrorCode };

interface SongUrlData {
  id: string;
  url: string;
  level?: string;
  /** 主进程命中的候选模板文件名前缀（如 Q000 / RS01 / F000） */
  nativeTier?: string;
  format?: string;
  isFallback?: boolean;
}

/**
 * 主进程回传的直链档位（与候选模板一致，可直接当宿主档位使用）。
 * 必须包含 jymaster / sky——否则臻品母带 2.0 的档位声明会被丢成 undefined，
 * 上层按「档位未知」处理，既无法判断是否达标也无法正确展示。
 */
const QQ_LEVELS: ReadonlySet<string> = new Set([
  "jymaster",
  "sky",
  "hi-res",
  "lossless",
  "hq",
  "sq",
  "lq",
]);

interface SongUrlResponse {
  code: number;
  message?: string;
  data?: SongUrlData[];
}

/**
 * 解析 QM 单曲的播放 URL
 * @param track - 待解析的 Track（track.id 为 songmid）
 * @param songLevel - 音质偏好
 */
export const resolveQQMusicUrl = async (
  track: Track,
  songLevel: QualityLevel,
): Promise<QQMusicPlayUrlResult> => {
  try {
    const body = await qqmusicCall<SongUrlResponse>("song_url", {
      mid: track.id,
      mediaMid: track.mediaId,
      level: songLevel,
    });

    const item = body?.data?.[0];
    if (item?.url) {
      const level =
        item.level && QQ_LEVELS.has(item.level) ? (item.level as QualityLevel) : undefined;
      // 档位依据是服务端接受的候选模板文件名前缀（文件名证据）；
      // Q000 / RS01 属临时声明，未经文件实测证实，原生档位保留前缀原文
      const qualityProvenance: QualityProvenance = {
        provider: "official",
        platform: "qqmusic",
        evidence: "filename",
        ...(item.nativeTier ? { nativeTier: item.nativeTier } : {}),
        ...(level ? { level } : {}),
      };
      return {
        available: true,
        url: item.url,
        isTrial: false,
        level,
        qualityProvenance,
      };
    }

    return {
      available: false,
      errorCode: ErrorCode.URL_RESOLVE_FAILED,
    };
  } catch (err) {
    console.warn("[qqmusic] resolve URL failed:", err);
    return {
      available: false,
      errorCode: ErrorCode.URL_RESOLVE_FAILED,
    };
  }
};
