/**
 * 音源手动体检（主进程单点执行）
 *
 * 渲染层负责编排（遍历插件 × 源 × 档位、报进度、可取消），每个点交给这里执行：
 *   取链（带 8s → 25s 超时重试）→ 探针（1 字节 Range + 体积反推）→ 码率对照 → 落体检表
 *
 * 放在主进程的理由：插件取链本来就走主进程（plugin:resolveUrl），探针也在这里；
 * 单点合一次 IPC 可少一次往返，且能与体检表写入原子完成。
 */

import type { CheckPointResult, CheckSong } from "@shared/utils/sourceCheck";
import { checkSongKey, estimateBps, judgeBitrateMismatch } from "@shared/utils/sourceCheck";
import type { MusicUrlRes, PluginQuality } from "@shared/types/plugin";
import { ACTION_TIMEOUTS } from "@shared/defaults/plugin-api";
import { resolveUrl } from "@main/plugins/router";
import { probeAudioUrl } from "@main/plugins/probe";
import { healthKey, healthReport } from "@main/plugins/health";
import { pluginRegistry } from "@main/plugins/registry";
import { pluginLog } from "@main/utils/logger";

/** 取链首次超时（与下载链路一致） */
const FAST_TIMEOUT_MS = 8_000;
/** 超时后的长超时重试 */
const RETRY_TIMEOUT_MS = 25_000;

/** 单点体检入参 */
export interface CheckPointArgs {
  pluginId: string;
  source: string;
  quality: PluginQuality;
  song: CheckSong;
  /** 是否把结论写入体检表（默认 true；仅查看不污染时传 false） */
  persist?: boolean;
}

/** 是超时类错误（软失败） */
const isTimeout = (message: string): boolean =>
  /超时|timed?\s*out|aborted due to timeout|timeout/i.test(message);

/** 由 song 组装插件 musicInfo（各平台字段名全带上，插件自取所需） */
const buildMusicInfo = (song: CheckSong): { songmid: string; [key: string]: unknown } => ({
  id: song.songmid,
  songmid: song.songmid,
  songId: song.songmid,
  name: song.name,
  singer: song.singer,
  interval: song.interval,
  ...(song.hash ? { hash: song.hash } : {}),
  ...(song.copyrightId ? { copyrightId: song.copyrightId } : {}),
});

/**
 * 执行单点体检
 * @param args - 插件 / 源 / 档位 / 测试曲
 * @returns 单点结论（含耗时与实测码率）
 */
export const checkSourcePoint = async (args: CheckPointArgs): Promise<CheckPointResult> => {
  const { pluginId, source, quality, song } = args;
  const base: CheckPointResult = {
    pluginId,
    source,
    quality,
    status: "hard",
    message: "",
    sizeBytes: 0,
    probedBps: 0,
    linkMs: 0,
    probeMs: 0,
  };

  const runtime = pluginRegistry.getRuntime(pluginId);
  if (!runtime || !runtime.enabled) {
    return { ...base, status: "unsupported", message: "插件未启用" };
  }
  if (runtime.status.state !== "ready") {
    return { ...base, status: "unsupported", message: "插件未就绪" };
  }
  if (!runtime.status.sources?.[source]?.actions.includes("musicUrl")) {
    return { ...base, status: "unsupported", message: "插件未声明该源" };
  }

  const musicInfo = buildMusicInfo(song);
  const linkStarted = Date.now();
  let resolved: MusicUrlRes | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !resolved; attempt++) {
    const timeoutMs = attempt === 0 ? FAST_TIMEOUT_MS : RETRY_TIMEOUT_MS;
    try {
      const res = await resolveUrl({ pluginId, source, quality, musicInfo, timeoutMs });
      if (res?.url) {
        resolved = res;
        break;
      }
      lastError = "返回空链接";
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // 非超时错误重试无意义，直接收尾
      if (!isTimeout(lastError)) break;
      pluginLog.warn(`[source-check] ${pluginId}/${source}/${quality} 取链超时，长超时重试`);
    }
  }
  const linkMs = Date.now() - linkStarted;

  if (!resolved) {
    const soft = isTimeout(lastError);
    const result: CheckPointResult = {
      ...base,
      status: soft ? "soft" : "hard",
      message: soft ? "取链超时" : lastError.slice(0, 200),
      linkMs,
    };
    if (args.persist !== false) {
      // 软失败不落表（瞬时抖动），硬失败落表供取链时跳过
      if (!soft) {
        const key = healthKey(pluginId, runtime.manifest.hash, source, quality, checkSongKey(song));
        healthReport(key, { ok: false, hard: true, message: result.message, at: Date.now() });
      }
    }
    return result;
  }

  const probeStarted = Date.now();
  const probe = await probeAudioUrl(resolved.url, song.durationSec);
  const probeMs = Date.now() - probeStarted;
  const probedBps = estimateBps(probe.sizeBytes, song.durationSec);
  // 码率对照用插件实际声明的档位（可能已降档），无声明时回落到请求档位
  const declaredQuality = resolved.quality ?? quality;

  let status: CheckPointResult["status"] = "ok";
  let message = "";
  if (!probe.ok) {
    status = probe.timedOut ? "soft" : "hard";
    message = probe.message || "探针失败";
  } else {
    const mismatch = judgeBitrateMismatch(declaredQuality, probedBps);
    if (mismatch) {
      status = "mismatch";
      message = mismatch;
    }
  }

  const result: CheckPointResult = {
    pluginId,
    source,
    quality: declaredQuality,
    status,
    message,
    sizeBytes: probe.sizeBytes,
    probedBps,
    linkMs,
    probeMs,
  };

  if (args.persist !== false) {
    const key = healthKey(pluginId, runtime.manifest.hash, source, quality, checkSongKey(song));
    if (status === "ok") {
      healthReport(key, { ok: true, sizeBytes: probe.sizeBytes, at: Date.now() });
    } else if (status === "hard" || status === "mismatch") {
      healthReport(key, {
        ok: false,
        hard: true,
        message,
        sizeBytes: probe.sizeBytes,
        at: Date.now(),
      });
    }
  }
  return result;
};

/** 体检单点默认超时（渲染层据此估算整体耗时） */
export const CHECK_POINT_HINT_TIMEOUT_MS = ACTION_TIMEOUTS.musicUrl;
