/* eslint-disable vue/one-component-per-file -- 用替身组件在同一文件声明菜单与右键菜单观察点 */
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import zhCN from "@/i18n/locales/zh-CN.json";
import { DEFAULT_SIDEBAR_NAV_GROUPS } from "@/types/settings";
import type { Platform } from "@shared/types/platform";
import SideBar from "./SideBar.vue";

/** 在线收藏条目（与 stores/playlistFavorites 接口对齐的最小形态） */
interface FavoriteFixture {
  source: Platform;
  originId: string;
  title: string;
  cover?: string;
}

/** 本地歌单列表项 */
interface LocalPlaylistFixture {
  id: string;
  title: string;
}

/** 网易云歌单列表项 */
interface OnlinePlaylistFixture {
  id: string;
  name: string;
  cover?: string;
}

/** 每个用例独立重建的 store 替身集合 */
interface StoreFixtures extends Record<string, unknown> {
  settings: { appearance: Record<string, unknown>; system: Record<string, unknown> };
  status: Record<string, unknown>;
  playlist: Record<string, unknown>;
  favorites: Record<string, unknown>;
  user: Record<string, unknown>;
  download: Record<string, unknown>;
  favLoad: ReturnType<typeof vi.fn>;
  favRemove: ReturnType<typeof vi.fn>;
  localRemove: ReturnType<typeof vi.fn>;
}

const m = vi.hoisted(() => ({
  fixtures: {} as Record<string, unknown>,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  enterHeartMode: vi.fn(),
  exitHeartMode: vi.fn(),
  showSettings: vi.fn(),
}));

vi.mock("@/stores/settings", () => ({ useSettingsStore: () => m.fixtures.settings }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => m.fixtures.status }));
vi.mock("@/stores/playlist", () => ({ usePlaylistStore: () => m.fixtures.playlist }));
vi.mock("@/stores/playlistFavorites", () => ({
  usePlaylistFavoritesStore: () => m.fixtures.favorites,
}));
vi.mock("@/stores/user", () => ({ useUserStore: () => m.fixtures.user }));
vi.mock("@/stores/download", () => ({ useDownloadStore: () => m.fixtures.download }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useHeartMode", () => ({
  useHeartMode: () => ({ enterHeartMode: m.enterHeartMode }),
}));
vi.mock("@/composables/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ sidebarCollapsed: false }),
}));
vi.mock("@/settings/useSettingsDialog", () => ({
  useSettingsDialog: () => ({ show: m.showSettings }),
}));
vi.mock("@/core/player", () => ({ exitHeartMode: m.exitHeartMode }));
vi.mock("~icons/sp/heart-mode", () => ({ default: {} }));

/** 菜单替身：渲染 item/divider/group，暴露 data-menu-key、data-active 与行尾内容 */
const SMenuStub = defineComponent({
  name: "SMenu",
  props: { items: { type: Array, required: true }, modelValue: { type: String, default: "" } },
  emits: ["select"],
  setup(props, { emit }) {
    return () =>
      h(
        "div",
        (props.items as Record<string, unknown>[]).map((item) => {
          if (item.type === "divider")
            return h("hr", { key: item.key as string, "data-divider": item.key as string });
          if (item.type === "group")
            return h("div", { key: item.key as string, "data-group": item.key });
          return h(
            "button",
            {
              key: item.key as string,
              "data-menu-key": item.key as string,
              "data-active": item.key === props.modelValue ? "true" : "false",
              onClick: () => emit("select", item.key),
            },
            [item.label as string, typeof item.trailing === "function" ? item.trailing() : null],
          );
        }),
      );
  },
});

/** 右键菜单替身：仅渲染触发插槽，测试通过 emit("select") 驱动真实处理函数 */
const SContextMenuStub = defineComponent({
  name: "SContextMenu",
  props: { items: { type: Array, required: true } },
  emits: ["select"],
  template: "<div><slot /></div>",
});

const i18n = createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } });

/**
 * 创建内存路由（catch-all 空页面），初始定位到指定路径
 * @param initialPath - 挂载前进入的路由路径
 * @returns 就绪的路由实例
 */
const createAppRouter = async (initialPath = "/"): Promise<Router> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
  });
  await router.push(initialPath);
  await router.isReady();
  return router;
};

/**
 * 挂载真实 SideBar，安装路由与 i18n，替换菜单/弹窗/图标观察点
 * @param router - 已就绪的路由实例
 * @returns 组件包装器
 */
const mountSideBar = async (router: Router): Promise<VueWrapper> => {
  const wrapper = mount(SideBar, {
    global: {
      plugins: [i18n, router],
      stubs: {
        SMenu: SMenuStub,
        SContextMenu: SContextMenuStub,
        SideBarLogo: true,
        SButton: { template: "<button><slot /></button>" },
        SPopselect: true,
        PlaylistCreateDialog: true,
        PlaylistImportDialog: true,
        IconLucideChevronDown: true,
        IconLucideImport: true,
        IconLucidePlus: true,
        IconSpHeartMode: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

/** 读取 SMenu 替身收到的菜单项列表 */
const menuItemsOf = (wrapper: VueWrapper): Record<string, unknown>[] =>
  wrapper.getComponent(SMenuStub).props("items") as Record<string, unknown>[];

/** 读取右键菜单替身收到的条目列表 */
const contextItemsOf = (wrapper: VueWrapper): Record<string, unknown>[] =>
  wrapper.getComponent(SContextMenuStub).props("items") as Record<string, unknown>[];

/** 按 key 查找菜单按钮元素 */
const findMenuButton = (wrapper: VueWrapper, key: string) =>
  wrapper.get(`[data-menu-key="${key}"]`);

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  m.toast.success.mockReset();
  m.toast.error.mockReset();
  const favLoad = vi.fn(async () => {});
  const favRemove = vi.fn(async () => {});
  const localRemove = vi.fn(async () => {});
  const fixtures: StoreFixtures = {
    settings: {
      appearance: reactive({
        sidebarCollapsed: false,
        sidebarPlaylistCover: false,
        sidebarNavGroups: DEFAULT_SIDEBAR_NAV_GROUPS,
        sidebarHiddenKeys: [] as string[],
        sidebarKeepEmptyDivider: true,
        sidebarNameWithDivider: false,
        sidebarPlaylistOrder: {
          myLocal: [] as string[],
          myOnline: [] as string[],
          subscribed: [] as string[],
        },
      }),
      system: { download: { enabled: false }, streaming: { enabled: false } },
    },
    status: reactive({ heartMode: false, myPlaylistSource: "local" }),
    playlist: reactive({
      playlists: [] as LocalPlaylistFixture[],
      initialized: false,
      load: vi.fn(async () => {}),
      remove: localRemove,
    }),
    favorites: reactive({
      favorites: [] as FavoriteFixture[],
      initialized: false,
      load: favLoad,
      remove: favRemove,
      isFavorite: vi.fn(() => false),
    }),
    user: reactive({
      isLoggedIn: false,
      playlists: [] as OnlinePlaylistFixture[],
      createdPlaylists: [] as OnlinePlaylistFixture[],
      subscribedPlaylists: [] as OnlinePlaylistFixture[],
    }),
    download: { activeCount: 0, init: vi.fn(async () => {}) },
    favLoad,
    favRemove,
    localRemove,
  };
  m.fixtures = fixtures;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

/** 构造覆盖五个平台的收藏夹数据 */
const allPlatformFavorites = (): FavoriteFixture[] =>
  (
    [
      ["netease", "网易收藏"],
      ["qqmusic", "Q音收藏"],
      ["kugou", "酷狗收藏"],
      ["kuwo", "酷我收藏"],
      ["migu", "咪咕收藏"],
    ] as [Platform, string][]
  ).map(([source, title]) => ({ source, originId: "1001", title }));

describe("侧边栏歌单收藏回归", () => {
  it("local 视图聚合五平台在线收藏与自建本地歌单", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push(...allPlatformFavorites());
    (favs.playlist.playlists as LocalPlaylistFixture[]).push(
      { id: "pl-a", title: "本地歌单A" },
      { id: "pl-b", title: "本地歌单B" },
    );
    favs.status.myPlaylistSource = "local";
    wrapper = await mountSideBar(await createAppRouter());
    const items = menuItemsOf(wrapper);
    const keys = items.map((item) => item.key);
    for (const source of ["netease", "qqmusic", "kugou", "kuwo", "migu"] as Platform[]) {
      expect(keys).toContain(`/collection/${source}/playlist/1001`);
    }
    expect(keys).toContain("/collection/local/playlist/pl-a");
    expect(keys).toContain("/collection/local/playlist/pl-b");
    expect(wrapper.text()).toContain("网易收藏");
    expect(wrapper.text()).toContain("本地歌单A");
    // 平台简写行尾标记
    expect(findMenuButton(wrapper, "/collection/netease/playlist/1001").text()).toContain("NCM");
    expect(findMenuButton(wrapper, "/collection/migu/playlist/1001").text()).toContain("MG");
  });

  it("online 视图只显示网易云自建歌单，不出现本地收藏与本地歌单", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push(...allPlatformFavorites());
    (favs.playlist.playlists as LocalPlaylistFixture[]).push({ id: "pl-a", title: "本地歌单A" });
    (favs.user.createdPlaylists as OnlinePlaylistFixture[]).push(
      { id: "ncm-main", name: "我创建的音乐" },
      { id: "ncm-2", name: "云端自建" },
    );
    favs.status.myPlaylistSource = "online";
    wrapper = await mountSideBar(await createAppRouter());
    const keys = menuItemsOf(wrapper)
      .filter((item) => !item.type)
      .map((item) => item.key as string);
    const playlistKeys = keys.filter((key) => key.startsWith("/collection/"));
    expect(playlistKeys).toEqual(["/collection/netease/playlist/ncm-2"]);
    expect(playlistKeys.every((key) => !key.includes("/local/"))).toBe(true);
  });

  it("跨平台同 ID 生成不同 key，重复收藏按 key 去重", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push(
      { source: "kuwo", originId: "42", title: "酷我同名" },
      { source: "migu", originId: "42", title: "咪咕同名" },
      { source: "kuwo", originId: "42", title: "酷我同名" },
    );
    wrapper = await mountSideBar(await createAppRouter());
    const keys = menuItemsOf(wrapper)
      .filter((item) => !item.type)
      .map((item) => item.key);
    expect(keys.filter((key) => key === "/collection/kuwo/playlist/42")).toHaveLength(1);
    expect(keys.filter((key) => key === "/collection/migu/playlist/42")).toHaveLength(1);
    expect(wrapper.text()).toContain("咪咕同名");
  });

  it("收藏详情路由正确导航并高亮，本地子页面归属正确", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push({
      source: "kuwo",
      originId: "42",
      title: "酷我收藏",
    });
    (favs.playlist.playlists as LocalPlaylistFixture[]).push({ id: "pl-a", title: "本地歌单A" });
    favs.status.myPlaylistSource = "local";
    const router = await createAppRouter();
    wrapper = await mountSideBar(router);
    await findMenuButton(wrapper, "/collection/kuwo/playlist/42").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/collection/kuwo/playlist/42");
    expect(findMenuButton(wrapper, "/collection/kuwo/playlist/42").attributes("data-active")).toBe(
      "true",
    );
    expect(
      findMenuButton(wrapper, "/collection/local/playlist/pl-a").attributes("data-active"),
    ).toBe("false");
    await router.push("/collection/local/album/5");
    await flushPromises();
    expect(findMenuButton(wrapper, "/albums/local").attributes("data-active")).toBe("true");
    await router.push("/collection/local/playlist/pl-a");
    await flushPromises();
    expect(
      findMenuButton(wrapper, "/collection/local/playlist/pl-a").attributes("data-active"),
    ).toBe("true");
  });

  it("右键在线收藏仅调用 favorites.remove，不删本地歌单", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push(
      { source: "kuwo", originId: "42", title: "酷我收藏" },
      { source: "netease", originId: "777", title: "网易收藏" },
    );
    (favs.playlist.playlists as LocalPlaylistFixture[]).push({ id: "pl-a", title: "本地歌单A" });
    wrapper = await mountSideBar(await createAppRouter());
    await findMenuButton(wrapper, "/collection/kuwo/playlist/42").trigger("contextmenu");
    await flushPromises();
    const removeEntry = contextItemsOf(wrapper).find((item) => item.key === "removeLocalFavorite");
    expect(removeEntry?.show).toBe(true);
    wrapper.getComponent(SContextMenuStub).vm.$emit("select", "removeLocalFavorite");
    await flushPromises();
    expect(favs.favRemove).toHaveBeenCalledTimes(1);
    expect(favs.favRemove).toHaveBeenCalledWith("kuwo", "42");
    expect(favs.localRemove).not.toHaveBeenCalled();
    expect(m.toast.success).toHaveBeenCalled();
    // 移除入口只在 local 视图 + 目标是收藏时出现
    await findMenuButton(wrapper, "/collection/netease/playlist/777").trigger("contextmenu");
    await flushPromises();
    expect(contextItemsOf(wrapper).find((item) => item.key === "removeLocalFavorite")?.show).toBe(
      true,
    );
  });

  it("右键非收藏项不出现移除收藏入口，触发也不误删", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.playlist.playlists as LocalPlaylistFixture[]).push({ id: "pl-a", title: "本地歌单A" });
    wrapper = await mountSideBar(await createAppRouter());
    // 本地歌单项
    await findMenuButton(wrapper, "/collection/local/playlist/pl-a").trigger("contextmenu");
    await flushPromises();
    expect(contextItemsOf(wrapper).find((item) => item.key === "removeLocalFavorite")?.show).toBe(
      false,
    );
    // 固定导航项 /cloud
    await findMenuButton(wrapper, "/cloud").trigger("contextmenu");
    await flushPromises();
    expect(contextItemsOf(wrapper).find((item) => item.key === "removeLocalFavorite")?.show).toBe(
      false,
    );
    wrapper.getComponent(SContextMenuStub).vm.$emit("select", "removeLocalFavorite");
    await flushPromises();
    expect(favs.favRemove).not.toHaveBeenCalled();
    expect(favs.localRemove).not.toHaveBeenCalled();
  });

  it("初始化未完成时不动隐藏与排序存档", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push({
      source: "kuwo",
      originId: "42",
      title: "酷我收藏",
    });
    (favs.playlist.playlists as LocalPlaylistFixture[]).push({ id: "pl-a", title: "本地歌单A" });
    const appearance = favs.settings.appearance as {
      sidebarHiddenKeys: string[];
      sidebarPlaylistOrder: { myLocal: string[]; myOnline: string[]; subscribed: string[] };
    };
    appearance.sidebarHiddenKeys = [
      "/collection/kuwo/playlist/42",
      "/collection/local/playlist/stale",
    ];
    appearance.sidebarPlaylistOrder = {
      myLocal: ["/collection/local/playlist/stale", "/collection/local/playlist/pl-a"],
      myOnline: ["/collection/netease/playlist/999"],
      subscribed: ["/collection/netease/playlist/555"],
    };
    const router = await createAppRouter();
    wrapper = await mountSideBar(router);
    // 收藏仍未加载
    favs.playlist.initialized = true;
    await flushPromises();
    expect(appearance.sidebarHiddenKeys).toEqual([
      "/collection/kuwo/playlist/42",
      "/collection/local/playlist/stale",
    ]);
    expect(appearance.sidebarPlaylistOrder).toEqual({
      myLocal: ["/collection/local/playlist/stale", "/collection/local/playlist/pl-a"],
      myOnline: ["/collection/netease/playlist/999"],
      subscribed: ["/collection/netease/playlist/555"],
    });
    // 本地仍未加载
    favs.playlist.initialized = false;
    favs.favorites.initialized = true;
    await flushPromises();
    expect(appearance.sidebarHiddenKeys).toHaveLength(2);
    expect(appearance.sidebarPlaylistOrder.myLocal).toHaveLength(2);
    expect(favs.localRemove).not.toHaveBeenCalled();
    void router;
  });

  it("收藏加载完成而云端未就绪时，云端隐藏与排序保留，本地过时项被清理", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push(
      { source: "kuwo", originId: "42", title: "酷我收藏" },
      { source: "migu", originId: "42", title: "咪咕收藏" },
    );
    (favs.playlist.playlists as LocalPlaylistFixture[]).push({ id: "pl-a", title: "本地歌单A" });
    const appearance = favs.settings.appearance as {
      sidebarHiddenKeys: string[];
      sidebarPlaylistOrder: { myLocal: string[]; myOnline: string[]; subscribed: string[] };
    };
    appearance.sidebarHiddenKeys = [
      "/collection/kuwo/playlist/42",
      "/collection/netease/playlist/777",
      "/collection/local/playlist/stale",
    ];
    appearance.sidebarPlaylistOrder = {
      myLocal: ["/collection/local/playlist/stale", "/collection/kuwo/playlist/42"],
      myOnline: ["/collection/netease/playlist/777", "/collection/netease/playlist/999"],
      subscribed: ["/collection/netease/playlist/555"],
    };
    wrapper = await mountSideBar(await createAppRouter());
    // 本地与收藏加载完成，云端列表为空（未登录）
    favs.playlist.initialized = true;
    favs.favorites.initialized = true;
    await flushPromises();
    // 收藏键与网易云隐藏键保留，本地过时键清理
    expect(appearance.sidebarHiddenKeys).toEqual([
      "/collection/kuwo/playlist/42",
      "/collection/netease/playlist/777",
    ]);
    expect(appearance.sidebarPlaylistOrder.myLocal).toEqual(["/collection/kuwo/playlist/42"]);
    // 云端排序在未就绪时不被清理
    expect(appearance.sidebarPlaylistOrder.myOnline).toEqual([
      "/collection/netease/playlist/777",
      "/collection/netease/playlist/999",
    ]);
    expect(appearance.sidebarPlaylistOrder.subscribed).toEqual([
      "/collection/netease/playlist/555",
    ]);
    expect(favs.localRemove).not.toHaveBeenCalled();
    expect(favs.favRemove).not.toHaveBeenCalled();
  });

  it("云端就绪后按云端列表清理网易云过时项", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    (favs.favorites.favorites as FavoriteFixture[]).push({
      source: "kuwo",
      originId: "42",
      title: "酷我收藏",
    });
    (favs.playlist.playlists as LocalPlaylistFixture[]).push({ id: "pl-a", title: "本地歌单A" });
    (favs.user.playlists as OnlinePlaylistFixture[]).push(
      { id: "ncm-main", name: "我创建的音乐" },
      { id: "ncm-sub", name: "已收藏歌单" },
    );
    favs.user.isLoggedIn = true;
    const appearance = favs.settings.appearance as {
      sidebarHiddenKeys: string[];
      sidebarPlaylistOrder: { myLocal: string[]; myOnline: string[]; subscribed: string[] };
    };
    appearance.sidebarHiddenKeys = [
      "/collection/kuwo/playlist/42",
      "/collection/netease/playlist/ncm-main",
      "/collection/netease/playlist/gone",
    ];
    appearance.sidebarPlaylistOrder = {
      myLocal: [],
      myOnline: ["/collection/netease/playlist/ncm-main", "/collection/netease/playlist/gone"],
      subscribed: ["/collection/netease/playlist/ncm-sub", "/collection/netease/playlist/gone"],
    };
    wrapper = await mountSideBar(await createAppRouter());
    favs.playlist.initialized = true;
    favs.favorites.initialized = true;
    await flushPromises();
    // 收藏与现存云端键保留，过时云端键清理
    expect(appearance.sidebarHiddenKeys).toContain("/collection/kuwo/playlist/42");
    expect(appearance.sidebarHiddenKeys).toContain("/collection/netease/playlist/ncm-main");
    expect(appearance.sidebarHiddenKeys).not.toContain("/collection/netease/playlist/gone");
    expect(appearance.sidebarPlaylistOrder.myOnline).toEqual([
      "/collection/netease/playlist/ncm-main",
    ]);
    expect(appearance.sidebarPlaylistOrder.subscribed).toEqual([
      "/collection/netease/playlist/ncm-sub",
    ]);
  });

  it("挂载时按需加载收藏，加载失败提示且不误调移除", async () => {
    const favs = m.fixtures as unknown as StoreFixtures;
    favs.favLoad.mockRejectedValueOnce(new Error("load failed"));
    const router = await createAppRouter();
    wrapper = await mountSideBar(router);
    expect(favs.favLoad).toHaveBeenCalledOnce();
    expect(favs.localRemove).not.toHaveBeenCalled();
    await flushPromises();
    expect(m.toast.error).toHaveBeenCalledOnce();
    wrapper.unmount();
    wrapper = null;
    // 已初始化时不重复加载
    favs.favorites.initialized = true;
    wrapper = await mountSideBar(router);
    expect(favs.favLoad).toHaveBeenCalledOnce();
    expect(favs.favRemove).not.toHaveBeenCalled();
  });
});
