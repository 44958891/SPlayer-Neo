import type { CollectionType } from "@/types/collection";
import { fetchMiguAlbum } from "@/apis/album/migu";
import type { LoadCollectionOptions } from "./types";

/**
 * 加载咪咕集合
 *
 * 只支持专辑：咪咕歌单接口已下线，歌单页返回空集合（保留路由不报错）。
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

  options.onUpdate(null);
};
