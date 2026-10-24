import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { MgSearchResponse } from "@shared/utils/migu/config";
import { migu as mgApi } from "@/apis/migu";
import { mgAlbumToCoverItem, mgSingerToCoverItem, mgSongsToTracks } from "@/utils/format/migu";
import type { SearchResult } from "./index";

const result = <T>(items: T[], total: number, offset: number): SearchResult<T> => ({
  items,
  total,
  hasMore: offset + items.length < total,
});

/**
 * 咪咕只有 search_all 一个接口，翻页靠 pageNo + pageSize
 * @param kind - 结果类型
 */
const searchBy = async (
  keyword: string,
  offset: number,
  limit: number,
  kind: "song" | "album" | "singer",
): Promise<MgSearchResponse> =>
  mgApi.search<MgSearchResponse>({
    keywords: keyword,
    type: kind,
    page: Math.floor(offset / limit) + 1,
    limit,
  });

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await searchBy(keyword, offset, limit, "song");
  const items = mgSongsToTracks(body.songResultData?.result);
  const total = Number(body.songResultData?.totalCount ?? items.length);
  return result(items, total, offset);
};

export const albums = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await searchBy(keyword, offset, limit, "album");
  const raw = body.albumResultData?.result ?? [];
  const items = raw.map(mgAlbumToCoverItem);
  const total = Number(body.albumResultData?.totalCount ?? items.length);
  return result(items, total, offset);
};

export const artists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await searchBy(keyword, offset, limit, "singer");
  const raw = body.singerResultData?.result ?? [];
  const items = raw.map(mgSingerToCoverItem);
  const total = Number(body.singerResultData?.totalCount ?? items.length);
  return result(items, total, offset);
};

/** 咪咕歌单接口已下线，返回空结果而不是抛错（UI 显示「没有找到相关歌单」） */
export const playlists = async (
  _keyword: string,
  offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => result([], 0, offset);
