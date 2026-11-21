import type { Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import type { QualityProvenance } from "@shared/types/quality";
import { isPlatform } from "@shared/types/platform";
import { streamingSourceForTrack } from "@shared/utils/streamingSource";
import { validateQualityProvenance } from "@shared/utils/qualityProvenance";
import { findPlatformQuality, resolvePlatformQuality } from "@/utils/platformQuality";
import { resolveByPluginBest, type OnlineResolveResult } from "@/services/audioSource";
import { ErrorCode } from "@shared/types/errors";

/** 下载源解析成功 */
export interface DownloadSource {
  ok: true;
  url: string;
  /** 已知格式（flac/mp3 等），用于扩展名 */
  format?: string;
  /** 已知体积（字节） */
  size?: number;
  /** 本次解析来源的音质依据，随下载请求落库 */
  qualityProvenance?: QualityProvenance;
}

/** 下载源解析失败（带原因码，供上层给出具体提示） */
export interface DownloadSourceFailure {
  ok: false;
  errorCode: ErrorCode;
}

/** 下载源解析结果 */
export type DownloadSourceResult = DownloadSource | DownloadSourceFailure;

/**
 * 按下载音质解析歌曲下载地址（仅走音源插件）
 *
 * 不使用各平台官方接口：官方通道存在静默降档（酷我 antiserver 忽略无损参数只给
 * 128k）与密文数据（返回加密流导致文件不可解析），是此前覆盖用户文件的根因。
 * 改为并发调用全部可用插件、按声明档位取最优版本，最终再由主进程下载后按文件
 * 真实音质校验（不达标即拒换并保留原文件）。
 *
 * 失败原因必须带出：下载页此前只能显示笼统的"无法下载"，
 * 探针拒绝（只有试听片段）与插件缺失是完全不同的处理方向。
 *
 * 平台具体选择（platform:tier）优先于通用档位：选择标识必须匹配歌曲平台，
 * 旧通用档位则映射为本平台等价目标；映射不到等价档位时直接失败，
 * 不静默降级到其他档位。
 *
 * @param track - 要下载的歌曲
 * @param level - 下载音质档位（旧通用协议）
 * @param qualitySelection - 平台具体音质选择标识，必须匹配歌曲平台
 * @returns 成功给 url（含探针实测体积）；失败给原因码
 */
export const resolveDownloadSource = async (
  track: Track,
  level: QualityLevel,
  qualitySelection?: string,
): Promise<DownloadSourceResult> => {
  // 流媒体服务器直接取流地址
  if (track.source === "streaming") {
    try {
      return { ok: true, url: streamingSourceForTrack(track) };
    } catch {
      return { ok: false, errorCode: ErrorCode.NETWORK_ERROR };
    }
  }

  if (!isPlatform(track.source)) {
    return { ok: false, errorCode: ErrorCode.URL_RESOLVE_FAILED };
  }

  const exact = qualitySelection ? findPlatformQuality(qualitySelection, track.source) : undefined;
  if (qualitySelection && !exact)
    return { ok: false, errorCode: ErrorCode.DOWNLOAD_QUALITY_NOT_MET };
  const target = exact ?? resolvePlatformQuality(track.source, level);
  if (!target) return { ok: false, errorCode: ErrorCode.DOWNLOAD_QUALITY_NOT_MET };

  // 全平台统一：并发全部插件，取声明档位最高者；第五参传平台具体选择标识供插件精确请求
  // 下载场景开启 URL 预探针（1 字节 Range + 体积反推），下载前拦截试听片段/防盗链页面
  const res = await resolveByPluginBest(track, target.level, [], true, target.id);
  if (!res.ok) return { ok: false, errorCode: res.errorCode };
  if (res.isTrial) return { ok: false, errorCode: ErrorCode.NETEASE_TRIAL_DISABLED };
  return {
    ok: true,
    url: res.url,
    // 探针实测体积回传主进程：下载进度在 Content-Length 缺失时用它兜底
    ...(res.sizeBytes && res.sizeBytes > 0 ? { size: res.sizeBytes } : {}),
    // 解析器回传的音质依据经校验后透传，非法数据按未知来源处理
    qualityProvenance: validateQualityProvenance(
      (res as OnlineResolveResult & { qualityProvenance?: unknown }).qualityProvenance,
    ),
  };
};
