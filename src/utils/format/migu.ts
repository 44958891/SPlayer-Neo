import type { AudioQuality, Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { MgAlbumItem, MgSong, MgSingerItem } from "@shared/utils/migu/config";
import { mgCover, mgDuration, mgIsVip, mgQuality } from "@shared/utils/migu/config";

/**
 * 咪咕歌曲 → 统一 Track
 *
 * 咪咕用 contentId（长串）作为资源 id，插件取链也认这个值；copyrightId 随曲目带出，
 * 部分插件需要它才能命中版权库。时长由文件体积反推（见 core/config 的 mgDuration）。
 * @param song - 咪咕搜索返回的歌曲
 */
export const mgSongToTrack = (song: MgSong): Track => {
  const quality = mgQuality(song) as AudioQuality | undefined;
  const album = song.albums?.[0];
  const artists = (song.singers ?? []).map((artist) => ({
    id: artist.id,
    name: artist.name || "未知歌手",
  }));
  const cover = mgCover(song.imgItems, "02");
  const track: Track = {
    id: song.contentId ?? song.id,
    source: "migu",
    // songAliasName 是英文别名（如 "Sunny Day"），标题必须用 song.name
    title: song.name || song.songAliasName?.trim() || "未知歌曲",
    artists,
    album: album ? { id: album.id, name: album.name } : undefined,
    duration: mgDuration(song),
    cover,
    coverOriginal: cover,
    quality,
  };
  // 咪咕版权 id 不是 Track 的标准字段，塞进 extId 供取链时透传（qqmusic 也复用该字段存数字 id）
  const copyrightId = song.copyrightId?.trim();
  if (copyrightId) track.extId = copyrightId;
  if (mgIsVip(song)) track.fee = 1;
  return track;
};

/** 歌曲列表批量转换 */
export const mgSongsToTracks = (songs: MgSong[] | undefined): Track[] =>
  (songs ?? []).map(mgSongToTrack);

/** 专辑 → 通用封面项 */
export const mgAlbumToCoverItem = (item: MgAlbumItem): CoverItem => ({
  id: item.id,
  title: item.name,
  cover: mgCover(item.imgItems, "02"),
  subtitle: item.singer ?? "",
  trackCount: 0,
});

/** 歌手 → 通用封面项（咪咕搜索不返回头像，留空由 UI 兜底） */
export const mgSingerToCoverItem = (item: MgSingerItem): CoverItem => ({
  id: item.id,
  title: item.name,
  cover: "",
  trackCount: 0,
});
