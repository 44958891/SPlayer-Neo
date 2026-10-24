import type { IpcResponse, Track } from "./player";
import type { TrackTags, TagEditRequest, TagWriteOutcome } from "./tagEditor";

/** 批量读标签的精简结果（只回"是否缺封面/歌词"判定所需字段） */
export interface TagBatchEntry {
  path: string;
  ok: boolean;
  /** 是否有内嵌封面 */
  hasCover?: boolean;
  /** 内嵌歌词长度（0 表示无歌词） */
  lyricLength?: number;
  /** 读取失败原因 */
  error?: string;
}

/** 专辑聚合项 */
export interface AlbumSummary {
  name: string;
  cover?: string;
  artist: string;
  trackCount: number;
}

/** 歌手聚合项 */
export interface ArtistSummary {
  name: string;
  trackCount: number;
  /** 该歌手任一曲目的封面 */
  cover?: string;
}

/** 扫描进度事件 */
export interface ScanProgress {
  phase: "scanning" | "done" | "error";
  /** 总文件数 */
  total: number;
  /** 已扫描文件数 */
  scanned: number;
  /** 当前正在处理的文件名 */
  current?: string;
  /** 错误信息（仅 error 阶段） */
  error?: string;
}

/** 音乐库 API */
export interface LibraryApi {
  /**
   * 开始扫描
   * @param incremental 是否增量扫描（跳过未变化的文件）
   */
  scan: (incremental?: boolean) => Promise<IpcResponse>;
  /** 取消扫描 */
  cancelScan: () => Promise<IpcResponse>;
  /** 获取全部曲目 */
  getTracks: () => Promise<IpcResponse<Track[]>>;
  /** 获取专辑聚合列表 */
  getAlbums: () => Promise<IpcResponse<AlbumSummary[]>>;
  /** 获取歌手聚合列表 */
  getArtists: () => Promise<IpcResponse<ArtistSummary[]>>;
  /** 获取某专辑下的全部曲目 */
  getAlbumTracks: (albumName: string) => Promise<IpcResponse<Track[]>>;
  /** 获取某歌手的全部曲目 */
  getArtistTracks: (artistName: string) => Promise<IpcResponse<Track[]>>;
  /** 按 ID 批量获取曲目 */
  getTracksByIds: (ids: string[]) => Promise<IpcResponse<Track[]>>;
  /** 搜索曲目 */
  searchTracks: (query: string) => Promise<IpcResponse<Track[]>>;
  /** 获取曲目总数 */
  getTrackCount: () => Promise<IpcResponse<number>>;
  /** 随机取一首曲目 */
  getRandomTrack: () => Promise<IpcResponse<Track | null>>;
  /** 随机取多首曲目 */
  getRandomTracks: (limit: number) => Promise<IpcResponse<Track[]>>;
  /** 获取扫描状态 */
  isScanning: () => Promise<IpcResponse<boolean>>;
  /** 弹出目录选择器，添加扫描目录 */
  addScanDir: () => Promise<IpcResponse<string>>;
  /** 移除扫描目录及其下曲目 */
  removeScanDir: (dir: string) => Promise<IpcResponse>;
  /** 获取已配置的扫描目录 */
  getScanDirs: () => Promise<IpcResponse<string[]>>;
  /** 删除曲目文件并从数据库移除 */
  deleteTracks: (paths: string[]) => Promise<IpcResponse<{ deleted: number; failed: number }>>;
  /** 读取本地文件的可编辑标签 */
  readTags: (path: string) => Promise<IpcResponse<TrackTags>>;
  /**
   * 批量读取标签（只回"是否缺封面/歌词"判定所需字段）
   *
   * 逐首 readTags 的 IPC 往返在几千首规模下不可忽略；读取失败项回 `ok: false`，
   * 调用方据此跳过而不是误判为"缺"。
   */
  readTagsBatch: (paths: string[]) => Promise<IpcResponse<TagBatchEntry[]>>;
  /** 批量写入文件标签 */
  writeTags: (edits: TagEditRequest[]) => Promise<IpcResponse<TagWriteOutcome[]>>;
  /** 弹出文件选择器，选择封面图片（返回路径与预览 dataUrl） */
  pickCoverImage: () => Promise<IpcResponse<{ path: string; dataUrl: string }>>;
  /** 获取本地歌手头像 */
  fetchArtistAvatar: (artistName: string) => Promise<IpcResponse<string | null>>;
  /** 批量预取歌手头像 */
  prefetchArtistAvatars: (artistNames: string[]) => Promise<IpcResponse<Record<string, string>>>;
  /** 订阅扫描进度事件 */
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
}
