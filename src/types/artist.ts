import type { Track, TrackSource } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";

/** 封面摘要卡片 */
export interface CoverItem {
  /** ID */
  id: string;
  /** 标题 */
  title: string;
  /** 封面 */
  cover?: string;
  /** 副标题/描述 */
  subtitle?: string;
  /** 歌曲数量 */
  trackCount: number;
  /** 在线来源，用于跨平台卡片导航与唯一标识 */
  source?: Platform;
}

/** 歌手详情 */
export interface ArtistProfile {
  /** 歌手 ID（URL 编码的名称） */
  id: string;
  /** 歌手名 */
  name: string;
  /** 头像 */
  avatar?: string;
  /** 数据来源 */
  source: TrackSource;
  /** 歌曲列表 */
  tracks: Track[];
  /** 专辑列表 */
  albums: CoverItem[];
  /** 歌曲数量 */
  trackCount: number;
  /** 专辑数量 */
  albumCount: number;
}
