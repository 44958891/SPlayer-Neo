import type { AudioQuality, Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";

/** 酷我歌曲（主进程归一化后的形状） */
export interface KWSong {
  id: string;
  name: string;
  artist: string;
  artists?: Array<{ id?: string; name: string }>;
  album: string;
  albumId: string;
  cover?: string;
  duration: number;
  formats?: string;
}

export interface KWAlbumItem {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  cover?: string;
  trackCount?: number;
  intro?: string;
}

export interface KWArtistItem {
  id: string;
  name: string;
  cover?: string;
  albumCount?: number;
  songCount?: number;
}

export interface KWPlaylistItem {
  id: string;
  name: string;
  cover?: string;
  creator?: string;
  trackCount?: number;
  playCount?: number;
  description?: string;
}

/**
 * 由 FORMATS 描述推导可用音质（与主进程 core/config 的 parseKwQuality 同口径）
 * 搜索结果的可用最高档位决定播放/下载的探测上限
 * @param formats - 形如 `AAC48|ALFLAC|MP3128|MP3H`
 */
export const kwFormatsToQuality = (formats: string | undefined): AudioQuality | undefined => {
  if (!formats) return undefined;
  const set = new Set(formats.split("|").map((item) => item.trim().toUpperCase()));
  if (set.has("ALFLAC"))
    return { codec: "flac", sampleRate: 44100, bitsPerSample: 16, bitRate: 0, channels: 2 };
  if (set.has("MP3H") || set.has("MP3192"))
    return { codec: "mp3", sampleRate: 44100, bitsPerSample: 16, bitRate: 320000, channels: 2 };
  if (set.has("MP3128") || set.has("OGG192"))
    return { codec: "mp3", sampleRate: 44100, bitsPerSample: 16, bitRate: 128000, channels: 2 };
  if (set.has("WMA128") || set.has("AAC48"))
    return { codec: "aac", sampleRate: 44100, bitsPerSample: 16, bitRate: 48000, channels: 2 };
  return undefined;
};

/**
 * 酷我歌曲 → 统一 Track
 * @param song - 主进程归一化歌曲
 */
export const kwSongToTrack = (song: KWSong): Track => {
  const artists =
    song.artists && song.artists.length > 0
      ? song.artists.map((artist) => ({ id: artist.id, name: artist.name }))
      : song.artist
        ? [{ id: song.artist, name: song.artist }]
        : [];
  return {
    id: song.id,
    source: "kuwo",
    title: song.name,
    artists,
    album: song.album ? { id: song.albumId, name: song.album } : undefined,
    duration: song.duration ?? 0,
    cover: song.cover,
    coverOriginal: song.cover,
    quality: kwFormatsToQuality(song.formats),
  };
};

/** 歌曲列表批量转换 */
export const kwSongsToTracks = (songs: KWSong[] | undefined): Track[] =>
  (songs ?? []).map(kwSongToTrack);

/** 专辑 → 通用封面项 */
export const kwAlbumToCoverItem = (item: KWAlbumItem): CoverItem => ({
  id: item.id,
  title: item.name,
  cover: item.cover,
  subtitle: item.artist,
  trackCount: item.trackCount ?? 0,
});

/** 歌手 → 通用封面项 */
export const kwArtistToCoverItem = (item: KWArtistItem): CoverItem => ({
  id: item.id,
  title: item.name,
  cover: item.cover,
  trackCount: item.songCount ?? 0,
});

/** 歌单 → 通用封面项 */
export const kwPlaylistToCoverItem = (item: KWPlaylistItem): CoverItem => ({
  id: item.id,
  title: item.name,
  cover: item.cover,
  subtitle: item.creator,
  trackCount: item.trackCount ?? 0,
});
