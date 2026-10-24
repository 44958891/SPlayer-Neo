<script setup lang="ts">
/**
 * 手动换源弹窗：按「标题 + 歌手」在四个平台并行搜索同名曲，点选即换源播放
 *
 * 视觉对齐全局：SInput 搜索框 + 类 TagEditorDialog 候选行（封面 + 标题/歌手·专辑 +
 * 标签 + 平台简写 + 时长），四平台结果合并为一个列表。
 */
import type { Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME, isPlatform } from "@shared/types/platform";
import { searchSongs } from "@/apis/search";
import * as player from "@/core/player";
import { useMediaStore } from "@/stores/media";
import { toast } from "@/composables/useToast";
import { formatTime } from "@/utils/time";
import IconLucideSearch from "~icons/lucide/search";
import SDialog from "@/components/ui/SDialog.vue";
import SInput from "@/components/ui/SInput.vue";
import SButton from "@/components/ui/SButton.vue";
import SImg from "@/components/ui/SImg.vue";
import STag from "@/components/ui/STag.vue";
import SLoading from "@/components/ui/SLoading.vue";

const props = defineProps<{ open: boolean; track: Track | null }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const mediaStore = useMediaStore();

/** 每平台取几条 */
const PER_PLATFORM = 6;

const keyword = ref("");
const searching = ref(false);
const items = ref<Track[]>([]);
let searchToken = 0;

const buildQuery = (track: Track): string => {
  const artist = track.artists
    .map((a) => a.name)
    .filter(Boolean)
    .join("/");
  return artist ? `${track.title} ${artist}` : track.title;
};

/** 四平台并行搜索后按平台顺序合并 */
const searchAll = async (): Promise<void> => {
  const token = ++searchToken;
  const query = keyword.value.trim();
  if (!query) return;
  searching.value = true;
  const settled = await Promise.allSettled(
    ALL_PLATFORMS.map(async (platform) => {
      const result = await searchSongs(platform, query, 0, PER_PLATFORM);
      return result.items;
    }),
  );
  if (token !== searchToken) return;
  const merged: Track[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") merged.push(...outcome.value);
  }
  items.value = merged;
  searching.value = false;
};

watch(
  () => props.open,
  (open) => {
    if (!open || !props.track) return;
    keyword.value = buildQuery(props.track);
    items.value = [];
    void searchAll();
  },
);

const keyOf = (item: Track): string => `${item.source}:${item.id}`;

const isOriginal = (item: Track): boolean => Boolean(props.track) && item.id === props.track?.id;

const isCurrentPlaying = (item: Track): boolean => {
  const playing = mediaStore.track;
  return playing ? keyOf(playing) === keyOf(item) : false;
};

/** 平台简写：仅已知平台显示 */
const platformShort = (item: Track): string =>
  isPlatform(item.source) ? PLATFORM_SHORT_NAME[item.source] : "";

const play = (item: Track): void => {
  void player.playNow(item);
  toast.success(t("playlist.switchSource.toast"));
  emit("update:open", false);
};

const reSearch = (): void => {
  if (searching.value) return;
  void searchAll();
};

const close = (): void => {
  emit("update:open", false);
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('playlist.switchSource.title')"
    width="560px"
    @update:open="(value) => emit('update:open', value)"
  >
    <div class="flex flex-col gap-3 pb-1">
      <div class="flex items-center gap-2">
        <SInput
          v-model="keyword"
          :placeholder="t('playlist.switchSource.placeholder')"
          :disabled="searching"
          clearable
          class="flex-1"
          @keydown.enter="reSearch"
        >
          <template #prefix>
            <IconLucideSearch class="size-4 shrink-0 text-on-surface-variant/50" />
          </template>
        </SInput>
        <SButton variant="secondary" :disabled="searching" @click="reSearch">
          {{ t("common.search") }}
        </SButton>
      </div>

      <div class="h-80 overflow-y-auto flex flex-col gap-0.5 -mx-1 px-1">
        <div v-if="searching && items.length === 0" class="h-full flex items-center justify-center">
          <SLoading class="size-5 text-primary/70" />
        </div>
        <div
          v-else-if="items.length === 0"
          class="h-full flex items-center justify-center text-sm text-on-surface-variant/50"
        >
          {{ t("playlist.switchSource.noResult") }}
        </div>
        <template v-else>
          <div
            v-for="item in items"
            :key="keyOf(item)"
            role="button"
            tabindex="0"
            class="flex items-center gap-2.5 p-1.5 rounded-md cursor-pointer transition-colors hover:bg-on-surface/8"
            @click="play(item)"
            @keydown.enter="play(item)"
          >
            <SImg :src="item.cover" class="size-10 shrink-0 rounded-md overflow-hidden" />
            <div class="flex flex-col min-w-0 flex-1">
              <span class="text-sm truncate">{{ item.title }}</span>
              <span class="text-xs text-on-surface-variant/70 truncate">
                {{ item.artists.map((artist) => artist.name).join(" / ") }}
                <template v-if="item.album?.name">· {{ item.album.name }}</template>
              </span>
            </div>
            <STag
              v-if="isOriginal(item)"
              type="primary"
              variant="outline"
              size="tiny"
              class="shrink-0"
            >
              {{ t("playlist.switchSource.original") }}
            </STag>
            <STag
              v-else-if="isCurrentPlaying(item)"
              type="success"
              variant="soft"
              size="tiny"
              class="shrink-0"
            >
              {{ t("playlist.switchSource.playing") }}
            </STag>
            <span class="text-xs text-on-surface-variant/60 shrink-0 tabular-nums w-7 text-right">
              {{ platformShort(item) }}
            </span>
            <span class="text-xs text-on-surface-variant/70 tabular-nums shrink-0 w-9 text-right">
              {{ formatTime(item.duration) }}
            </span>
          </div>
        </template>
      </div>
    </div>
    <template #footer>
      <SButton variant="tertiary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
