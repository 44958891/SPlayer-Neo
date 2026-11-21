import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import {
  qqAlbumToCoverItem,
  qqArtistToCoverItem,
  qqPlaylistToCoverItem,
  qqSongToTrack,
  type QMAlbumItem,
  type QMArtistItem,
  type QMPlaylistItem,
  type QMSong,
} from "@/utils/format/qqmusic";
import type { SearchRecovery, SearchResult } from "./index";

/** QM search 原始响应通用的分页与恢复元数据 */
interface QMSearchBody {
  total?: number;
  searchRecovery?: SearchRecovery;
}

/** QQ 按请求页宽推进，稀疏页不按显示条数重复取上一页
 * @param items - 当前页条目
 * @param total - 接口总数
 * @param offset - 当前请求偏移量
 * @param limit - 实际请求页宽
 * @param recovery - 缓存恢复标记
 * @returns 搜索结果和下一页偏移量
 */
const result = <T>(
  items: T[],
  total: number,
  offset: number,
  limit: number,
  recovery?: SearchRecovery,
): SearchResult<T> => {
  const nextOffset = (Math.floor(offset / limit) + 1) * limit;
  return {
    items,
    total,
    hasMore: items.length > 0 && nextOffset < total,
    nextOffset,
    searchRecovery: recovery,
  };
};

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await qmApi.search<QMSearchBody & { songs?: QMSong[] }>({
    keywords: keyword,
    type: 0,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.songs ?? []).map(qqSongToTrack);
  return result(items, body.total ?? items.length, offset, limit, body.searchRecovery);
};

export const albums = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await qmApi.search<QMSearchBody & { albums?: QMAlbumItem[] }>({
    keywords: keyword,
    type: 8,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.albums ?? []).map(qqAlbumToCoverItem);
  return result(items, body.total ?? items.length, offset, limit, body.searchRecovery);
};

export const artists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  // QM 歌手搜索的 n 超过 30 时会直接返回空结果，需要按接口上限换算分页。
  const requestLimit = Math.min(limit, 30);
  const body = await qmApi.search<QMSearchBody & { artists?: QMArtistItem[] }>({
    keywords: keyword,
    type: 9,
    page: Math.floor(offset / requestLimit) + 1,
    limit: requestLimit,
  });
  const items = (body.artists ?? []).map(qqArtistToCoverItem);
  return result(items, body.total ?? items.length, offset, requestLimit, body.searchRecovery);
};

export const playlists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await qmApi.search<QMSearchBody & { playlists?: QMPlaylistItem[] }>({
    keywords: keyword,
    type: 2,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.playlists ?? []).map(qqPlaylistToCoverItem);
  return result(items, body.total ?? items.length, offset, limit, body.searchRecovery);
};
