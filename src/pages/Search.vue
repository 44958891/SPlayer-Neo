<script setup lang="ts">
defineOptions({ name: "SearchPage" });

import type { PlaybackContext, Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME, type Platform } from "@shared/types/platform";
import type { CoverItem } from "@/types/artist";
import { searchSongs, searchAlbums, searchArtists, searchPlaylists } from "@/apis/search";
import type { SearchRecovery } from "@/apis/search";
import SongList from "@/components/list/SongList.vue";
import CoverList from "@/components/list/CoverList.vue";
import * as player from "@/core/player";
import { useStatusStore } from "@/stores/status";
import { usePluginsStore } from "@/stores/plugins";
import { navigateToAlbum, navigateToArtist, navigateToPlaylist } from "@/utils/navigate";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const plugins = usePluginsStore();

type TabKey = "songs" | "albums" | "artists" | "playlists";

const TAB_KEYS: readonly TabKey[] = ["songs", "albums", "artists", "playlists"];

const PAGE_SIZE = 50;

/** 当前生效的 tab */
const activeTab = ref<TabKey>("songs");

/** 当前生效的关键词 */
const keyword = ref("");

const tabs = computed(() =>
  [
    { key: "songs", label: t("search.tabs.songs") },
    { key: "albums", label: t("search.tabs.albums") },
    { key: "artists", label: t("search.tabs.artists") },
    { key: "playlists", label: t("search.tabs.playlists") },
  ].filter((tab) => !pluginSelection.value || tab.key === "songs"),
);

const platformTabs = ALL_PLATFORMS.map((key) => ({ key, label: PLATFORM_SHORT_NAME[key] }));
const pluginSources = computed(() =>
  plugins.list.flatMap((info) => {
    if (!info.enabled || info.status.state !== "ready") return [];
    return Object.entries(info.status.sources)
      .filter(
        ([source, capability]) =>
          !["wy", "tx", "kg"].includes(source) &&
          capability.actions.includes("musicSearch") &&
          capability.actions.includes("musicUrl"),
      )
      .map(([source, capability]) => ({
        value: JSON.stringify([info.manifest.id, source]),
        label:
          capability.name === info.manifest.name
            ? capability.name
            : `${capability.name} · ${info.manifest.name}`,
        pluginId: info.manifest.id,
        source,
      }));
  }),
);
const pluginSelection = computed(() =>
  typeof route.query.plugin === "string" && typeof route.query.source === "string"
    ? { pluginId: route.query.plugin, source: route.query.source }
    : null,
);
const selectedSource = computed(() =>
  pluginSelection.value
    ? JSON.stringify([pluginSelection.value.pluginId, pluginSelection.value.source])
    : status.searchPlatform,
);
const pluginAvailable = computed(
  () =>
    !pluginSelection.value ||
    pluginSources.value.some((source) => source.value === selectedSource.value),
);
const sourceOptions = computed(() => {
  const options: { value: string; label: string }[] = [
    ...platformTabs.map(({ key, label }) => ({ value: key, label })),
    ...pluginSources.value,
  ];
  if (pluginSelection.value && !pluginAvailable.value) {
    options.push({ value: selectedSource.value, label: pluginSelection.value.source });
  }
  return options;
});

interface TabState<T> {
  items: T[];
  total: number;
  page: number;
  nextOffset: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** 当前 tab 的失败信息（按 tab 隔离，追加失败不清空已有结果） */
  error: string;
  /** 内置平台命中主进程缓存恢复时的元数据 */
  searchRecovery: SearchRecovery | null;
}

const createState = <T,>(): TabState<T> => ({
  items: [],
  total: 0,
  page: 0,
  nextOffset: 0,
  hasMore: false,
  loaded: false,
  loading: false,
  loadingMore: false,
  error: "",
  searchRecovery: null,
});

const states = {
  songs: shallowReactive(createState<Track>()),
  albums: shallowReactive(createState<CoverItem>()),
  artists: shallowReactive(createState<CoverItem>()),
  playlists: shallowReactive(createState<CoverItem>()),
};
let searchGeneration = 0;

/** 派发到 apis 层的统一调用 */
const fetchers = {
  songs: searchSongs,
  albums: searchAlbums,
  artists: searchArtists,
  playlists: searchPlaylists,
} as const;

/**
 * 拉取指定 tab
 * @param tab - 要拉取的 tab
 * @param append - 是否追加下一页
 */
const fetchTab = async (tab: TabKey, append: boolean): Promise<void> => {
  if (!keyword.value) return;
  const state = states[tab];
  if (!pluginAvailable.value) {
    state.error = t("errors.NO_PLUGIN_AVAILABLE");
    return;
  }
  const generation = searchGeneration;
  if (append) {
    if (!state.loaded || state.loadingMore || !state.hasMore) return;
    state.loadingMore = true;
  } else {
    if (state.loading) return;
    state.loading = true;
  }
  state.error = "";
  try {
    const offset = append ? state.nextOffset : 0;
    const page = append ? state.page + 1 : 1;
    const selection = pluginSelection.value;
    let items: Track[];
    let total = 0;
    let hasMore = false;
    let nextOffset: number | undefined;
    let recovery: SearchRecovery | null = null;
    if (selection) {
      const result = await window.api.plugins.search({
        ...selection,
        keyword: keyword.value,
        page,
        limit: PAGE_SIZE,
      });
      if (generation !== searchGeneration) return;
      items = result.items;
      total = result.total;
      hasMore = result.hasMore;
    } else {
      const result = await (fetchers[tab] as typeof searchSongs)(
        status.searchPlatform,
        keyword.value,
        offset,
        PAGE_SIZE,
      );
      if (generation !== searchGeneration) return;
      items = result.items;
      total = result.total;
      hasMore = result.hasMore;
      nextOffset = result.nextOffset;
      // 仅内置平台结果携带缓存恢复元数据，插件结果没有该字段
      recovery = result.searchRecovery ?? null;
    }
    const mapped = items.map((item) => markRaw(item));
    state.items = append ? ([...state.items, ...mapped] as Track[]) : (mapped as Track[]);
    state.page = page;
    state.nextOffset = nextOffset ?? offset + items.length;
    state.total = total;
    state.hasMore = hasMore;
    state.loaded = true;
    // 追加页未命中恢复时保留此前页的恢复标记，避免旧缓存页被新页顶掉横幅
    state.searchRecovery = append ? (recovery ?? state.searchRecovery) : recovery;
  } catch (err) {
    if (generation !== searchGeneration) return;
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (generation === searchGeneration) {
      state.loading = false;
      state.loadingMore = false;
    }
  }
};

const resetStates = (): void => {
  searchGeneration++;
  (Object.keys(states) as TabKey[]).forEach((tab) => {
    states[tab].items = [];
    states[tab].total = 0;
    states[tab].page = 0;
    states[tab].nextOffset = 0;
    states[tab].hasMore = false;
    states[tab].loaded = false;
    states[tab].loading = false;
    states[tab].loadingMore = false;
    states[tab].error = "";
    states[tab].searchRecovery = null;
  });
};

let lastLoadedKeyword = "";
let lastLoadedSource = "";
let lastAvailable = true;

/** 仅在当前处于搜索路由时同步路由参数，避免离开到其他页面时因 query 为空而误清空状态 */
const syncFromRoute = (): void => {
  if (route.name !== "search") return;
  const q = typeof route.query.q === "string" ? route.query.q.trim() : "";
  const tab =
    !pluginSelection.value &&
    typeof route.query.tab === "string" &&
    (TAB_KEYS as readonly string[]).includes(route.query.tab)
      ? (route.query.tab as TabKey)
      : "songs";

  activeTab.value = tab;
  keyword.value = q;

  const keywordChanged = q !== lastLoadedKeyword;
  const sourceChanged =
    selectedSource.value !== lastLoadedSource || pluginAvailable.value !== lastAvailable;

  if (keywordChanged || sourceChanged) {
    lastLoadedKeyword = q;
    lastLoadedSource = selectedSource.value;
    lastAvailable = pluginAvailable.value;
    resetStates();
    if (q) fetchTab(tab, false);
  } else if (q && !states[tab].loaded) {
    fetchTab(tab, false);
  }
};

watch(
  () => [route.name, route.query.q, route.query.tab, selectedSource.value, pluginAvailable.value],
  syncFromRoute,
  {
    immediate: true,
  },
);

const onTabSwitch = (key: string): void => {
  router.replace({ query: { ...route.query, tab: key } });
};

const onPlatformSwitch = (key: string | number | boolean): void => {
  const source = pluginSources.value.find((item) => item.value === key);
  if (!source && !(ALL_PLATFORMS as readonly unknown[]).includes(key)) return;
  if (!source) status.searchPlatform = key as Platform;
  router.replace({
    query: {
      ...route.query,
      plugin: source?.pluginId,
      source: source?.source,
      tab: source ? "songs" : route.query.tab,
    },
  });
};

/** 失败后重试当前 tab：已有结果时仅重试失败的追加页，首屏失败则整页重来 */
const onRetry = (): void => {
  const state = states[activeTab.value];
  state.error = "";
  const useAppend = state.loaded && state.items.length > 0 && state.hasMore;
  fetchTab(activeTab.value, useAppend);
};

/** 滚动触底加载下一页 */
const onReachBottom = (tab: TabKey): void => {
  fetchTab(tab, true);
};

/** 当前 tab 首屏加载中 */
const isInitialLoading = computed(() => {
  const state = states[activeTab.value];
  return state.loading && !state.loaded;
});

/** 当前生效的 tab 状态 */
const activeState = computed(() => states[activeTab.value]);

/** 当前 tab 的错误信息 */
const activeError = computed(() => activeState.value.error);

/** 整页失败（首屏未拿到任何结果，用全页错误态展示） */
const isFullError = computed(
  () =>
    Boolean(activeError.value) &&
    (!activeState.value.loaded || activeState.value.items.length === 0),
);

/** 追加页失败（已有结果保留，用内联错误提示） */
const hasInlineError = computed(() => Boolean(activeError.value) && !isFullError.value);

/** 当前 tab 命中的缓存恢复元数据 */
const activeRecovery = computed(() => activeState.value.searchRecovery);

const isCacheRecovered = computed(() => activeRecovery.value?.kind === "cache");

/** 缓存生成时间的本地化文本 */
const cachedAtText = computed(() => {
  const cachedAt = activeRecovery.value?.cachedAt;
  return cachedAt ? new Date(cachedAt).toLocaleString() : "";
});

/** 错误态的友好提示：QQ 平台给专属文案，其余沿用通用标题（原始错误收进详情） */
const friendlyErrorText = computed(() =>
  !pluginSelection.value && status.searchPlatform === "qqmusic"
    ? t("search.qqUnavailable")
    : t("search.errorTitle"),
);

/** 错误态一键切换的其他平台（排除当前音源，插件音源时不排除任何内置平台） */
const otherPlatforms = computed(() => {
  const exclude = pluginSelection.value ? null : status.searchPlatform;
  return ALL_PLATFORMS.filter((key) => key !== exclude).map((key) => ({
    key,
    label: PLATFORM_SHORT_NAME[key],
  }));
});

/** 当前 tab 已加载且为空 */
const isEmptyResult = computed(() => {
  const state = states[activeTab.value];
  return state.loaded && state.items.length === 0;
});

/** 单曲 tab 的已加载曲目（播放全部的目标队列） */
const songItems = computed(() => states.songs.items);

/** 搜索页播放来源上下文 */
const playbackContext = computed<PlaybackContext>(() => ({
  provider: pluginSelection.value ? "plugin" : status.searchPlatform,
  originId: `search:${selectedSource.value}:${keyword.value}`,
  originType: "page",
  originName: keyword.value ? `${t("search.title")}: ${keyword.value}` : t("search.title"),
}));

/** 播放全部：仅在单曲 tab 且已有结果时可用 */
const canPlayAll = computed(() => activeTab.value === "songs" && songItems.value.length > 0);

/** 从首曲开始播放当前搜索结果 */
const handlePlayAll = (): void => {
  if (!canPlayAll.value) return;
  player.playFrom(songItems.value, 0, playbackContext.value);
};
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="mt-2 mb-4 flex items-end justify-between gap-4">
        <h1 class="min-w-0 flex items-baseline pr-3">
          <span class="min-w-0 truncate text-3xl font-bold text-on-surface">
            {{ keyword || t("search.title") }}
          </span>
          <span
            v-if="keyword"
            class="ml-2 shrink-0 whitespace-nowrap font-medium text-lg text-on-surface-variant/60"
          >
            {{ t("search.titleSuffix") }}
          </span>
        </h1>
        <!-- 平台切换：有插件独立音源时下拉选择，否则按 5 枚平台标签（NCM/QM/KG/KW/MG）自适应 -->
        <div class="shrink-0" :class="pluginSources.length || pluginSelection ? 'w-52' : 'w-64'">
          <SSelect
            v-if="pluginSources.length || pluginSelection"
            :model-value="selectedSource"
            :options="sourceOptions"
            round
            @update:model-value="onPlatformSwitch"
          />
          <STabs
            v-else
            :model-value="status.searchPlatform"
            :tabs="platformTabs"
            type="segment"
            round
            @update:model-value="onPlatformSwitch"
          />
        </div>
      </div>
      <div class="flex items-center justify-between gap-4">
        <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabSwitch" />
        <Transition name="fade" :duration="150">
          <SButton
            v-if="canPlayAll"
            type="primary"
            variant="secondary"
            size="small"
            round
            class="shrink-0"
            :title="t('common.playAll')"
            @click="handlePlayAll"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("common.playAll") }}
          </SButton>
        </Transition>
      </div>
    </div>
    <!-- 空关键词 -->
    <div v-if="!keyword" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearch class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm">{{ t("search.emptyKeyword") }}</div>
      </div>
    </div>
    <!-- 整页错误态：首屏失败 -->
    <div v-else-if="isFullError" class="flex-1 flex items-center justify-center px-6">
      <div class="text-center flex flex-col items-center">
        <div class="text-red-500/85 mb-4">
          <IconLucideTriangleAlert class="size-14 mx-auto mb-3 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ friendlyErrorText }}</div>
          <details v-if="activeError" class="text-xs opacity-80 break-all max-w-xs">
            <summary class="cursor-pointer outline-none mb-1">
              {{ t("search.errorDetails") }}
            </summary>
            {{ activeError }}
          </details>
        </div>
        <SButton
          variant="secondary"
          size="small"
          :loading="states[activeTab].loading"
          class="mb-3"
          @click="onRetry"
        >
          <template #icon>
            <IconLucideRotateCw class="size-3.5" />
          </template>
          {{ t("common.retry") }}
        </SButton>
        <div class="text-xs text-on-surface-variant/60 mb-2">
          {{ t("search.tryOtherPlatform") }}
        </div>
        <div class="other-platforms flex items-center gap-2">
          <SButton
            v-for="platform in otherPlatforms"
            :key="platform.key"
            variant="secondary"
            size="small"
            round
            @click="onPlatformSwitch(platform.key)"
          >
            {{ platform.label }}
          </SButton>
        </div>
      </div>
    </div>
    <!-- 首次加载 -->
    <div v-else-if="isInitialLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
        <div class="text-sm">{{ t("common.loading") }}</div>
      </div>
    </div>
    <!-- 无结果 -->
    <div v-else-if="isEmptyResult" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearchX class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm mb-1">{{ t("search.noResults") }}</div>
        <div class="text-xs opacity-70">{{ t("search.noResultsHint") }}</div>
        <div v-if="isCacheRecovered" class="text-xs opacity-70 mt-2">
          {{ t("search.cachedResults", { time: cachedAtText }) }}
        </div>
      </div>
    </div>
    <!-- 各 tab 内容 -->
    <div v-else class="flex-1 min-h-0 flex flex-col">
      <!-- 缓存恢复横幅 -->
      <div
        v-if="isCacheRecovered"
        class="shrink-0 mx-5 mt-2 mb-1 px-4 py-2 flex items-center gap-2 rounded-full bg-on-surface/[0.06] text-xs text-on-surface-variant/80"
      >
        <IconLucideHistory class="size-3.5 shrink-0 opacity-70" />
        <span class="truncate">{{ t("search.cachedResults", { time: cachedAtText }) }}</span>
      </div>
      <div class="flex-1 min-h-0">
        <SongList
          v-if="activeTab === 'songs'"
          :items="states.songs.items"
          :source="pluginSelection ? 'plugin' : status.searchPlatform"
          :playback-context="playbackContext"
          show-local-badge
          :show-size="false"
          :has-more="states.songs.hasMore"
          :loading-more="states.songs.loadingMore"
          @reach-bottom="onReachBottom('songs')"
        />
        <CoverList
          v-else-if="activeTab === 'albums'"
          :items="states.albums.items"
          :padding-x="20"
          :padding-top="8"
          :padding-bottom="20"
          :has-more="states.albums.hasMore"
          :loading-more="states.albums.loadingMore"
          @click="
            (item) =>
              navigateToAlbum(item.title, { source: status.searchPlatform, albumId: item.id })
          "
          @reach-bottom="onReachBottom('albums')"
        />
        <CoverList
          v-else-if="activeTab === 'artists'"
          :items="states.artists.items"
          type="artist"
          :min-size="120"
          :padding-x="20"
          :padding-top="8"
          :padding-bottom="20"
          :has-more="states.artists.hasMore"
          :loading-more="states.artists.loadingMore"
          @click="
            (item) =>
              status.searchPlatform === 'migu'
                ? undefined
                : navigateToArtist(item.title, { source: status.searchPlatform, artistId: item.id })
          "
          @reach-bottom="onReachBottom('artists')"
        />
        <CoverList
          v-else
          :items="states.playlists.items"
          :padding-x="20"
          :padding-top="8"
          :padding-bottom="20"
          :has-more="states.playlists.hasMore"
          :loading-more="states.playlists.loadingMore"
          @click="
            (item) =>
              navigateToPlaylist(item.id, { source: status.searchPlatform, name: item.title })
          "
          @reach-bottom="onReachBottom('playlists')"
        />
      </div>
      <!-- 追加页失败的内联提示：保留已有结果，仅提示失败并支持重试追加 -->
      <div
        v-if="hasInlineError"
        class="shrink-0 mx-5 mb-3 px-4 py-2 flex items-center gap-3 rounded-lg bg-red-500/10 text-red-500/90"
      >
        <IconLucideTriangleAlert class="size-4 shrink-0 opacity-80" />
        <div class="flex-1 min-w-0 text-xs">
          <span>{{ friendlyErrorText }}</span>
          <details v-if="activeError" class="inline-block ml-2 opacity-70">
            <summary class="cursor-pointer outline-none inline">
              {{ t("search.errorDetails") }}
            </summary>
            <span class="ml-1 break-all">{{ activeError }}</span>
          </details>
        </div>
        <SButton
          variant="secondary"
          size="small"
          :loading="states[activeTab].loadingMore"
          @click="onRetry"
        >
          <template #icon>
            <IconLucideRotateCw class="size-3.5" />
          </template>
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
