import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, defineComponent, shallowRef, type PropType, type Ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@shared/types/platform";
import type { PlaylistFavorite } from "@shared/types/playlist";
import type { Collection } from "@/types/collection";

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useToast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("localforage", () => ({
  default: {
    createInstance: () => ({
      getItem: async () => null,
      setItem: async () => {},
      iterate: async () => {},
      clear: async () => {},
    }),
  },
}));

import { usePlaylistFavorite } from "./usePlaylistFavorite";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";

/** 空订阅：返回取消函数 */
const noopSubscription = () => () => {};

const api = {
  config: { getAll: vi.fn(), set: vi.fn() },
  desktopLyric: { onConfigChange: vi.fn(noopSubscription) },
  dynamicIsland: { onConfigChange: vi.fn(noopSubscription) },
  window: {
    onDesktopLyricVisibilityChange: vi.fn(noopSubscription),
    onDynamicIslandVisibilityChange: vi.fn(noopSubscription),
    onTaskbarLyricVisibilityChange: vi.fn(noopSubscription),
    isDesktopLyricOpen: vi.fn(async () => false),
    isDynamicIslandOpen: vi.fn(async () => false),
    isTaskbarLyricOpen: vi.fn(async () => false),
  },
  playlist: { listFavorites: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn() },
};

/** 构造收藏记录 */
const record = (source: Platform, originId: string): PlaylistFavorite => ({
  source,
  originId,
  title: `歌单-${originId}`,
  createTime: 1000,
});

/** 构造在线歌单合集 */
const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: "pl-1",
  type: "playlist",
  source: "netease",
  title: "在线歌单",
  cover: "cover://c.jpg",
  tracks: [],
  ...overrides,
});

/** 构造手动 resolve 的 Promise */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/** 包装合集为响应式引用 */
const coll = (value: Collection): Ref<Collection | null> => shallowRef<Collection | null>(value);

/** 挂载使用 composable 的宿主组件，保留真实生命周期用于卸载守卫 */
const mountHost = (initial: Collection) => {
  const Host = defineComponent({
    props: { current: { type: Object as PropType<Collection | null>, default: null } },
    setup(props) {
      const favorite = usePlaylistFavorite(computed(() => props.current));
      return { favorite };
    },
    template: "<div />",
  });
  return mount(Host, { props: { current: initial } });
};

describe("usePlaylistFavorite", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.success.mockReset();
    mocks.error.mockReset();
    api.config.getAll.mockReset().mockResolvedValue({});
    api.config.set.mockReset().mockResolvedValue(undefined);
    api.playlist.listFavorites.mockReset().mockResolvedValue([]);
    api.playlist.addFavorite.mockReset();
    api.playlist.removeFavorite.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "api", { configurable: true, value: api });
  });

  it("仅在线平台歌单显示收藏", async () => {
    const cases: [Partial<Collection>, boolean][] = [
      [{ source: "netease" }, true],
      [{ source: "qqmusic" }, true],
      [{ source: "kugou" }, true],
      [{ source: "kuwo" }, true],
      [{ source: "migu" }, true],
      [{ source: "local" }, false],
      [{ source: "streaming" }, false],
      [{ type: "album" }, false],
      [{ type: "radio" }, false],
      [{ type: "cloud" }, false],
    ];
    for (const [overrides, expected] of cases) {
      const favorite = usePlaylistFavorite(coll(collection(overrides)));
      expect(favorite.available.value).toBe(expected);
    }
    await flushPromises();
  });

  it("isFavorite 按平台 + id 身份判断", async () => {
    api.playlist.listFavorites.mockResolvedValue([record("netease", "pl-1")]);
    const favorite = usePlaylistFavorite(coll(collection()));
    await flushPromises();
    expect(favorite.isFavorite.value).toBe(true);
    const other = usePlaylistFavorite(coll(collection({ source: "qqmusic" })));
    expect(other.isFavorite.value).toBe(false);
  });

  it("toggle 先等待初始化，已收藏走 remove 而非 add", async () => {
    const gate = deferred<PlaylistFavorite[]>();
    api.playlist.listFavorites.mockReturnValue(gate.promise);
    const favorite = usePlaylistFavorite(coll(collection()));
    const pending = favorite.toggle();
    await flushPromises();
    expect(api.playlist.removeFavorite).not.toHaveBeenCalled();
    expect(api.playlist.addFavorite).not.toHaveBeenCalled();
    gate.resolve([record("netease", "pl-1")]);
    await pending;
    expect(api.playlist.removeFavorite).toHaveBeenCalledWith("netease", "pl-1");
    expect(api.playlist.addFavorite).not.toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledWith("collection.localFavorite.removed");
  });

  it("添加成功后置本地分组、解除侧边栏隐藏并提示", async () => {
    api.playlist.addFavorite.mockResolvedValue(record("netease", "pl-1"));
    const status = useStatusStore();
    const settings = useSettingsStore();
    status.myPlaylistSource = "online";
    settings.appearance.sidebarHiddenKeys = ["/collection/netease/playlist/pl-1", "/liked"];
    const favorite = usePlaylistFavorite(coll(collection()));
    await flushPromises();
    await favorite.toggle();
    expect(api.playlist.addFavorite).toHaveBeenCalledWith({
      source: "netease",
      originId: "pl-1",
      title: "在线歌单",
      cover: "cover://c.jpg",
    });
    expect(status.myPlaylistSource).toBe("local");
    expect(settings.appearance.sidebarHiddenKeys).toEqual(["/liked"]);
    expect(mocks.success).toHaveBeenCalledWith("collection.localFavorite.added");
  });

  it("取消收藏不影响分组与隐藏键", async () => {
    api.playlist.listFavorites.mockResolvedValue([record("netease", "pl-1")]);
    const status = useStatusStore();
    const settings = useSettingsStore();
    status.myPlaylistSource = "online";
    settings.appearance.sidebarHiddenKeys = ["/collection/netease/playlist/pl-1"];
    const favorite = usePlaylistFavorite(coll(collection()));
    await flushPromises();
    await favorite.toggle();
    expect(api.playlist.removeFavorite).toHaveBeenCalledWith("netease", "pl-1");
    expect(status.myPlaylistSource).toBe("online");
    expect(settings.appearance.sidebarHiddenKeys).toEqual(["/collection/netease/playlist/pl-1"]);
    expect(mocks.success).toHaveBeenCalledWith("collection.localFavorite.removed");
  });

  it("添加失败提示错误且不改动分组/隐藏键", async () => {
    api.playlist.addFavorite.mockRejectedValue(new Error("write failed"));
    const status = useStatusStore();
    const settings = useSettingsStore();
    status.myPlaylistSource = "online";
    settings.appearance.sidebarHiddenKeys = ["/collection/netease/playlist/pl-1"];
    const favorite = usePlaylistFavorite(coll(collection()));
    await flushPromises();
    await favorite.toggle();
    expect(mocks.error).toHaveBeenCalledWith("write failed");
    expect(favorite.busy.value).toBe(false);
    expect(favorite.isFavorite.value).toBe(false);
    expect(status.myPlaylistSource).toBe("online");
    expect(settings.appearance.sidebarHiddenKeys).toEqual(["/collection/netease/playlist/pl-1"]);
  });

  it("初始化加载失败提示 loadFailed", async () => {
    api.playlist.listFavorites.mockRejectedValue(new Error("ipc down"));
    usePlaylistFavorite(coll(collection()));
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledWith("collection.localFavorite.loadFailed");
  });

  it("路由 A->B 后迟到写入只更新全局数据，不做页面副作用", async () => {
    const gate = deferred<PlaylistFavorite>();
    api.playlist.addFavorite.mockReturnValue(gate.promise);
    const status = useStatusStore();
    const settings = useSettingsStore();
    status.myPlaylistSource = "online";
    settings.appearance.sidebarHiddenKeys = [
      "/collection/netease/playlist/pl-1",
      "/collection/netease/playlist/pl-2",
    ];
    const current = coll(collection());
    const favorite = usePlaylistFavorite(current);
    await flushPromises();
    const pending = favorite.toggle();
    current.value = collection({ id: "pl-2", title: "歌单B" });
    gate.resolve(record("netease", "pl-1"));
    await pending;
    expect(api.playlist.addFavorite).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(status.myPlaylistSource).toBe("online");
    expect(settings.appearance.sidebarHiddenKeys).toEqual([
      "/collection/netease/playlist/pl-1",
      "/collection/netease/playlist/pl-2",
    ]);
  });

  it("busy 期间忽略再次 toggle", async () => {
    const gate = deferred<PlaylistFavorite>();
    api.playlist.addFavorite.mockReturnValue(gate.promise);
    const favorite = usePlaylistFavorite(coll(collection()));
    await flushPromises();
    const first = favorite.toggle();
    const second = favorite.toggle();
    gate.resolve(record("netease", "pl-1"));
    await Promise.all([first, second]);
    expect(api.playlist.addFavorite).toHaveBeenCalledTimes(1);
  });

  it("卸载后迟到的写入不产生 toast 与侧边栏副作用", async () => {
    const gate = deferred<PlaylistFavorite>();
    api.playlist.addFavorite.mockReturnValue(gate.promise);
    const status = useStatusStore();
    const settings = useSettingsStore();
    status.myPlaylistSource = "online";
    settings.appearance.sidebarHiddenKeys = ["/collection/netease/playlist/pl-1"];
    const wrapper = mountHost(collection());
    await flushPromises();
    const pending = wrapper.vm.favorite.toggle() as Promise<void>;
    wrapper.unmount();
    gate.resolve(record("netease", "pl-1"));
    await pending;
    expect(api.playlist.addFavorite).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(status.myPlaylistSource).toBe("online");
    expect(settings.appearance.sidebarHiddenKeys).toEqual(["/collection/netease/playlist/pl-1"]);
  });
});
