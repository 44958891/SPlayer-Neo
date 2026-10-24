/**
 * 酷我模块类型定义
 */

export type KWParams = Record<string, unknown>;

export type KWModule = (params: KWParams) => Promise<unknown>;

/**
 * 伪 JSON 歌曲条目
 * 搜索接口（r.s ft=music）字段为大写（NAME/ARTIST/MUSICRID/FORMATS），
 * 专辑与歌手详情为小写（name/artist/musicrid/formats），歌单详情混用 `id`，此处全部兼容。
 */
export interface KWRawSong {
  name?: string;
  NAME?: string;
  songname?: string;
  SONGNAME?: string;
  artist?: string;
  ARTIST?: string;
  album?: string;
  ALBUM?: string;
  albumId?: string | number;
  albumid?: string | number;
  id?: string;
  musicrid?: string;
  MUSICRID?: string;
  duration?: string | number;
  DURATION?: string | number;
  formats?: string;
  FORMATS?: string;
  ALBUMID?: string;
  web_albumpic_short?: string;
  web_artistpic_short?: string;
  /** 歌单详情里为完整封面 URL（120 尺寸） */
  albumpic?: string;
  /** 歌单详情里的艺人 id */
  artistPic?: string;
  artistid?: string;
  ARTISTID?: string;
  DC_TARGETID?: string;
  MINFO?: string;
}

/** 归一化歌曲 */
export interface KWSong {
  id: string;
  name: string;
  artist: string;
  artists: Array<{ id: string; name: string }>;
  album: string;
  albumId: string;
  cover?: string;
  duration: number;
  /** 原始 FORMATS 描述（渲染端推导可用最高音质） */
  formats?: string;
}

/** 专辑条目（搜索结果） */
export interface KWAlbumItem {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  cover?: string;
  trackCount?: number;
  intro?: string;
}

/** 歌手条目（搜索结果） */
export interface KWArtistItem {
  id: string;
  name: string;
  cover?: string;
  albumCount?: number;
  songCount?: number;
}

/** 歌单条目（搜索结果） */
export interface KWPlaylistItem {
  id: string;
  name: string;
  cover?: string;
  creator?: string;
  trackCount?: number;
  playCount?: number;
  description?: string;
}
