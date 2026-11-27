import type { Ref } from "vue";
import type { Collection } from "@/types/collection";
import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import { usePlaylistFavoritesStore } from "@/stores/playlistFavorites";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { toast } from "@/composables/useToast";

/**
 * 平台歌单收藏到本地
 *
 * 仅在线平台歌单可用；toggle 进入时捕获 source/id 身份，
 * 全局收藏数据始终写入，但 toast 与侧边栏副作用只在页面仍是原歌单时执行，
 * 避免路由切换后迟到的结果误更新新页面
 * @param collection - 当前合集的响应式引用
 * @returns available 是否可收藏、isFavorite 是否已收藏、busy 操作进行中、toggle 切换收藏
 */
export const usePlaylistFavorite = (collection: Ref<Collection | null>) => {
  const { t } = useI18n();
  const store = usePlaylistFavoritesStore();
  const status = useStatusStore();
  const settings = useSettingsStore();

  /** 操作进行中（含首次加载等待） */
  const busy = ref(false);

  /** 卸载后不再产生 toast 与侧边栏副作用 */
  let disposed = false;
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      disposed = true;
    });
  }

  /** 是否显示收藏按钮：仅在线平台歌单（本地/流媒体/专辑/电台/云盘不显示） */
  const available = computed(() => {
    const current = collection.value;
    return !!current && current.type === "playlist" && isPlatform(current.source);
  });

  /** 当前歌单是否已收藏到本地（按 store 内平台 + id 身份判断） */
  const isFavorite = computed(() => {
    const current = collection.value;
    if (!current || !isPlatform(current.source)) return false;
    return store.isFavorite(current.source, current.id);
  });

  /**
   * 判断页面当前合集是否仍与捕获身份一致
   * @param source - 捕获的平台来源
   * @param originId - 捕获的平台原始歌单 id
   * @returns 是否仍为同一歌单
   */
  const sameIdentity = (source: Platform, originId: string): boolean => {
    const current = collection.value;
    return !!current && current.source === source && current.id === originId;
  };

  /**
   * 切换收藏；添加成功且页面未变时切回本地歌单分组，并解除该歌单在侧边栏的隐藏
   * @returns 完成后 resolve；失败提示 toast 且保持原状态
   */
  const toggle = async (): Promise<void> => {
    const current = collection.value;
    if (!current || busy.value || !available.value) return;
    const source = current.source as Platform;
    const originId = current.id;
    const title = current.title;
    const cover = current.cover;
    busy.value = true;
    try {
      // 未初始化时先等加载完成，再按真实列表决定走 add 还是 remove
      if (!store.initialized) await store.load();
      if (store.isFavorite(source, originId)) {
        await store.remove(source, originId);
        if (!disposed && sameIdentity(source, originId)) {
          toast.success(t("collection.localFavorite.removed"));
        }
        return;
      }
      const created = await store.add({ source, originId, title, cover });
      // 已收藏或在途重复：store 未做任何写入，静默返回避免误导成功提示
      if (created && !disposed && sameIdentity(source, originId)) {
        status.myPlaylistSource = "local";
        const routeKey = `/collection/${source}/playlist/${encodeURIComponent(originId)}`;
        if (settings.appearance.sidebarHiddenKeys.includes(routeKey)) {
          settings.appearance.sidebarHiddenKeys = settings.appearance.sidebarHiddenKeys.filter(
            (key) => key !== routeKey,
          );
        }
        toast.success(t("collection.localFavorite.added"));
      }
    } catch (err) {
      // 失败提示同样只在页面仍是原歌单时出现，避免迟到失败打扰新页面
      if (!disposed && sameIdentity(source, originId)) {
        const message = err instanceof Error && err.message ? err.message : "";
        toast.error(message || t("collection.localFavorite.failed"));
      }
    } finally {
      busy.value = false;
    }
  };

  /** 首次使用时加载收藏列表；store 单飞，失败仅提示，收藏/取消时会重新确保加载 */
  if (!store.initialized) {
    void store.load().catch(() => {
      if (!disposed) toast.error(t("collection.localFavorite.loadFailed"));
    });
  }

  return { available, isFavorite, busy, toggle };
};
