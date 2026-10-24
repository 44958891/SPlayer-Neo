import type { ArtistProfile } from "@/types/artist";
import { kuwo as kwApi } from "@/apis/kuwo";
import { kwSongsToTracks, type KWSong } from "@/utils/format/kuwo";

interface KWArtistDetailResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  avatar?: string;
  songs?: KWSong[];
}

/**
 * 获取KW歌手详情与热门单曲
 * @param id - 歌手 ID
 * @param fallbackName - 兜底名称
 * @returns 歌手资料 profile
 */
export const fetchKuwoArtist = async (id: string, fallbackName: string): Promise<ArtistProfile> => {
  const body = await kwApi.artist<KWArtistDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KW 歌手请求失败: ${body.code}`);

  const tracks = kwSongsToTracks(body.songs);

  return {
    id: String(body.id ?? id),
    name: body.name || fallbackName,
    avatar: body.avatar,
    source: "kuwo",
    tracks,
    albums: [],
    trackCount: tracks.length,
    albumCount: 0,
  };
};
