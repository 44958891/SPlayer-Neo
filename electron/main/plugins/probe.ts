/**
 * 音频 URL 探针（主进程）
 *
 * 借鉴 GZ Music 的音源体检：下载前对取链得到的 URL 发 1 字节 Range 请求，
 * 拿 HTTP 状态、Content-Type 与完整体积（content-range 总长）做前置判定，
 * 提前拦截"试听片段 / 防盗链页面 / 无效数据"，避免下载后才发现不可用。
 *
 * 使用 Electron net.fetch（走系统代理），6s 超时，只读 1 字节后主动取消。
 */

import { net } from "electron";
import { judgeProbe, parseContentSize, type ProbeVerdict } from "@shared/utils/audioProbe";
import { pluginLog } from "@main/utils/logger";

/** 单次探针超时 */
const PROBE_TIMEOUT_MS = 6_000;

/** 探针结果（含实测体积，供下载进度兜底） */
export interface ProbeResult extends ProbeVerdict {
  /** 探测到的完整文件体积（字节）；未知为 0 */
  sizeBytes: number;
  /** 是否超时（软失败，调用方可用更长超时重试一次） */
  timedOut: boolean;
}

/**
 * 探测音频 URL 可用性
 * @param url - 音频直链
 * @param durationSec - 歌曲时长（秒）；0 表示未知，跳过体积反推
 */
export const probeAudioUrl = async (url: string, durationSec: number): Promise<ProbeResult> => {
  // 入参校验：畸形 URL 直接给出结论，不让 net.fetch 抛到 IPC 边界外
  if (typeof url !== "string" || url.trim() === "") {
    return { ok: false, hard: true, message: "URL 为空", sizeBytes: 0, timedOut: false };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      hard: true,
      message: `URL 无效（${url.slice(0, 80)}）`,
      sizeBytes: 0,
      timedOut: false,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      hard: true,
      message: `不支持的协议（${parsed.protocol}）`,
      sizeBytes: 0,
      timedOut: false,
    };
  }
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type");
    const sizeBytes = parseContentSize(
      res.headers.get("content-range"),
      res.headers.get("content-length"),
      res.status,
    );
    // 只关心响应头：立刻丢弃 body，不等完整内容
    void res.body?.cancel().catch(() => {});
    const verdict = judgeProbe(
      { status: res.status, contentType, sizeBytes, finalUrl: res.url || url },
      safeDuration,
    );
    return { ...verdict, sizeBytes, timedOut: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = /abort|timeout/i.test(message);
    pluginLog.warn(`[probe] ${timedOut ? "超时" : "失败"}: ${url.slice(0, 120)} - ${message}`);
    return {
      ok: false,
      hard: !timedOut,
      message: timedOut ? "探测超时" : message,
      sizeBytes: 0,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
};
