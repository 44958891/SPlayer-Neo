import type { Platform } from "./platform";
import type { Track } from "./player";

/** 歌单来源类型 */
export type PlaylistType = "local";

/** 歌单列表项 */
export interface PlaylistSummary {
  id: string;
  type: PlaylistType;
  title: string;
  description?: string;
  cover?: string;
  trackCount: number;
  createTime: number;
  updateTime: number;
}

/** 完整歌单 */
export interface PlaylistDetail extends PlaylistSummary {
  tracks: Track[];
}

/** 创建歌单参数 */
export interface PlaylistCreateInput {
  type: PlaylistType;
  title: string;
  description?: string;
}

/** 更新歌单参数 */
export interface PlaylistUpdateInput {
  title?: string;
  description?: string;
  cover?: string;
}

/** 旧版 renderer 歌单迁移记录 */
export interface LegacyPlaylistRecord {
  id: string;
  title: string;
  description?: string;
  cover?: string;
  trackIds: string[];
  createTime?: number;
  updateTime?: number;
}

/** 在线歌单收藏输入（仅存引用元数据，不落 Track） */
export interface PlaylistFavoriteInput {
  /** 原平台 */
  source: Platform;
  /** 原平台歌单 ID */
  originId: string;
  /** 歌单标题 */
  title: string;
  /** 歌单封面 URL，仅接受 http(s) */
  cover?: string;
}

/** 已收藏的在线歌单（复合键 source + originId） */
export interface PlaylistFavorite extends PlaylistFavoriteInput {
  /** 首次收藏时间（毫秒） */
  createTime: number;
}

/** renderer 可用的歌单 API */
export interface PlaylistApi {
  list: () => Promise<PlaylistSummary[]>;
  get: (id: string) => Promise<PlaylistDetail | null>;
  create: (input: PlaylistCreateInput) => Promise<PlaylistSummary>;
  update: (id: string, input: PlaylistUpdateInput) => Promise<PlaylistSummary | null>;
  remove: (id: string) => Promise<void>;
  addTracks: (id: string, trackIds: string[]) => Promise<number>;
  /** 添加曲目对象（支持在线曲目：写入 external_tracks 快照） */
  addTrackObjects: (id: string, tracks: Track[]) => Promise<number>;
  removeTracks: (id: string, trackIds: string[]) => Promise<number>;
  importLegacy: (records: LegacyPlaylistRecord[]) => Promise<void>;
  clear: () => Promise<void>;
  /** 获取全部在线歌单收藏，按收藏时间倒序 */
  listFavorites: () => Promise<PlaylistFavorite[]>;
  /**
   * 收藏在线歌单，同源同 ID 重复收藏会刷新元数据并保留原收藏时间
   * @param input - 收藏信息
   * @returns 收藏后的记录
   */
  addFavorite: (input: PlaylistFavoriteInput) => Promise<PlaylistFavorite>;
  /**
   * 取消收藏在线歌单，仅按 source + originId 复合键删除
   * @param source - 原平台
   * @param originId - 原平台歌单 ID
   */
  removeFavorite: (source: Platform, originId: string) => Promise<void>;
}
