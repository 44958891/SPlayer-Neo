import type { Album, Track } from "@shared/types/player";
import { kuwo as kwApi } from "@/apis/kuwo";
import { kwSongsToTracks, type KWSong } from "@/utils/format/kuwo";

interface KWAlbumDetailResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  cover?: string;
  artist?: string;
  artistId?: string;
  description?: string;
  total?: number;
  songs?: KWSong[];
}

/**
 * 获取KW专辑详情与歌曲列表
 * @param id - 专辑 ID
 * @param fallbackName - 兜底名称
 * @returns 专辑元数据与 Track 列表
 */
export const fetchKuwoAlbum = async (
  id: string,
  fallbackName: string,
): Promise<{ album: Album; tracks: Track[]; description?: string }> => {
  const body = await kwApi.album<KWAlbumDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KW 专辑请求失败: ${body.code}`);

  const tracks = kwSongsToTracks(body.songs);
  const first = tracks[0];

  return {
    album: {
      id: String(body.id ?? id),
      name: body.name || first?.album?.name || fallbackName,
      cover: body.cover || first?.cover,
      artist: body.artist,
    },
    tracks,
    description: body.description,
  };
};
