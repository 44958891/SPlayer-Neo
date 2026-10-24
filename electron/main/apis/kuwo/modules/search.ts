/**
 * 酷我搜索模块
 *
 * 分类：
 * - 0 / "song":     单曲
 * - 8 / "album":    专辑
 * - 9 / "artist":   歌手
 * - 2 / "playlist": 歌单
 *
 * 全部走 search.kuwo.cn 的 r.s 通道（伪 JSON）。
 */

import {
  KW_SEARCH_URL,
  decodeKwName,
  fillKwArtistPic,
  fillKwCover,
  kwIdFromRid,
} from "../core/config";
import { kwRequest } from "../core/request";
import type {
  KWAlbumItem,
  KWArtistItem,
  KWModule,
  KWPlaylistItem,
  KWRawSong,
  KWSong,
} from "../core/types";

interface SongSearchResp {
  TOTAL?: string;
  abslist?: KWRawSong[];
}

interface AlbumSearchResp {
  TOTAL?: string;
  albumlist?: Array<{
    albumid?: string;
    name?: string;
    artist?: string;
    artistid?: string;
    pic?: string;
    info?: string;
    musiccnt?: string | number;
  }>;
}

interface ArtistSearchResp {
  TOTAL?: string;
  abslist?: Array<{
    ARTIST?: string;
    ARTISTID?: string;
    PICPATH?: string;
    ALBUMNUM?: string;
    SONGNUM?: string;
  }>;
}

interface PlaylistSearchResp {
  TOTAL?: string;
  abslist?: Array<{
    playlistid?: string;
    name?: string;
    nickname?: string;
    pic?: string;
    songnum?: string | number;
    playcnt?: string | number;
    intro?: string;
  }>;
}

/** 歌手字段拆分为多人（酷我用 & 分隔，已被解码为 &） */
const splitKwArtists = (artist: string): Array<{ id: string; name: string }> => {
  const decoded = decodeKwName(artist);
  if (!decoded) return [];
  return decoded
    .split(/[&、/,;]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: name, name }));
};

/**
 * 归一化酷我歌曲
 * @param raw - 原始条目
 */
export const normalizeKwSong = (raw: KWRawSong): KWSong => {
  const rid = raw.musicrid ?? raw.MUSICRID ?? raw.DC_TARGETID ?? "";
  const id = kwIdFromRid(rid) || String(raw.id ?? "");
  // 搜索接口标题/歌手为大写字段（含 HTML 实体），详情接口为小写，两者都取
  const artist = decodeKwName(raw.artist ?? raw.ARTIST ?? "");
  const durationRaw = raw.duration ?? raw.DURATION ?? 0;
  const duration = Math.max(0, Number(durationRaw) || 0) * 1000;
  return {
    id,
    name: decodeKwName(raw.name ?? raw.NAME ?? raw.songname ?? raw.SONGNAME ?? ""),
    artist,
    artists: splitKwArtists(artist),
    album: decodeKwName(raw.album ?? raw.ALBUM ?? ""),
    albumId: String(raw.albumId ?? raw.albumid ?? raw.ALBUMID ?? ""),
    cover: raw.albumpic
      ? raw.albumpic.replace(/\/120\//, "/300/").replace(/^http:\/\//, "https://")
      : fillKwCover(raw.web_albumpic_short, 300),
    duration,
    formats: raw.formats ?? raw.FORMATS ?? undefined,
  };
};

const searchSongs = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KW_SEARCH_URL}?all=${encodeURIComponent(keywords)}` +
    `&ft=music&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}` +
    // vipver 决定是否返回 ALBUM / ALBUMID / web_albumpic_short（缺省时三者全空 → 无封面无专辑名）
    `&rformat=json&encoding=utf8&vipver=MUSIC_9.1.1.2_W1`;
  const body = await kwRequest<SongSearchResp>(url);
  const raw = body.abslist ?? [];
  const songs = raw.map(normalizeKwSong).filter((song) => song.id);
  return { code: 200, total: Number(body.TOTAL ?? songs.length) || songs.length, songs };
};

const searchAlbums = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KW_SEARCH_URL}?all=${encodeURIComponent(keywords)}` +
    `&ft=album&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}` +
    `&rformat=json&encoding=utf8&vipver=MUSIC_9.1.1.2_W1`;
  const body = await kwRequest<AlbumSearchResp>(url);
  const raw = body.albumlist ?? [];
  const albums: KWAlbumItem[] = raw.map((item) => ({
    id: String(item.albumid ?? ""),
    name: decodeKwName(item.name),
    artist: decodeKwName(item.artist),
    artistId: item.artistid ? String(item.artistid) : undefined,
    cover: fillKwCover(item.pic, 300),
    trackCount: Number(item.musiccnt ?? 0) || undefined,
    intro: decodeKwName(item.info) || undefined,
  }));
  return { code: 200, total: Number(body.TOTAL ?? albums.length) || albums.length, albums };
};

const searchArtists = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KW_SEARCH_URL}?all=${encodeURIComponent(keywords)}` +
    `&ft=artist&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}` +
    `&rformat=json&encoding=utf8&vipver=MUSIC_9.1.1.2_W1`;
  const body = await kwRequest<ArtistSearchResp>(url);
  const raw = body.abslist ?? [];
  const artists: KWArtistItem[] = raw.map((item) => ({
    id: String(item.ARTISTID ?? ""),
    name: decodeKwName(item.ARTIST),
    cover: fillKwArtistPic(item.PICPATH),
    albumCount: Number(item.ALBUMNUM ?? 0) || undefined,
    songCount: Number(item.SONGNUM ?? 0) || undefined,
  }));
  return { code: 200, total: Number(body.TOTAL ?? artists.length) || artists.length, artists };
};

const searchPlaylists = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KW_SEARCH_URL}?all=${encodeURIComponent(keywords)}` +
    `&ft=playlist&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}` +
    `&rformat=json&encoding=utf8&vipver=MUSIC_9.1.1.2_W1`;
  const body = await kwRequest<PlaylistSearchResp>(url);
  const raw = body.abslist ?? [];
  const playlists: KWPlaylistItem[] = raw.map((item) => ({
    id: String(item.playlistid ?? ""),
    name: decodeKwName(item.name),
    cover: item.pic ? item.pic.replace(/^http:\/\//, "https://") : undefined,
    creator: decodeKwName(item.nickname),
    trackCount: Number(item.songnum ?? 0) || undefined,
    playCount: Number(item.playcnt ?? 0) || undefined,
    description: decodeKwName(item.intro) || undefined,
  }));
  return {
    code: 200,
    total: Number(body.TOTAL ?? playlists.length) || playlists.length,
    playlists,
  };
};

const search: KWModule = async (params) => {
  const {
    keywords,
    page = 1,
    limit = 30,
    type = 0,
  } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
    type?: number | string;
  };
  if (!keywords) return { code: 400, total: 0, message: "keywords required" };
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Number(limit) || 30);
  if (type === 0 || type === "song") return searchSongs(keywords, pageNum, limitNum);
  if (type === 8 || type === "album") return searchAlbums(keywords, pageNum, limitNum);
  if (type === 9 || type === "artist") return searchArtists(keywords, pageNum, limitNum);
  if (type === 2 || type === "playlist") return searchPlaylists(keywords, pageNum, limitNum);
  return { code: 400, total: 0, message: `unsupported kw search type: ${type}` };
};

export default search;
