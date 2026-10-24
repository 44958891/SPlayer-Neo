/**
 * 音频 URL 探针判定（纯函数，主进程与测试共用）
 *
 * 借鉴 GZ Music 的音源体检思路：对取链得到的 URL 发 1 字节 Range 请求，
 * 用 HTTP 状态 / Content-Type / 完整体积反推时长，在下载前识别
 * "试听片段、防盗链页面、无效数据"三类不可用结果。
 */

/** 探针响应头摘要 */
export interface ProbeHeaders {
  /** HTTP 状态码 */
  status: number;
  /** 响应 Content-Type（可为空串） */
  contentType: string | null;
  /** 完整文件体积（content-range 总长优先，其次 content-length）；未知为 0 */
  sizeBytes: number;
  /** 最终 URL（跟随重定向后），用于扩展名兜底判定 */
  finalUrl?: string;
}

/** 探针结论 */
export interface ProbeVerdict {
  /** 是否可用 */
  ok: boolean;
  /** 是否硬失败（永久性问题；软失败由调用方自行决定重试策略） */
  hard: boolean;
  /** 人类可读原因（ok 时为空） */
  message: string;
}

/** 体积地板：低于 durationSec × 8KB/s（约 64kbps）视为试听片段/防盗链语音 */
export const MIN_BYTES_PER_SEC = 8000;

/** 可接受的音频 Content-Type 前缀（octet-stream 常见于未配 MIME 的 CDN） */
const ACCEPTABLE_MIME_PREFIXES = [
  "audio/",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-flac",
];

/** 音频扩展名（无 Content-Type 时按 URL 兜底） */
const AUDIO_EXT_RE = /\.(mp3|flac|wav|m4a|aac|ogg|opus|ape|wv|aiff?)(?:[?#]|$)/i;

/**
 * 依据探针响应判定 URL 可用性
 * @param headers - 响应头摘要
 * @param durationSec - 歌曲时长（秒）；0 表示未知，跳过体积反推
 */
export const judgeProbe = (headers: ProbeHeaders, durationSec: number): ProbeVerdict => {
  if (!Number.isFinite(headers.status) || headers.status < 200 || headers.status >= 400) {
    return { ok: false, hard: true, message: `HTTP ${headers.status}` };
  }
  const rawType = (headers.contentType ?? "").trim();
  const type = rawType.toLowerCase();
  const hasType = type !== "";
  const mimeAcceptable =
    !hasType || ACCEPTABLE_MIME_PREFIXES.some((prefix) => type.startsWith(prefix));
  const extAcceptable = headers.finalUrl ? AUDIO_EXT_RE.test(headers.finalUrl) : false;
  if (!mimeAcceptable) {
    // 有明确的非音频类型（text/html、application/json）→ 定论硬失败
    return {
      ok: false,
      hard: true,
      message: `返回内容非音频（${rawType.split(";")[0] || "未知类型"}）`,
    };
  }
  if (!hasType && !extAcceptable) {
    // 缺 Content-Type 且 URL 无音频后缀：信息不足，判软失败（不落体检表，试下一个候选）
    return { ok: false, hard: false, message: "无 Content-Type 且无音频扩展名，无法确认" };
  }
  if (durationSec > 0 && headers.sizeBytes > 0) {
    const floor = durationSec * MIN_BYTES_PER_SEC;
    if (headers.sizeBytes < floor) {
      const sizeMB = (headers.sizeBytes / 1048576).toFixed(1);
      const minutes = Math.max(1, Math.round(durationSec / 60));
      return {
        ok: false,
        hard: true,
        message: `文件仅 ${sizeMB} MB（歌曲约 ${minutes} 分钟），疑似试听片段或防盗链语音`,
      };
    }
  }
  return { ok: true, hard: false, message: "" };
};

/**
 * 从 content-range / content-length 解析完整文件体积
 *
 * 注意 206 的语义：Range 请求返回 206 时 `content-length` 是**这一小段的长度**
 * （通常就是 1），只有 `content-range` 尾部才带完整文件大小。因此 206 且没有
 * content-range 时体积视为未知（返回 0，由调用方跳过体积反推），
 * 绝不能拿分段长度当完整大小 —— 否则可用链接会被误判成"试听片段"。
 *
 * @param contentRange - 形如 `bytes 0-0/12345` 的响应头
 * @param contentLength - content-length 响应头
 * @param status - HTTP 状态码；206 表示分段响应（缺省按非分段处理）
 * @returns 完整体积（字节）；无法确知返回 0
 */
export const parseContentSize = (
  contentRange: string | null,
  contentLength: string | null,
  status?: number,
): number => {
  if (contentRange) {
    const match = /\/(\d+)\s*$/.exec(contentRange);
    if (match) return Number(match[1]) || 0;
  }
  // 206 表示分段响应：无 content-range 时拿不到完整大小，不得用分段长度顶替
  if (status === 206) return 0;
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

/** 是否为超时类错误（软失败），用于重试判定 */
export const isTimeoutMessage = (message: string): boolean =>
  /超时|timed?\s*out|aborted due to timeout|timeout/i.test(message);

/** 探针完整结果（含实测体积与软失败标记） */
export interface AudioProbeResult extends ProbeVerdict {
  /** 探测到的完整文件体积（字节）；未知为 0 */
  sizeBytes: number;
  /** 是否超时（软失败，调用方可用更长超时重试一次） */
  timedOut: boolean;
}

/**
 * 体检结论（持久化形状，跨主/渲染的 IPC 传输用）
 * 与主进程 health.ts 的落盘字段一致
 */
export interface PluginHealthEntry {
  ok: boolean;
  /** 硬失败 = 永久性问题（无版权/无链接/非音频/试听片段）；软失败不落表 */
  hard?: boolean;
  message?: string;
  /** 探测到的完整文件体积（成功时） */
  sizeBytes?: number;
  at: number;
}

/**
 * 组装体检键：{插件ID}#{脚本hash}|{平台源}|{音质档}|{曲目键}
 *
 * 脚本 hash 变化（插件更新）后旧结论自动失效，不会误伤新版本脚本。
 * 曲目键（如 `netease:123456`）必须带上：无版权/无链接类硬失败是单曲级的，
 * 不带曲目键会把"某首歌拿不到"误记成"该插件整体不可用"。
 * 主进程 health.ts 与本文件共用此规则，保证两侧键完全一致。
 */
export const buildHealthKey = (
  pluginId: string,
  pluginHash: string | undefined,
  source: string,
  quality: string,
  trackKey?: string,
): string =>
  `${pluginId}#${pluginHash ?? ""}|${source}|${quality}${trackKey ? `|${trackKey}` : ""}`;
