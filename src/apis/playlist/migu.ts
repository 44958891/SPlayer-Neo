import type { Playlist, Track } from "@shared/types/player";
import type { MgPlaylistDetailResponse, MgPlaylistSongsResponse } from "@shared/utils/migu/config";
import { mgAlbumSongDuration, mgAlbumSongToSong } from "@shared/utils/migu/config";
import { migu as mgApi } from "@/apis/migu";
import { mgSongToTrack } from "@/utils/format/migu";

/** 官方前端按 pageSize=50 翻页 */
const PAGE_SIZE = 50;
/** 翻页上限（100 页 ≈ 5000 首），异常大歌单在此截断 */
const MAX_PAGES = 100;

/**
 * 获取咪咕歌单详情与曲目列表（按官方分页翻页）
 *
 * 终止条件：页内不足 pageSize、累计达到 totalCount、整页无新增（服务端重复页兜底）
 * 或达到 100 页上限。
 * @param id - 歌单 ID
 * @param fallbackName - 兜底名称
 * @returns 歌单元数据与 Track 列表（extId 携带 copyrightId 供取链）
 */
export const fetchMiguPlaylist = async (
  id: string,
  fallbackName: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const detail = await mgApi["playlist"]<MgPlaylistDetailResponse>({ id });
  if (detail.code !== "000000") throw new Error(`咪咕歌单请求失败: ${detail.code}`);

  const tracks: Track[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await mgApi["playlist_songs"]<MgPlaylistSongsResponse>({
      id,
      page,
      limit: PAGE_SIZE,
    });
    if (body.code !== "000000") throw new Error(`咪咕歌单曲目请求失败: ${body.code}`);
    const songs = body.data?.songList ?? [];
    total = body.data?.totalCount ?? total;
    const before = seen.size;
    for (const song of songs) {
      const track = mgSongToTrack(mgAlbumSongToSong(song));
      if (!track.id || seen.has(track.id)) continue;
      seen.add(track.id);
      tracks.push({ ...track, duration: mgAlbumSongDuration(song) });
    }
    if (songs.length < PAGE_SIZE || (total > 0 && tracks.length >= total)) break;
    // 整页都与已有曲目重复：服务端翻页异常，继续请求只会死循环
    if (seen.size === before) break;
  }

  return {
    playlist: {
      id: detail.data?.musicListId ?? id,
      name: detail.data?.title || fallbackName,
      cover: detail.data?.originalImgUrl || detail.data?.imgItem?.img || tracks[0]?.cover,
      description: detail.data?.summary,
      owner: detail.data?.ownerName,
      trackCount: total || tracks.length,
    },
    tracks,
  };
};
