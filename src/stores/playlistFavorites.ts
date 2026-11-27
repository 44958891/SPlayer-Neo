import type { Platform } from "@shared/types/platform";
import type { PlaylistFavorite, PlaylistFavoriteInput } from "@shared/types/playlist";

/**
 * 本地歌单收藏 store
 *
 * 收藏关系持久在主进程，renderer 持有唯一列表快照：
 * load 单飞复用在途请求；增删只在写成功后更新列表并递增 generation，
 * 保证在途 load 的过期快照不会回滚用户刚完成的变更
 */
export const usePlaylistFavoritesStore = defineStore("playlistFavorites", () => {
  /** 收藏列表 */
  const favorites = shallowRef<PlaylistFavorite[]>([]);
  /** 首次加载成功完成 */
  const initialized = ref(false);
  /** load 进行中 */
  const loading = ref(false);

  /** 在途 load 的共享 Promise，并发调用复用同一请求 */
  let loadPromise: Promise<void> | null = null;
  /** 本地变更代数：写成功递增，使在途 load 的结果过期作废 */
  let generation = 0;
  /** 在途写操作键（source:originId），并发重复请求去重 */
  const pendingOps = new Set<string>();

  /**
   * 生成收藏唯一键
   * @param source - 平台来源
   * @param originId - 平台原始歌单 id
   * @returns source:originId 形式的键
   */
  const keyOf = (source: Platform, originId: string): string => `${source}:${originId}`;

  /**
   * 加载收藏列表
   * @returns 单飞的加载 Promise；失败时抛出且不置 initialized，可重试
   */
  const load = (): Promise<void> => {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const gen = generation;
      loading.value = true;
      try {
        const list = await window.api.playlist.listFavorites();
        if (gen === generation) favorites.value = list;
        initialized.value = true;
      } finally {
        loading.value = false;
        loadPromise = null;
      }
    })();
    return loadPromise;
  };

  /**
   * 收藏歌单到本地；未初始化时先等待单飞 load，
   * 避免在途快照里的磁盘已有项被本此写入后的过期结果丢弃
   * @param input - 收藏输入（平台、原始 id、标题、可选封面）
   * @returns 写入成功返回新记录；已收藏或在途重复时不发请求，返回 null
   */
  const add = async (input: PlaylistFavoriteInput): Promise<PlaylistFavorite | null> => {
    if (!initialized.value) await load();
    const key = keyOf(input.source, input.originId);
    const exists = favorites.value.some((item) => keyOf(item.source, item.originId) === key);
    if (exists || pendingOps.has(key)) return null;
    pendingOps.add(key);
    try {
      const created = await window.api.playlist.addFavorite(input);
      favorites.value = [
        created,
        ...favorites.value.filter((item) => keyOf(item.source, item.originId) !== key),
      ];
      generation++;
      return created;
    } finally {
      pendingOps.delete(key);
    }
  };

  /**
   * 取消收藏；未初始化时先等待单飞 load，确保按完整列表判断存在性
   * @param source - 平台来源
   * @param originId - 平台原始歌单 id
   * @returns 未收藏或在途重复时不发请求；写失败抛出并保持原列表
   */
  const remove = async (source: Platform, originId: string): Promise<void> => {
    if (!initialized.value) await load();
    const key = keyOf(source, originId);
    const exists = favorites.value.some((item) => keyOf(item.source, item.originId) === key);
    if (!exists || pendingOps.has(key)) return;
    pendingOps.add(key);
    try {
      await window.api.playlist.removeFavorite(source, originId);
      favorites.value = favorites.value.filter((item) => keyOf(item.source, item.originId) !== key);
      generation++;
    } finally {
      pendingOps.delete(key);
    }
  };

  /**
   * 判断歌单是否已收藏（按平台 + 原始 id 判断身份）
   * @param source - 平台来源
   * @param originId - 平台原始歌单 id
   * @returns 是否已收藏
   */
  const isFavorite = (source: Platform, originId: string): boolean =>
    favorites.value.some((item) => item.source === source && item.originId === originId);

  return { favorites, initialized, loading, load, add, remove, isFavorite };
});
