/**
 * QM 四分类搜索
 */

import { formatSingerName } from "../core/config";
import { getQQMusicUin, qmRequest, QMRequestError } from "../core/request";
import type { QMModule } from "../core/types";
import { coreLog } from "@main/utils/logger";

const secureUrl = (url: string | undefined): string => url?.replace(/^http:/, "https:") ?? "";
const stripHighlight = (text: string | undefined): string => text?.replace(/<\/?em>/g, "") ?? "";

interface MobileSong {
  id?: number;
  mid?: string;
  title?: string;
  interval?: number;
  singer?: Array<{ id?: number; mid?: string; name?: string }>;
  album?: { mid?: string; name?: string; title?: string; pmid?: string };
  file?: {
    media_mid?: string;
    size_128mp3?: number;
    size_320mp3?: number;
    size_ape?: number;
    size_flac?: number;
    size_192ogg?: number;
    size_hires?: number;
    size_new?: number[];
    hires_sample?: number;
    hires_bitdepth?: number;
  };
  pay?: {
    pay_month?: number;
    pay_play?: number;
    price_album?: number;
  };
}

interface MobileSearchResponse {
  body?: {
    item_song?: MobileSong[];
    item_album?: MobileAlbum[];
    singer?: MobileArtist[];
    item_songlist?: MobilePlaylist[];
  };
  meta?: { sum?: number };
}

interface MobileAlbum {
  id?: number;
  albummid?: string;
  name?: string;
  pic?: string;
  singer?: string;
  singer_list?: Array<{ mid?: string; name?: string }>;
  song_num?: number;
}

interface MobileArtist {
  singerID?: number;
  singerMID?: string;
  singerName?: string;
  singerPic?: string;
  iconurl?: string;
  albumNum?: number;
  songNum?: number;
}

interface MobilePlaylist {
  dissid?: string;
  dissname?: string;
  logo?: string;
  layer_url?: string;
  songnum?: number;
  listennum?: number;
  nickname?: string;
}

/** 生成移动端搜索请求所需的会话 ID */
const createSearchId = (): string => {
  const group = BigInt(Math.floor(Math.random() * 20) + 1);
  const random = BigInt(Math.floor(Math.random() * 4194305));
  const todayMs = BigInt(Date.now() % 86400000);
  return String(group * 18014398509481984n + random * 4294967296n + todayMs);
};

const searchMobile = (keywords: string, page: number, limit: number, searchType: number) =>
  qmRequest<MobileSearchResponse>(
    "music.search.SearchCgiService",
    "DoSearchForQQMusicMobile",
    {
      search_id: createSearchId(),
      remoteplace: "search.android.keyboard",
      query: keywords,
      page_num: page,
      num_per_page: limit,
      search_type: searchType,
      highlight: 0,
      nqc_flag: 0,
      page_id: 1,
      grp: 1,
    },
    // 方法、版本及请求头统一使用公共 Mobile 参数
    { auth: true },
  );

/** 网页通道只保留实际映射需要的字段，不把缺失结构当成空结果 */
interface WebSearchItem {
  songid?: number;
  songmid?: string;
  songname?: string;
  interval?: number;
  singer?: MobileSong["singer"];
  albummid?: string;
  albumname?: string;
  media_mid?: string;
  strMediaMid?: string;
  pay?: { payalbum?: number; payplay?: number };
  size128?: number;
  size320?: number;
  sizeape?: number;
  sizeflac?: number;
  sizeogg?: number;
  albumID?: number;
  albumMID?: string;
  albumName?: string;
  albumPic?: string;
  singerMID?: string;
  singerName?: string;
  singer_list?: MobileAlbum["singer_list"];
  song_count?: number;
  singerID?: number;
  singerPic?: string;
  albumNum?: number;
  songNum?: number;
  dissid?: string;
  dissname?: string;
  imgurl?: string;
  creator?: { name?: string };
  listennum?: number;
}

interface WebSearchGroup {
  list?: WebSearchItem[];
  totalnum?: number;
  display_num?: number;
  sum?: number;
}

interface WebSearchResponse {
  code?: number;
  data?: WebSearchGroup & {
    song?: WebSearchGroup;
    album?: WebSearchGroup;
    singer?: WebSearchGroup;
  };
}

const SEARCH_COOLDOWN = 60 * 1000;
let unavailableMobile: { account: string; until: number } | undefined;

/** 校验业务分类结构，合法的空列表与服务端异常分别处理
 * @param data - 搜索结果
 * @param searchType - Mobile 分类编号
 * @returns 可继续格式化的业务结果
 */
const validateSearch = (data: MobileSearchResponse, searchType: number): MobileSearchResponse => {
  const items =
    searchType === 0
      ? data?.body?.item_song
      : searchType === 2
        ? data?.body?.item_album
        : searchType === 1
          ? data?.body?.singer
          : data?.body?.item_songlist;
  if (!Array.isArray(items)) throw new Error("QM search returned an invalid result structure");
  return data;
};

/** 使用 QQ 官方网页同平台通道，并转换为现有 Mobile 业务结构
 * @param keywords - 搜索词
 * @param page - 从 1 开始的页码
 * @param limit - 每页条数
 * @param searchType - Mobile 分类编号
 * @returns 与主搜索一致的结构
 */
const searchWeb = async (
  keywords: string,
  page: number,
  limit: number,
  searchType: number,
): Promise<MobileSearchResponse> => {
  const playlist = searchType === 3;
  const url = new URL(
    playlist
      ? "https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist"
      : "https://c.y.qq.com/soso/fcgi-bin/client_search_cp",
  );
  const params = playlist
    ? {
        format: "json",
        query: keywords,
        page_no: String(page - 1),
        num_per_page: String(limit),
        remoteplace: "txt.yqq.playlist",
      }
    : {
        format: "json",
        w: keywords,
        p: String(page),
        n: String(limit),
        cr: "1",
        g_tk: "5381",
        t: String(searchType === 2 ? 8 : searchType === 1 ? 9 : 0),
      };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      Referer: "https://y.qq.com/",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`QM web search HTTP ${response.status}`);
  const data = (await response.json()) as WebSearchResponse;
  if (data.code !== 0) throw new Error(`QM web search error: ${data.code ?? "unknown"}`);
  const group =
    searchType === 0
      ? data.data?.song
      : searchType === 2
        ? data.data?.album
        : searchType === 1
          ? data.data?.singer
          : data.data;
  if (!Array.isArray(group?.list))
    throw new Error("QM web search returned an invalid result structure");
  const body: NonNullable<MobileSearchResponse["body"]> = {};
  if (searchType === 0) {
    body.item_song = group.list.map((song) => ({
      id: song.songid,
      mid: song.songmid,
      title: stripHighlight(song.songname),
      interval: song.interval,
      singer: song.singer,
      album: { mid: song.albummid, name: song.albumname },
      file: {
        media_mid: song.strMediaMid || song.media_mid,
        size_128mp3: song.size128,
        size_320mp3: song.size320,
        size_ape: song.sizeape,
        size_flac: song.sizeflac,
        size_192ogg: song.sizeogg,
      },
      pay: {
        pay_month: song.pay?.payalbum ? 0 : undefined,
        price_album: song.pay?.payalbum,
        pay_play: song.pay?.payplay,
      },
    }));
  } else if (searchType === 2) {
    body.item_album = group.list.map((album) => ({
      id: album.albumID,
      albummid: album.albumMID,
      name: stripHighlight(album.albumName),
      pic: album.albumPic,
      singer: album.singerName,
      singer_list: album.singer_list ?? [{ mid: album.singerMID, name: album.singerName }],
      song_num: album.song_count,
    }));
  } else if (searchType === 1) {
    body.singer = group.list.map((artist) => ({
      singerID: artist.singerID,
      singerMID: artist.singerMID,
      singerName: stripHighlight(artist.singerName),
      singerPic: artist.singerPic,
      albumNum: artist.albumNum,
      songNum: artist.songNum,
    }));
  } else {
    body.item_songlist = group.list.map((item) => ({
      dissid: item.dissid,
      dissname: item.dissname,
      logo: item.imgurl,
      songnum: item.song_count,
      listennum: item.listennum,
      nickname: item.creator?.name,
    }));
  }
  return {
    body,
    meta: { sum: group.totalnum ?? group.sum ?? group.display_num ?? group.list.length },
  };
};

/** 主搜索遇到持续业务错误后短暂跳过，备用始终保持 QQ 来源
 * @param keywords - 搜索词
 * @param page - 从 1 开始的页码
 * @param limit - 每页条数
 * @param searchType - Mobile 分类编号
 * @returns 主或备用的有效搜索结果
 */
const searchWithFallback = async (
  keywords: string,
  page: number,
  limit: number,
  searchType: number,
): Promise<MobileSearchResponse> => {
  const account = getQQMusicUin();
  let primaryError: unknown;
  if (
    !unavailableMobile ||
    unavailableMobile.account !== account ||
    unavailableMobile.until <= Date.now()
  ) {
    try {
      const result = validateSearch(
        await searchMobile(keywords, page, limit, searchType),
        searchType,
      );
      unavailableMobile = undefined;
      return result;
    } catch (error) {
      primaryError = error;
      if (error instanceof QMRequestError && error.outerCode === 0 && error.innerCode === 2001) {
        unavailableMobile = { account, until: Date.now() + SEARCH_COOLDOWN };
      }
      coreLog.warn("[qm-search] 主搜索不可用，尝试 QQ 网页备用通道");
    }
  }
  try {
    return validateSearch(await searchWeb(keywords, page, limit, searchType), searchType);
  } catch (error) {
    if (primaryError) throw primaryError;
    throw error;
  }
};

const searchSongs = async (keywords: string, page: number, limit: number) => {
  const data = await searchWithFallback(keywords, page, limit, 0);
  const songs = (data.body?.item_song ?? []).map((song) => {
    const albumMid = song.album?.mid ?? "";
    const albumPmid = song.album?.pmid ?? "";
    const pictureMid = albumMid || albumPmid;
    return {
      id: String(song.id ?? ""),
      mid: song.mid ?? "",
      name: song.title ?? "",
      artist: formatSingerName(song.singer),
      artists: song.singer ?? [],
      album: song.album?.name || song.album?.title || "",
      albumMid,
      duration: (song.interval ?? 0) * 1000,
      mediaMid: song.file?.media_mid ?? "",
      pay: {
        payalbum: song.pay?.pay_month === 0 && (song.pay.price_album ?? 0) > 0 ? 1 : 0,
        payplay: song.pay?.pay_play ?? 0,
      },
      size128: song.file?.size_128mp3 ?? 0,
      size320: song.file?.size_320mp3 ?? 0,
      sizeApe: song.file?.size_ape ?? 0,
      sizeFlac: song.file?.size_flac ?? 0,
      sizeOgg: song.file?.size_192ogg ?? 0,
      sizeHiRes: song.file?.size_hires || song.file?.size_new?.[0] || 0,
      hiResSampleRate: song.file?.hires_sample ?? 0,
      hiResBitDepth: song.file?.hires_bitdepth ?? 0,
      cover: pictureMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${pictureMid}.jpg`
        : "",
      coverOriginal: pictureMid
        ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${pictureMid}.jpg`
        : "",
    };
  });
  return { code: 200, total: data.meta?.sum ?? songs.length, songs };
};

const searchAlbums = async (keywords: string, page: number, limit: number) => {
  const data = await searchWithFallback(keywords, page, limit, 2);
  const albums = (data.body?.item_album ?? []).map((album) => ({
    id: album.albummid ?? String(album.id ?? ""),
    name: album.name ?? "",
    cover: secureUrl(album.pic),
    artist: album.singer || formatSingerName(album.singer_list),
    artistMid: album.singer_list?.[0]?.mid ?? "",
    trackCount: album.song_num ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? albums.length, albums };
};

const searchArtists = async (keywords: string, page: number, limit: number) => {
  const data = await searchWithFallback(keywords, page, limit, 1);
  const artists = (data.body?.singer ?? []).map((artist) => ({
    id: artist.singerMID ?? String(artist.singerID ?? ""),
    name: artist.singerName ?? "",
    cover: secureUrl(artist.singerPic || artist.iconurl),
    albumCount: artist.albumNum ?? 0,
    songCount: artist.songNum ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? artists.length, artists };
};

const searchPlaylists = async (keywords: string, page: number, limit: number) => {
  const data = await searchWithFallback(keywords, page, limit, 3);
  const playlists = (data.body?.item_songlist ?? []).map((playlist) => ({
    id: playlist.dissid ?? "",
    name: stripHighlight(playlist.dissname),
    cover: secureUrl(playlist.logo || playlist.layer_url),
    creator: playlist.nickname ?? "",
    trackCount: playlist.songnum ?? 0,
    playCount: playlist.listennum ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? playlists.length, playlists };
};

const search: QMModule = async (params) => {
  const {
    keywords,
    page = 1,
    limit = 30,
    type = 0,
  } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
    type?: number;
  };
  if (!keywords) return { code: 400, total: 0, message: "keywords required" };
  if (type === 0) return searchSongs(keywords, page, limit);
  if (type === 8) return searchAlbums(keywords, page, limit);
  if (type === 9) return searchArtists(keywords, page, limit);
  if (type === 2) return searchPlaylists(keywords, page, limit);
  return { code: 400, total: 0, message: `unsupported search type: ${type}` };
};

export default search;
