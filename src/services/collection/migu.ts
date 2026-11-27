import type { CollectionType } from "@/types/collection";
import { fetchMiguAlbum } from "@/apis/album/migu";
import { fetchMiguPlaylist } from "@/apis/playlist/migu";
import type { LoadCollectionOptions } from "./types";

/**
 * 加载咪咕集合
 *
 * 支持专辑与歌单：歌单走官方 v5 网页同款详情+曲目分页接口（真实可用）。
 * @param type - 集合类型
 * @param id - 集合 ID
 * @param options - 加载选项
 */
export const loadMiguCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const originalId = decodeURIComponent(id);
  const fallbackName = options.fallbackName ?? originalId;

  if (type === "album") {
    const { album, tracks, description } = await fetchMiguAlbum(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: album.id ?? originalId,
        type,
        source: "migu",
        title: album.name,
        cover: album.cover,
        creator: album.artist,
        description,
        tracks,
        trackCount: tracks.length,
      });
    }
    return;
  }

  if (type === "playlist") {
    const { playlist, tracks } = await fetchMiguPlaylist(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: playlist.id ?? originalId,
        type,
        source: "migu",
        title: playlist.name,
        cover: playlist.cover,
        creator: playlist.owner,
        description: playlist.description,
        tracks,
        trackCount: tracks.length,
      });
    }
    return;
  }

  options.onUpdate(null);
};
