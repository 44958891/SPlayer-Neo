/**
 * 咪咕专辑模块
 *
 * 咪咕有两条专辑通道：
 * - 普通专辑：`resource/album/v2.0` + `resource/album/song/v2.0`
 * - 数字专辑（搜索里 resourceType=5，如周杰伦《最伟大的作品》）：`resource/dalbum/v2.0` + `resource/dalbum/song/v2.0`
 *
 * 搜索接口不区分两者（都只给一个 id），因此取歌曲时先走普通专辑，空列表再回退数字专辑。
 */

import { mgRequest } from "../core/request";
import type { MgAlbumDetailResponse, MgAlbumSongsResponse } from "@shared/utils/migu/config";

/** 专辑信息接口 */
const MG_ALBUM_DETAIL_URL = "https://app.c.nf.migu.cn/MIGUM3.0/resource/album/v2.0";

/** 专辑歌曲接口 */
const MG_ALBUM_SONGS_URL = "https://app.c.nf.migu.cn/MIGUM3.0/resource/album/song/v2.0";

/** 数字专辑两个接口 */
const MG_DALBUM_DETAIL_URL = "https://app.c.nf.migu.cn/MIGUM3.0/resource/dalbum/v2.0";
const MG_DALBUM_SONGS_URL = "https://app.c.nf.migu.cn/MIGUM3.0/resource/dalbum/song/v2.0";

/** 专辑参数 */
export interface MgAlbumParams {
  id?: string;
}

/** 专辑歌曲参数 */
export interface MgAlbumSongsParams {
  id?: string;
  page?: number;
  limit?: number;
}

const readId = (params: { id?: string }): string => {
  const id = (params.id ?? "").trim();
  if (!id) throw new Error("migu album id required");
  return id;
};

const pageParams = (params: MgAlbumSongsParams): string => {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.max(1, Math.min(params.limit ?? 200, 500));
  return `pageNo=${page}&pageSize=${limit}`;
};

/**
 * 取专辑信息（普通专辑 → 数字专辑回退）
 * @param params - 专辑 id
 */
export const album = async (params: MgAlbumParams = {}): Promise<MgAlbumDetailResponse> => {
  const id = readId(params);
  const normal = await mgRequest<MgAlbumDetailResponse>(
    `${MG_ALBUM_DETAIL_URL}?albumId=${encodeURIComponent(id)}`,
  );
  if (normal.code === "000000" && normal.data?.title) return normal;
  const digital = await mgRequest<MgAlbumDetailResponse>(
    `${MG_DALBUM_DETAIL_URL}?dAlbumId=${encodeURIComponent(id)}`,
  );
  return digital.code === "000000" ? digital : normal;
};

/**
 * 取专辑歌曲（普通专辑为空时回退数字专辑）
 * @param params - 专辑 id 与分页
 */
export const albumSongs = async (
  params: MgAlbumSongsParams = {},
): Promise<MgAlbumSongsResponse> => {
  const id = readId(params);
  const query = pageParams(params);
  const normal = await mgRequest<MgAlbumSongsResponse>(
    `${MG_ALBUM_SONGS_URL}?albumId=${encodeURIComponent(id)}&${query}`,
  );
  if ((normal.data?.songList?.length ?? 0) > 0) return normal;
  const digital = await mgRequest<MgAlbumSongsResponse>(
    `${MG_DALBUM_SONGS_URL}?dAlbumId=${encodeURIComponent(id)}&${query}`,
  );
  return (digital.data?.songList?.length ?? 0) > 0 ? digital : normal;
};
