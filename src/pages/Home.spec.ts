/* eslint-disable vue/one-component-per-file -- 路由回归在同一文件声明缓存宿主和歌单详情替身 */
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, KeepAlive, nextTick, ref, type Component } from "vue";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import type { CoverItem } from "@/types/artist";
import zhCN from "@/i18n/locales/zh-CN.json";
import Home from "./Home.vue";

const mocks = vi.hoisted(() => ({
  discover: {} as Record<string, unknown>,
  navigate: vi.fn(),
  loadDiscover: vi.fn(),
  ensurePlaylists: vi.fn(),
  refreshPlaylists: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/composables/home/useHomeDiscover", () => ({ useHomeDiscover: () => mocks.discover }));
vi.mock("@/composables/home/useHomeHeader", () => ({
  useHomeHeader: () => ({ greetingTitle: "Home", greetingSub: "", headerStats: [], load: vi.fn() }),
}));
vi.mock("@/composables/home/useDailyRecommend", () => ({
  useDailyRecommend: () => ({ hero: null, loading: false, previewTracks: [], load: vi.fn() }),
}));
vi.mock("@/composables/home/useContinueListening", () => ({
  useContinueListening: () => ({ items: [], title: "", subtitle: "", load: vi.fn() }),
}));
vi.mock("@/composables/home/useQuickActions", () => ({
  useQuickActions: () => ({ quickActions: [] }),
}));
vi.mock("@/composables/useFloatingPlayerBar", () => ({
  useFloatingPlayerBar: () => ({ isFloatingBar: false }),
}));
vi.mock("@/utils/navigate", () => ({
  navigateToPlaylist: mocks.navigate,
  navigateToArtist: vi.fn(),
  navigateToAlbum: vi.fn(),
}));
vi.mock("@/core/player", () => ({ playNow: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: { warning: mocks.warning } }));

const playlist: CoverItem = {
  id: "shared-id",
  title: "跨平台歌单",
  source: "kuwo",
  trackCount: 20,
};

/** 挂载真实首页，通过控件替身观察事件和状态 */
const mountHome = (component: Component = Home, router?: Router) =>
  mount(component, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } }),
        ...(router ? [router] : []),
      ],
      stubs: {
        CoverList: {
          props: ["items", "showSource"],
          emits: ["click"],
          template:
            '<div><button v-for="item in items" :key="item.source + item.id" @click="$emit(\'click\', item)">{{ item.title }}</button></div>',
        },
        SButton: {
          props: ["disabled"],
          template: '<button :disabled="disabled"><slot name="icon"/><slot/></button>',
        },
        SImg: true,
        STag: true,
        SCard: true,
        IconLucidePlay: true,
        IconLucidePlus: true,
        SLoading: true,
        IconLucideRefreshCw: true,
        IconLucideHeadphones: true,
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshPlaylists.mockResolvedValue(true);
  mocks.discover = {
    recommendPlaylists: ref([playlist]),
    recommendTitle: ref("发现歌单"),
    recommendSubtitle: ref("五个平台"),
    playlistsLoading: ref(false),
    playlistsError: ref(null),
    unavailablePlatforms: ref([]),
    radarPlaylists: ref([]),
    artists: ref([]),
    load: mocks.loadDiscover,
    ensurePlaylists: mocks.ensurePlaylists,
    refreshPlaylists: mocks.refreshPlaylists,
  };
});

describe("首页发现歌单", () => {
  it("歌单按真实来源打开，手动刷新只调用该区块刷新入口", async () => {
    const wrapper = mountHome();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === playlist.title)!
      .trigger("click");
    expect(mocks.navigate).toHaveBeenCalledWith("shared-id", {
      source: "kuwo",
      name: playlist.title,
    });
    await wrapper.get('[aria-label="随机换一批歌单"]').trigger("click");
    await flushPromises();
    expect(mocks.refreshPlaylists).toHaveBeenCalledOnce();
    expect(mocks.loadDiscover).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("刷新中禁用按钮且保留旧歌单，失败时显示可重试提示", async () => {
    const wrapper = mountHome();
    (mocks.discover.playlistsLoading as ReturnType<typeof ref>).value = true;
    await flushPromises();
    expect(wrapper.get('[aria-label="随机换一批歌单"]').attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(playlist.title);
    (mocks.discover.playlistsLoading as ReturnType<typeof ref>).value = false;
    (mocks.discover.playlistsError as ReturnType<typeof ref>).value =
      "home.discovery.refreshFailed";
    await flushPromises();
    expect(wrapper.text()).toContain("刷新失败，已保留上一批歌单");
    wrapper.unmount();
  });

  it("首次失败时标题和刷新入口仍存在", async () => {
    (mocks.discover.recommendPlaylists as ReturnType<typeof ref>).value = [];
    (mocks.discover.playlistsError as ReturnType<typeof ref>).value = "home.discovery.loadFailed";
    const wrapper = mountHome();
    expect(wrapper.text()).toContain("发现歌单");
    expect(wrapper.text()).toContain("暂时无法获取歌单");
    expect(wrapper.find('[aria-label="随机换一批歌单"]').exists()).toBe(true);
    wrapper.unmount();
  });
  it("首页滚动后打开歌单再返回，恢复独立滚动容器位置且保留原列表", async () => {
    const detail = defineComponent({
      name: "PlaylistDetailFixture",
      render: () => h("div", "歌单详情"),
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: Home },
        { path: "/playlist", component: detail },
      ],
    });
    const host = defineComponent({
      render: () =>
        h(
          RouterView,
          {},
          {
            default: ({ Component: page }: { Component: Component }) =>
              h(KeepAlive, { include: ["Home"] }, { default: () => h(page) }),
          },
        ),
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mountHome(host, router);
    await flushPromises();
    const scroll = wrapper.findComponent(Home).get(".h-full.overflow-y-auto");
    scroll.element.scrollTop = 860;
    await scroll.trigger("scroll");
    await router.push("/playlist");
    await flushPromises();
    // 模拟离场后浏览器归零：迟到 scroll 事件不能覆盖离开前的位置
    scroll.element.scrollTop = 0;
    await scroll.trigger("scroll");
    router.back();
    await flushPromises();
    await nextTick();
    const returned = wrapper.findComponent(Home).get(".h-full.overflow-y-auto");
    expect(returned.element).toBe(scroll.element);
    expect(returned.element.scrollTop).toBe(860);
    expect(wrapper.text()).toContain(playlist.title);
    expect(mocks.loadDiscover).toHaveBeenCalledOnce();
    expect(mocks.ensurePlaylists).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
