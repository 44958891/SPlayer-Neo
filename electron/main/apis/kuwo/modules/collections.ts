/**
 * 酷我专辑 / 歌手 / 歌单详情模块
 *
 * - album:    search.kuwo.cn r.s stype=albuminfo
 * - artist:   search.kuwo.cn r.s stype=artist2music
 * - playlist: nplserver.kuwo.cn pl.svc getlistinfo
 */

import {
  KW_HEADERS,
  KW_PLAYLIST_URL,
  KW_SEARCH_URL,
  KW_USER_INFO_URL,
  decodeKwName,
  fillKwArtistPic,
  fillKwCover,
} from "../core/config";
import { kwRequest, kuwoCookieHeader } from "../core/request";
import type { KWRawSong, KWModule } from "../core/types";
import { normalizeKwSong } from "./search";

interface AlbumInfoResp {
  albumid?: string;
  name?: string;
  artist?: string;
  artistid?: string;
  img?: string;
  hts_img?: string;
  info?: string;
  lang?: string;
  company?: string;
  musiclist?: KWRawSong[];
}

interface ArtistMusicResp {
  artist?: string;
  artistpic?: string;
  musiclist?: KWRawSong[];
}

interface PlaylistInfoResp {
  id?: string | number;
  title?: string;
  name?: string;
  uname?: string;
  nickname?: string;
  info?: string;
  pic?: string;
  hts_pic?: string;
  total?: string | number;
  musiclist?: KWRawSong[];
}

/** 专辑详情：元数据 + 曲目 */
const album: KWModule = async (params) => {
  const {
    id,
    page = 1,
    limit = 100,
  } = params as {
    id?: string;
    page?: number;
    limit?: number;
  };
  if (!id) return { code: 400, message: "id required" };
  const url =
    `${KW_SEARCH_URL}?stype=albuminfo&albumid=${encodeURIComponent(id)}` +
    `&client=kt&pn=${Math.max(0, Number(page) - 1)}&rn=${limit}` +
    `&rformat=json&encoding=utf8&vipver=MUSIC_9.1.1.2_W1`;
  const body = await kwRequest<AlbumInfoResp>(url);
  const songs = (body.musiclist ?? []).map(normalizeKwSong).filter((song) => song.id);
  return {
    code: 200,
    id: String(body.albumid ?? id),
    name: decodeKwName(body.name),
    cover: body.hts_img || body.img,
    artist: decodeKwName(body.artist),
    artistId: body.artistid ? String(body.artistid) : undefined,
    description: decodeKwName(body.info) || undefined,
    publishTime: undefined,
    total: songs.length,
    songs,
  };
};

/** 歌手详情：热门歌曲（first page） */
const artist: KWModule = async (params) => {
  const {
    id,
    page = 1,
    limit = 50,
  } = params as {
    id?: string;
    page?: number;
    limit?: number;
  };
  if (!id) return { code: 400, message: "id required" };
  const url =
    `${KW_SEARCH_URL}?stype=artist2music&artistid=${encodeURIComponent(id)}` +
    `&client=kt&pn=${Math.max(0, Number(page) - 1)}&rn=${limit}` +
    `&rformat=json&encoding=utf8&sortby=0&vipver=MUSIC_9.1.1.2_W1`;
  const body = await kwRequest<ArtistMusicResp>(url);
  const songs = (body.musiclist ?? []).map(normalizeKwSong).filter((song) => song.id);
  return {
    code: 200,
    id: String(id),
    name: decodeKwName(body.artist),
    avatar: fillKwArtistPic(body.artistpic),
    songs,
  };
};

/** 歌单详情：元数据 + 曲目 */
const playlist: KWModule = async (params) => {
  const {
    id,
    page = 1,
    limit = 100,
  } = params as {
    id?: string;
    page?: number;
    limit?: number;
  };
  if (!id) return { code: 400, message: "id required" };
  const url =
    `${KW_PLAYLIST_URL}?op=getlistinfo&pid=${encodeURIComponent(id)}` +
    `&pn=${Math.max(0, Number(page) - 1)}&rn=${limit}` +
    `&encode=utf-8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.1.1.2_W1&newver=1`;
  const body = await kwRequest<PlaylistInfoResp>(url);
  const songs = (body.musiclist ?? []).map(normalizeKwSong).filter((song) => song.id);
  return {
    code: 200,
    id: String(body.id ?? id),
    name: decodeKwName(body.title ?? body.name),
    creator: decodeKwName(body.nickname ?? body.uname),
    description: decodeKwName(body.info) || undefined,
    cover: (body.hts_pic || body.pic || undefined)?.replace(/^http:\/\//, "https://"),
    total: Number(body.total ?? songs.length) || songs.length,
    songs,
  };
};

/** 歌曲详情与封面补全（按 id 直取单曲信息，专辑页缺封面时用） */
const cover: KWModule = async (params) => {
  const { shortPath, size = 300 } = params as { shortPath?: string; size?: number };
  return { url: fillKwCover(shortPath, size) };
};

/**
 * 登录态与账号信息
 * 已登录时站点接口返回 data.userid 等；未登录 data 为空或 code≠200
 */
const userInfo: KWModule = async () => {
  const url = `${KW_USER_INFO_URL}?httpsStatus=1`;
  const cookie = kuwoCookieHeader();
  const res = await fetch(url, {
    headers: { ...KW_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status !== 200) return { code: res.status };
  const body = (await res.json()) as {
    code?: number;
    data?: Record<string, unknown> | null;
    success?: boolean;
  };
  const data = body.data ?? null;
  const userId = data ? String((data as { userid?: unknown }).userid ?? "") : "";
  if (!userId || userId === "0") return { code: 200, data: null };
  return { code: 200, data };
};

export { album, artist, playlist, cover, userInfo };
