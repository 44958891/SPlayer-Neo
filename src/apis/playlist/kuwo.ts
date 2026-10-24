import type { Playlist, Track } from "@shared/types/player";
import { kuwo as kwApi } from "@/apis/kuwo";
import { kwSongsToTracks, type KWSong } from "@/utils/format/kuwo";

interface KWPlaylistDetailResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  total?: number;
  songs?: KWSong[];
}

/**
 * 获取KW歌单详情与歌曲列表
 * @param id - 歌单 ID
 * @param fallbackName - 兜底名称
 * @returns 歌单元数据与 Track 列表
 */
export const fetchKuwoPlaylist = async (
  id: string,
  fallbackName: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const body = await kwApi.playlist<KWPlaylistDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KW 歌单请求失败: ${body.code}`);

  const tracks = kwSongsToTracks(body.songs);

  return {
    playlist: {
      id: String(body.id ?? id),
      name: body.name || fallbackName,
      cover: body.cover || tracks[0]?.cover,
      description: body.description,
      owner: body.creator,
      trackCount: body.total ?? tracks.length,
    },
    tracks,
  };
};
