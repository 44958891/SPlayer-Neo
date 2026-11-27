/* eslint-disable vue/one-component-per-file -- 页面挂载在同一文件声明替身组件 */
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { defineComponent, type PropType } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@shared/types/platform";
import type { PlaylistFavorite } from "@shared/types/playlist";
import type { Collection, CollectionType } from "@/types/collection";

const mocks = vi.hoisted(() => ({
  loadCollection: vi.fn(),
  playFrom: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
  createI18n: () => ({ global: { t: (key: string) => key }, install: () => {} }),
}));
vi.mock("@/services/collection", () => ({ loadCollection: mocks.loadCollection }));
vi.mock("@/services/download/resolver", () => ({ initDownloadResolver: vi.fn() }));
vi.mock("@/core/player", () => ({ playFrom: mocks.playFrom }));
vi.mock("@/composables/useToast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/stores/user", () => ({
  useUserStore: () => ({
    createdPlaylists: [],
    subscribedPlaylists: [],
    albums: [],
    likedPlaylistId: null,
    togglePlaylistSubscribe: vi.fn(),
    toggleAlbumSubscribe: vi.fn(),
  }),
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

import CollectionPage from "./Collection.vue";

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

/** 构造合集数据 */
const fixture = (source: string, type: string, id: string): Collection => ({
  id,
  type: type as CollectionType,
  source: source as Collection["source"],
  title: "测试合集",
  cover: "cover://c.jpg",
  tracks: [],
  trackCount: 0,
});

/** 按钮替身：保留 type/loading/disabled 与 aria 属性供断言 */
const ButtonStub = defineComponent({
  props: {
    type: { type: String, default: undefined },
    variant: { type: String, default: undefined },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    title: { type: String, default: undefined },
    ariaLabel: { type: String, default: undefined },
    ariaPressed: { type: Boolean, default: undefined },
  },
  template:
    '<button :data-type="type || \'default\'" :disabled="disabled || loading" :aria-pressed="ariaPressed" :aria-label="ariaLabel"><slot name="icon" /><slot /></button>',
});

/** 按文本查找按钮（旧心形无 aria-label，以文案定位） */
const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) =>
  wrapper.findAll("button").filter((button) => button.text().includes(text));

/** 下拉菜单替身：保留 items 供断言 */
const MenuStub = defineComponent({
  props: {
    items: { type: Array as PropType<Record<string, unknown>[]>, default: () => [] },
  },
  template: '<div class="menu-stub" />',
});

/** 挂载合集页并等待加载完成 */
const mountPage = async (source: string, type: string, id = "pl-1") => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/collection/:source/:type/:id", component: CollectionPage }],
  });
  await router.push(`/collection/${source}/${type}/${id}`);
  await router.isReady();
  mocks.loadCollection.mockImplementation(async (...args: unknown[]) => {
    const options = args[3] as { onUpdate: (value: Collection | null) => void };
    options.onUpdate(fixture(source, type, id));
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(CollectionPage, {
    global: {
      plugins: [pinia, router],
      stubs: {
        SButton: ButtonStub,
        SDropdownMenu: MenuStub,
        SongList: true,
        SImg: true,
        STooltip: true,
        SDivider: true,
        SInput: true,
        SDialog: true,
        SFormItem: true,
        SLoading: true,
        IconLucidePlay: true,
        IconLucideHardDrive: true,
        IconLucideGlobe2: true,
        IconLucideDisc3: true,
        IconLucideRadio: true,
        IconLucideCloud: true,
        IconLucideTriangleAlert: true,
        IconLucideRefreshCw: true,
        IconLucideMusic: true,
        IconLucideSearch: true,
        IconLucideStar: true,
        IconLucideEllipsis: true,
        IconMaterialSymbolsFavoriteRounded: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

describe("Collection 本地收藏按钮", () => {
  beforeEach(() => {
    mocks.loadCollection.mockReset();
    mocks.playFrom.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    api.config.getAll.mockReset().mockResolvedValue({});
    api.config.set.mockReset().mockResolvedValue(undefined);
    api.playlist.listFavorites.mockReset().mockResolvedValue([]);
    api.playlist.addFavorite.mockReset();
    api.playlist.removeFavorite.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "api", { configurable: true, value: api });
  });

  it("网易歌单显示星标、隐藏旧心形并带 cloud 菜单项", async () => {
    const wrapper = await mountPage("netease", "playlist");
    const star = wrapper.find('button[aria-label="collection.localFavorite.addHint"]');
    expect(star.exists()).toBe(true);
    expect(star.attributes("aria-pressed")).toBe("false");
    expect(star.attributes("data-type")).toBe("default");
    expect(findButtonByText(wrapper, "collection.subscribe")).toHaveLength(0);
    const items = wrapper.findComponent(MenuStub).props("items") as {
      key: string;
      label: string;
      show?: boolean;
    }[];
    const cloud = items.find((item) => item.key === "cloudFavorite");
    expect(cloud?.show).toBe(true);
    expect(cloud?.label).toBe("collection.localFavorite.cloudAdd");
    wrapper.unmount();
  });

  it("已收藏时星标呈主色按下态并切换提示", async () => {
    api.playlist.listFavorites.mockResolvedValue([record("netease", "pl-1")]);
    const wrapper = await mountPage("netease", "playlist");
    const star = wrapper.find('button[aria-label="collection.localFavorite.removeHint"]');
    expect(star.exists()).toBe(true);
    expect(star.attributes("data-type")).toBe("primary");
    expect(star.attributes("aria-pressed")).toBe("true");
    expect(star.text()).toContain("collection.localFavorite.done");
    wrapper.unmount();
  });

  it("本地与流媒体歌单不显示星标和 cloud 菜单", async () => {
    const local = await mountPage("local", "playlist", "local-1");
    expect(local.find('button[aria-label="collection.localFavorite.addHint"]').exists()).toBe(
      false,
    );
    local.unmount();
    const streaming = await mountPage("streaming", "playlist");
    expect(streaming.find('button[aria-label="collection.localFavorite.addHint"]').exists()).toBe(
      false,
    );
    const items = streaming.findComponent(MenuStub).props("items") as {
      key: string;
      show?: boolean;
    }[];
    const visible = items.filter((item) => item.show !== false);
    expect(visible.some((item) => item.key === "cloudFavorite")).toBe(false);
    streaming.unmount();
  });

  it("网易专辑保留原心形且不显示星标和 cloud 菜单", async () => {
    const wrapper = await mountPage("netease", "album", "alb-1");
    expect(findButtonByText(wrapper, "collection.subscribe")).toHaveLength(1);
    expect(wrapper.find('button[aria-label="collection.localFavorite.addHint"]').exists()).toBe(
      false,
    );
    const items = wrapper.findComponent(MenuStub).props("items") as {
      key: string;
      show?: boolean;
    }[];
    const visible = items.filter((item) => item.show !== false);
    expect(visible.some((item) => item.key === "cloudFavorite")).toBe(false);
    wrapper.unmount();
  });

  it("点击星标写入收藏并切换为已收藏态", async () => {
    api.playlist.addFavorite.mockResolvedValue(record("netease", "pl-1"));
    const wrapper = await mountPage("netease", "playlist");
    await wrapper.find('button[aria-label="collection.localFavorite.addHint"]').trigger("click");
    await flushPromises();
    expect(api.playlist.addFavorite).toHaveBeenCalledTimes(1);
    expect(wrapper.find('button[aria-label="collection.localFavorite.removeHint"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });
});
