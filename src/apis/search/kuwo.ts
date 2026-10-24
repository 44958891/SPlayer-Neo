import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { kuwo as kwApi } from "@/apis/kuwo";
import {
  kwAlbumToCoverItem,
  kwArtistToCoverItem,
  kwPlaylistToCoverItem,
  kwSongToTrack,
  type KWAlbumItem,
  type KWArtistItem,
  type KWPlaylistItem,
  type KWSong,
} from "@/utils/format/kuwo";
import type { SearchResult } from "./index";

const result = <T>(items: T[], total: number, offset: number): SearchResult<T> => ({
  items,
  total,
  hasMore: offset + items.length < total,
});

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await kwApi.search<{ total?: number; songs?: KWSong[] }>({
    keywords: keyword,
    type: 0,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.songs ?? []).map(kwSongToTrack);
  return result(items, body.total ?? items.length, offset);
};

export const albums = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await kwApi.search<{ total?: number; albums?: KWAlbumItem[] }>({
    keywords: keyword,
    type: 8,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.albums ?? []).map(kwAlbumToCoverItem);
  return result(items, body.total ?? items.length, offset);
};

export const artists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await kwApi.search<{ total?: number; artists?: KWArtistItem[] }>({
    keywords: keyword,
    type: 9,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.artists ?? []).map(kwArtistToCoverItem);
  return result(items, body.total ?? items.length, offset);
};

export const playlists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await kwApi.search<{ total?: number; playlists?: KWPlaylistItem[] }>({
    keywords: keyword,
    type: 2,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.playlists ?? []).map(kwPlaylistToCoverItem);
  return result(items, body.total ?? items.length, offset);
};
