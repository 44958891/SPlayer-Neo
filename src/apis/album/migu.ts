import type { Album, Track } from "@shared/types/player";
import { mgCover, mgAlbumSongDuration, mgAlbumSongToSong } from "@shared/utils/migu/config";
import { migu as mgApi } from "@/apis/migu";
import { mgSongToTrack } from "@/utils/format/migu";

interface MgAlbumDetailResponse {
  code: string;
  data?: {
    albumId?: string;
    title?: string;
    singer?: string;
    summary?: string;
    totalCount?: number;
    publishDate?: string;
    imgItems?: Array<{ imgSizeType?: string; img?: string }>;
  };
}

interface MgAlbumSongsResponse {
  code: string;
  data?: {
    songList?: Parameters<typeof mgAlbumSongToSong>[0][];
    totalCount?: number;
  };
}

/**
 * 获取咪咕专辑详情与歌曲列表
 * @param id - 专辑 ID
 * @param fallbackName - 兜底名称
 * @returns 专辑元数据与 Track 列表
 */
export const fetchMiguAlbum = async (
  id: string,
  fallbackName: string,
): Promise<{ album: Album; tracks: Track[]; description?: string }> => {
  const [detail, songs] = await Promise.all([
    mgApi["album"]<MgAlbumDetailResponse>({ id }),
    mgApi["album_songs"]<MgAlbumSongsResponse>({ id, page: 1, limit: 200 }),
  ]);
  if (detail.code !== "000000") throw new Error(`咪咕专辑请求失败: ${detail.code}`);
  const list = songs.data?.songList ?? [];
  const tracks = list.map((song) => {
    const track = mgSongToTrack(mgAlbumSongToSong(song));
    return { ...track, duration: mgAlbumSongDuration(song) };
  });
  return {
    album: {
      id: detail.data?.albumId ?? id,
      name: detail.data?.title || fallbackName,
      cover: mgCover(detail.data?.imgItems, "02") || tracks[0]?.cover,
      artist: detail.data?.singer,
      trackCount: detail.data?.totalCount ?? tracks.length,
    },
    tracks,
    description: detail.data?.summary,
  };
};
