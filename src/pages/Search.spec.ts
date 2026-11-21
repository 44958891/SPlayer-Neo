/* eslint-disable vue/one-component-per-file -- 测试替身桩组件集中声明在本文件内，属测试脚手架而非业务组件，不拆分文件 */
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import zhCN from "@/i18n/locales/zh-CN.json";
import SearchPage from "./Search.vue";

const mocks = vi.hoisted(() => {
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  return {
    deferred,
    routeRaw: { name: "search", query: { q: "" } } as {
      name: string;
      query: Record<string, string>;
    },
    routerReplace: vi.fn(),
    statusRaw: { searchPlatform: "qqmusic" },
    pluginsRaw: { list: [] as unknown[] },
    fetchers: {
      songs: vi.fn(),
      albums: vi.fn(),
      artists: vi.fn(),
      playlists: vi.fn(),
    },
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => reactive(mocks.routeRaw),
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock("@/stores/status", () => ({ useStatusStore: () => reactive(mocks.statusRaw) }));

vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => reactive(mocks.pluginsRaw) }));

// vue 对同一 raw 缓存同一 reactive 代理，测试侧与组件共享同一对象
const route = reactive(mocks.routeRaw);
const statusState = reactive(mocks.statusRaw);
const pluginsState = reactive(mocks.pluginsRaw);

vi.mock("@/apis/search", () => ({
  searchSongs: mocks.fetchers.songs,
  searchAlbums: mocks.fetchers.albums,
  searchArtists: mocks.fetchers.artists,
  searchPlaylists: mocks.fetchers.playlists,
}));

vi.mock("@/core/player", () => ({ playFrom: vi.fn() }));

vi.mock("@/utils/navigate", () => ({
  navigateToAlbum: vi.fn(),
  navigateToArtist: vi.fn(),
  navigateToPlaylist: vi.fn(),
}));

const SongListStub = defineComponent({
  name: "SongList",
  props: {
    items: { type: Array, default: () => [] },
    hasMore: { type: Boolean, default: false },
    loadingMore: { type: Boolean, default: false },
  },
  emits: ["reach-bottom"],
  template: `<div class="song-list-stub"><button class="load-more" @click="$emit('reach-bottom')">more</button><div v-for="item in items" :key="item.id" class="song-item">{{ item.id }}</div></div>`,
});

const CoverListStub = defineComponent({
  name: "CoverList",
  props: { items: { type: Array, default: () => [] } },
  emits: ["reach-bottom"],
  template: `<div class="cover-list-stub"><div v-for="item in items" :key="item.id" class="cover-item">{{ item.id }}</div></div>`,
});

const STabsStub = defineComponent({
  name: "STabs",
  props: { modelValue: { type: null, default: "" }, tabs: { type: Array, default: () => [] } },
  emits: ["update:modelValue"],
  template: `<div class="stabs"><button v-for="tab in tabs" :key="String(tab.key)" class="stab" @click="$emit('update:modelValue', tab.key)">{{ tab.label }}</button></div>`,
});

const SSelectStub = defineComponent({
  name: "SSelect",
  props: {
    modelValue: { type: [String, Number, Boolean], default: "" },
    options: { type: Array, default: () => [] },
  },
  template: '<div class="sselect"/>',
});

const SButtonStub = defineComponent({
  name: "SButton",
  props: { loading: { type: Boolean, default: false } },
  template: '<button :disabled="loading"><slot name="icon"/><slot/></button>',
});

const mountPage = () =>
  mount(SearchPage, {
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: "zh-CN",
          messages: { "zh-CN": zhCN },
          missingWarn: false,
          fallbackWarn: false,
        }),
      ],
      stubs: {
        SongList: SongListStub,
        CoverList: CoverListStub,
        STabs: STabsStub,
        SSelect: SSelectStub,
        SButton: SButtonStub,
        SLoading: true,
        IconLucidePlay: true,
        IconLucideSearch: true,
        IconLucideTriangleAlert: true,
        IconLucideRotateCw: true,
        IconLucideSearchX: true,
        IconLucideHistory: true,
      },
    },
  });

const page = (items: { id: string }[], extra: Record<string, unknown> = {}) => ({
  items,
  total: items.length,
  hasMore: false,
  ...extra,
});

const platformButtons = (wrapper: ReturnType<typeof mountPage>): string[] =>
  wrapper.findAll("button").map((button) => button.text().trim());

beforeEach(() => {
  vi.resetAllMocks();
  route.name = "search";
  route.query = { q: "test" };
  statusState.searchPlatform = "qqmusic";
  pluginsState.list = [];
  Object.defineProperty(window, "api", {
    value: { plugins: { search: vi.fn() } },
    configurable: true,
  });
});

describe("搜索页缓存恢复横幅", () => {
  it("命中缓存恢复时展示横幅并携带本地时间", async () => {
    const cachedAt = 1735689600000;
    mocks.fetchers.songs.mockResolvedValue(
      page([{ id: "t1" }, { id: "t2" }], {
        total: 200,
        hasMore: true,
        searchRecovery: { kind: "cache", cachedAt },
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("缓存结果");
    expect(text).toContain(new Date(cachedAt).toLocaleString());
    expect(wrapper.findAll(".song-item")).toHaveLength(2);
    wrapper.unmount();
  });

  it("正常结果不展示缓存横幅", async () => {
    mocks.fetchers.songs.mockResolvedValue(page([{ id: "t1" }]));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).not.toContain("缓存结果");
    wrapper.unmount();
  });

  it("追加的新页未命中恢复时保留先前页的缓存横幅", async () => {
    const cachedAt = 1735689600000;
    mocks.fetchers.songs
      .mockResolvedValueOnce(
        page([{ id: "t1" }], {
          total: 4,
          hasMore: true,
          searchRecovery: { kind: "cache", cachedAt },
        }),
      )
      .mockResolvedValueOnce(page([{ id: "t2" }], { total: 4, hasMore: false }));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain(new Date(cachedAt).toLocaleString());
    await wrapper.find(".load-more").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".song-item")).toHaveLength(2);
    expect(wrapper.text()).toContain("缓存结果");
    expect(wrapper.text()).toContain(new Date(cachedAt).toLocaleString());
    wrapper.unmount();
  });

  it("缓存恢复的空结果在无结果态也展示缓存提示", async () => {
    mocks.fetchers.songs.mockResolvedValue(
      page([], { searchRecovery: { kind: "cache", cachedAt: 1735689600000 } }),
    );
    const wrapper = mountPage();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("没有找到匹配内容");
    expect(text).toContain("缓存结果");
    wrapper.unmount();
  });
});

describe("搜索页按 tab 隔离的错误态", () => {
  it("QQ 平台首屏失败展示友好文案，原始错误收进详情并提供重试与换平台", async () => {
    mocks.fetchers.songs.mockRejectedValue(new Error("QM search failed: upstream 503"));
    const wrapper = mountPage();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("QQ音乐服务暂时不可用");
    expect(text).toContain("错误详情");
    expect(text).toContain("QM search failed: upstream 503");
    expect(text).toContain("换个平台试试");
    const rowButtons = wrapper.findAll(".other-platforms button").map((b) => b.text().trim());
    expect(rowButtons).toEqual(["NCM", "KG", "KW", "MG"]);
    expect(platformButtons(wrapper)).toContain("重试");
    wrapper.unmount();
  });

  it("QQ 稀疏页使用接口偏移量追加，不按显示条数重复上一页", async () => {
    mocks.fetchers.songs
      .mockResolvedValueOnce(page([{ id: "t1" }], { total: 200, hasMore: true, nextOffset: 50 }))
      .mockResolvedValueOnce(page([{ id: "t2" }], { total: 200, hasMore: true, nextOffset: 100 }));
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find(".load-more").trigger("click");
    await flushPromises();
    expect(mocks.fetchers.songs).toHaveBeenLastCalledWith("qqmusic", "test", 50, 50);
    expect(wrapper.findAll(".song-item")).toHaveLength(2);
    wrapper.unmount();
  });

  it("追加页失败保留已有结果并内联提示，重试仅补拉失败页", async () => {
    mocks.fetchers.songs
      .mockResolvedValueOnce(page([{ id: "t1" }, { id: "t2" }], { total: 4, hasMore: true }))
      .mockRejectedValueOnce(new Error("append page failed"))
      .mockResolvedValueOnce(page([{ id: "t3" }, { id: "t4" }], { total: 4, hasMore: false }));
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find(".load-more").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".song-item")).toHaveLength(2);
    expect(wrapper.find(".song-list-stub").exists()).toBe(true);
    expect(wrapper.text()).toContain("QQ音乐服务暂时不可用");
    expect(wrapper.text()).toContain("append page failed");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "重试")!
      .trigger("click");
    await flushPromises();
    expect(mocks.fetchers.songs).toHaveBeenLastCalledWith("qqmusic", "test", 2, 50);
    expect(wrapper.findAll(".song-item")).toHaveLength(4);
    expect(wrapper.text()).not.toContain("QQ音乐服务暂时不可用");
    wrapper.unmount();
  });

  it("错误按 tab 隔离：切到正常 tab 不展示错误，切回后重新拉取", async () => {
    mocks.fetchers.songs.mockRejectedValue(new Error("songs failed"));
    mocks.fetchers.albums.mockResolvedValue(page([{ id: "al1" }]));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("QQ音乐服务暂时不可用");
    route.query = { q: "test", tab: "albums" };
    await nextTick();
    await flushPromises();
    expect(wrapper.find(".cover-list-stub").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("QQ音乐服务暂时不可用");
    mocks.fetchers.songs.mockResolvedValue(page([{ id: "t1" }]));
    route.query = { q: "test", tab: "songs" };
    await nextTick();
    await flushPromises();
    expect(wrapper.find(".song-list-stub").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("QQ音乐服务暂时不可用");
    wrapper.unmount();
  });

  it("切换平台后清空错误并按新平台重新拉取", async () => {
    mocks.fetchers.songs.mockRejectedValue(new Error("qq down"));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("QQ音乐服务暂时不可用");
    mocks.fetchers.songs.mockResolvedValue(page([{ id: "ncm1" }]));
    await wrapper
      .findAll(".stabs")[0]!
      .findAll("button")
      .find((b) => b.text() === "KW")!
      .trigger("click");
    await flushPromises();
    expect(statusState.searchPlatform).toBe("kuwo");
    expect(mocks.fetchers.songs).toHaveBeenLastCalledWith("kuwo", "test", 0, 50);
    expect(wrapper.text()).not.toContain("QQ音乐服务暂时不可用");
    expect(wrapper.findAll(".song-item")).toHaveLength(1);
    wrapper.unmount();
  });

  it("插件音源不可用时展示音源错误，换平台行列出全部内置平台", async () => {
    route.query = { q: "test", plugin: "broken.plugin", source: "xx" };
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("未找到可用的音源插件");
    expect(wrapper.text()).toContain("搜索失败");
    const rowButtons = wrapper.findAll(".other-platforms button").map((b) => b.text().trim());
    expect(rowButtons).toEqual(["NCM", "QM", "KG", "KW", "MG"]);
    expect(mocks.fetchers.songs).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("生成号守卫：旧关键词的迟到失败与新结果互不污染", async () => {
    const first = mocks.deferred<{ items: { id: string }[]; total: number; hasMore: boolean }>();
    const second = mocks.deferred<{ items: { id: string }[]; total: number; hasMore: boolean }>();
    mocks.fetchers.songs.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    route.query = { q: "a" };
    const wrapper = mountPage();
    await nextTick();
    route.query = { q: "b" };
    await nextTick();
    first.reject(new Error("stale failure"));
    await flushPromises();
    expect(wrapper.text()).not.toContain("stale failure");
    expect(wrapper.text()).not.toContain("搜索失败");
    second.resolve({ items: [{ id: "fresh" }], total: 1, hasMore: false });
    await flushPromises();
    expect(wrapper.findAll(".song-item").map((node) => node.text())).toEqual(["fresh"]);
    wrapper.unmount();
  });
});
