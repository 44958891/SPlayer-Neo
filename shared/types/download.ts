/**
 * 下载功能共享类型
 * 跨渲染层（解析 URL/歌词）与主进程（落盘/写标签）
 */

import type { Track } from "./player";
import type { PluginQuality } from "./plugin";

/** 下载歌词文件保存格式：逐行 LRC / 逐字增强 LRC */
export type DownloadLyricFormat = "lrc" | "enhanced-lrc";

/** 下载文件智能分类：不分文件夹 / 按歌手 / 按歌手再按专辑 */
export type DownloadFolderScheme = "none" | "artist" | "artist-album";

/** 下载任务状态 */
export type DownloadStatus =
  "queued" | "downloading" | "done" | "failed" | "canceled" | "interrupted";

/** 写入选项 */
export interface DownloadTagOptions {
  /** 内嵌封面 */
  embedCover: boolean;
  /** 内嵌标题/艺术家/专辑等元信息 */
  embedMeta: boolean;
  /** 内嵌歌词到标签 */
  embedLyric: boolean;
  /** 额外保存同名歌词文件 */
  writeLrc: boolean;
  /** 额外保存完整 TTML */
  saveTtml: boolean;
}

/** 渲染层 → 主进程的下载请求 */
export interface DownloadRequest {
  /** 渲染层生成的 UUID */
  taskId: string;
  track: Track;
  qualityLevel: PluginQuality;
  /** 已解析的音频 URL，批量整批入队时可缺省 */
  url?: string;
  /** 已知格式（netease 的 flac/mp3），用于确定扩展名 */
  declaredFormat?: string;
  /** 已知体积（字节），进度兜底 */
  declaredSize?: number;
  /** 封面原图 URL，主进程按需 fetch 内嵌 */
  coverUrl?: string;
  /** 歌词文本 */
  lyricText?: string;
  /** 完整 TTML 文本 */
  ttmlText?: string;
  tagOptions: DownloadTagOptions;
  /** 内嵌歌词与 .lrc 的保存格式 */
  lyricFileFormat: DownloadLyricFormat;
  /** 音质升级：覆盖下载目录，文件直接落到该绝对路径目录（不再套用文件夹分类规则） */
  targetDir?: string;
  /** 音质升级：下载成功后删除的本地原文件路径（失败不动原文件） */
  replaceSourcePath?: string;
  /**
   * 音质升级：替换的显式质量下限
   * 缺省时下限取自原文件探测结果；原文件已损坏（探测不出档位）时可用此字段强制要求目标档位
   */
  minLevel?: PluginQuality;
}

/** 主进程持有的下载任务 */
export interface DownloadTask {
  taskId: string;
  status: DownloadStatus;
  track: Track;
  qualityLevel: PluginQuality;
  /** 已接收字节 */
  received: number;
  /** 总字节（未知为 0） */
  total: number;
  /** 完成后最终文件路径 */
  filePath?: string;
  /** 失败原因码 */
  errorCode?: string;
  /** 写标签失败但音频已落盘 */
  tagWarning?: boolean;
  /** 已探测实际文件音质并回填 track.quality（音质标签按文件真实信息显示） */
  probed?: boolean;
  /** 音质升级：落地目录与待删除的原文件（重试时原样带上） */
  targetDir?: string;
  replaceSourcePath?: string;
  minLevel?: PluginQuality;
  createdAt: number;
  finishedAt?: number;
}

/** 下载进度推送 */
export interface DownloadProgress {
  taskId: string;
  received: number;
  total: number;
}

/** 渲染层回传的解析结果（补全 DownloadRequest 缺省的网络字段，url 必填） */
export type DownloadResolution = Required<Pick<DownloadRequest, "url">> &
  Pick<DownloadRequest, "declaredFormat" | "declaredSize" | "lyricText" | "ttmlText">;

/** 主进程 → 渲染层的解析请求载荷（轮到下载但缺少 URL 时下发） */
export type DownloadResolvePayload = Pick<
  DownloadRequest,
  "taskId" | "track" | "qualityLevel" | "tagOptions" | "coverUrl" | "lyricFileFormat"
>;

/** 入队结果；ok 为 false 时 reason 说明原因 */
export interface EnqueueResult {
  ok: boolean;
  /** queued=同曲同音质已在队列/下载中；downloaded=已下载过且文件仍在；existsLocal=下载目录已有同名音频 */
  reason?: "queued" | "downloaded" | "existsLocal";
}

/** 渲染端下载 IPC 入口 */
export interface DownloadApi {
  start: (req: DownloadRequest) => Promise<EnqueueResult>;
  startMany: (reqs: DownloadRequest[]) => Promise<EnqueueResult[]>;
  cancel: (taskId: string) => Promise<void>;
  retry: (req: DownloadRequest) => Promise<EnqueueResult>;
  remove: (taskId: string) => Promise<void>;
  clearFinished: () => Promise<void>;
  list: () => Promise<DownloadTask[]>;
  pickDir: () => Promise<{ ok: boolean; dir: string; reason?: "canceled" }>;
  getDir: () => Promise<string>;
  resetDir: () => Promise<string>;
  /** 回传即时解析结果（主进程 download:resolve 的应答） */
  submitResolution: (taskId: string, res: DownloadResolution) => Promise<void>;
  /** 上报即时解析失败，任务标记为 failed */
  failResolution: (taskId: string) => Promise<void>;
  onProgress: (callback: (data: DownloadProgress) => void) => () => void;
  onState: (callback: (task: DownloadTask) => void) => () => void;
  onResolve: (callback: (payload: DownloadResolvePayload) => void) => () => void;
}
