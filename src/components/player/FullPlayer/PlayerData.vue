<script setup lang="ts">
import type { Artist, AudioQuality } from "@shared/types/player";
import type { QualityProvenance } from "@shared/types/quality";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import QualityTag from "@/components/ui/QualityTag.vue";
import QualityStatusIndicator from "@/components/player/QualityStatusIndicator.vue";
import {
  canNavigateToResource,
  navigateToResource,
  type ResourceNavigationTarget,
} from "@/utils/navigate";
import { getValidArtists } from "@shared/utils/track";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    /** 对齐方式 */
    align?: "center" | "left" | "right";
    /** 简单模式 */
    simple?: boolean;
  }>(),
  {
    align: "center",
    simple: false,
  },
);

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();

/** 加载中的歌曲 */
const displayTrack = computed(() => media.track ?? status.currentTrack);
const artists = computed(() => getValidArtists(displayTrack.value?.artists));

/** 歌词来源偏好下拉选项 */
const lyricSourceOptions = computed<SSelectOption[]>(() => [
  { value: "auto", label: t("settings.lyricSourcePreference.auto") },
  { value: "qqmusic", label: t("settings.lyricSourcePreference.qqmusic") },
  { value: "kugou", label: t("settings.lyricSourcePreference.kugou") },
  { value: "netease", label: t("settings.lyricSourcePreference.netease") },
  { value: "self", label: t("settings.lyricSourcePreference.self") },
]);

/**
 * 生成歌手详情页跳转目标
 * @param artist - 当前歌曲的歌手
 * @returns 携带服务器身份的详情页目标
 */
const artistTarget = (artist: Artist): ResourceNavigationTarget => ({
  type: "artist",
  source: displayTrack.value?.source,
  serverId: displayTrack.value?.serverId,
  id: artist.id,
  name: artist.name,
});

/**
 * 判断歌手是否具有可跳转的详情页
 * @param artist - 当前歌曲的歌手
 * @returns 是否支持跳转
 */
const isArtistLinkable = (artist: Artist): boolean => canNavigateToResource(artistTarget(artist));

/** 当前专辑详情页跳转目标 */
const albumTarget = computed<ResourceNavigationTarget | null>(() => {
  const track = displayTrack.value;
  if (!track?.album?.name) return null;
  return {
    type: "album",
    source: track.source,
    serverId: track.serverId,
    id: track.album.id,
    name: track.album.name,
  };
});

/** 专辑是否可跳转 */
const isAlbumLinkable = computed(() =>
  albumTarget.value ? canNavigateToResource(albumTarget.value) : false,
);

/**
 * 跳转详情页并收起全屏播放器
 * @param target - 详情页目标
 */
const goToResource = (target: ResourceNavigationTarget | null): void => {
  if (target && navigateToResource(target)) status.isPlayerExpanded = false;
};

/** 来源标签 */
const sourceLabel = computed(() => {
  if (displayTrack.value?.cloud) return "CLOUD";
  const source = displayTrack.value?.source;
  if (!source) return "LOCAL";
  if (source === "local") return "LOCAL";
  if (source === "streaming") return "STREAMING";
  return source.toUpperCase();
});

/** 行内音质徽标数据 */
interface PlayQuality {
  quality: AudioQuality;
  provenance?: QualityProvenance;
  measured: boolean;
}

/** 实际播放音质：详情与当前曲目一体采用，避免换曲瞬间混入旧详情；无详情时回落曲目目录数据 */
const playQuality = computed<PlayQuality | null>(() => {
  const detail = media.detail;
  const track = media.track;
  if (track && detail) {
    return { quality: detail.quality, provenance: detail.qualityProvenance, measured: true };
  }
  const fallback = displayTrack.value;
  if (!fallback?.quality) return null;
  return {
    quality: fallback.quality,
    provenance: fallback.qualityProvenance,
    measured: fallback.source === "local",
  };
});

/** 歌词格式标签 */
const lyricLabel = computed(() => media.activeLyric?.format.toUpperCase() ?? "NO-LRC");

/** 专辑文本 */
const albumText = computed(() => displayTrack.value?.album?.name ?? "");

/** 当前实际加载歌曲的播放来源 */
const playbackSource = computed(() => media.playbackContext);
const playbackSourceTarget = computed<ResourceNavigationTarget | null>(() => {
  const context = playbackSource.value;
  const name = context?.originName?.trim();
  if (!context || !name || context.originType === "track") return null;
  if (context.originType === "page") {
    return { type: "page", id: context.originId, name };
  }
  if (!context.provider) return null;
  return {
    type: context.originType,
    source: context.provider,
    serverId: displayTrack.value?.serverId,
    id: context.originId,
    name,
  };
});
const playbackSourceText = computed(() => playbackSourceTarget.value?.name ?? "");
const isPlaybackSourceLinkable = computed(() =>
  playbackSourceTarget.value ? canNavigateToResource(playbackSourceTarget.value) : false,
);

const alignItems = computed(() => {
  if (props.align === "left") return "items-start";
  if (props.align === "right") return "items-end";
  return "items-center";
});
</script>

<template>
  <div
    v-if="displayTrack"
    class="w-full flex flex-col gap-[0.5em] overflow-hidden px-2"
    style="font-size: clamp(12px, calc(14 / 1080 * 100vh), 16px)"
    :class="alignItems"
  >
    <!-- 标题 -->
    <SMarquee fit class="max-w-full text-[2em] font-semibold leading-tight">
      {{ displayTrack.title }}
    </SMarquee>
    <!-- 副标题/注释 -->
    <div
      v-if="!simple && displayTrack.comment"
      class="max-w-full text-[1.4em] text-cover/40 truncate"
    >
      {{ displayTrack.comment }}
    </div>
    <!-- 元信息标签行 -->
    <div class="flex items-center gap-1.5 text-[1em] my-1 text-cover/60">
      <span
        class="inline-flex h-[22px] items-center justify-center rounded-md border border-solid border-cover/30 px-1.5 text-[1em] leading-none"
      >
        {{ sourceLabel }}
      </span>
      <span
        class="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-md border border-solid border-cover/30 px-1.5 text-[1em] leading-none transition-colors hover:border-cover/60"
        @click="status.audioInfoOpen = true"
      >
        <QualityTag
          v-if="playQuality"
          :quality="playQuality.quality"
          :provenance="playQuality.provenance"
          :measured="playQuality.measured"
          cover
        />
        <span v-else>—</span>
        <QualityStatusIndicator :status="media.detail?.playbackQuality" />
      </span>
      <SPopselect
        v-model="settings.lyric.lyricSourcePreference"
        :options="lyricSourceOptions"
        side="top"
        :side-offset="8"
        cover
      >
        <template #trigger>
          <span
            class="inline-flex h-[22px] cursor-pointer items-center justify-center rounded-md border border-solid border-cover/30 px-1.5 text-[1em] leading-none transition-colors hover:border-cover/60"
          >
            {{ lyricLabel }}
          </span>
        </template>
      </SPopselect>
    </div>
    <!-- 歌手 -->
    <div class="max-w-full flex items-center gap-1.5 text-[1.2em] text-cover/60">
      <IconLucideMic class="shrink-0 translate-y-px text-cover/40" />
      <span class="truncate">
        <template v-if="artists.length">
          <template v-for="(artist, index) in artists" :key="artist.id ?? index">
            <span
              :class="
                isArtistLinkable(artist) ? 'cursor-pointer transition-colors hover:text-cover' : ''
              "
              @click="goToResource(artistTarget(artist))"
            >
              {{ artist.name }}
            </span>
            <span v-if="index < artists.length - 1" class="mx-0.5 opacity-50">/</span>
          </template>
        </template>
        <span v-else class="opacity-50">{{ t("playlist.unknownArtist") }}</span>
      </span>
    </div>
    <!-- 专辑 -->
    <div v-if="albumText" class="max-w-full flex items-center gap-1.5 text-[1.2em] text-cover/60">
      <IconLucideDisc3 class="shrink-0 translate-y-px text-cover/40" />
      <span
        class="truncate"
        :class="isAlbumLinkable ? 'cursor-pointer transition-colors hover:text-cover' : ''"
        @click="goToResource(albumTarget)"
      >
        {{ albumText }}
      </span>
    </div>
    <!-- 播放来源 -->
    <div
      v-if="!simple && settings.player.showPlaybackSource && playbackSourceText"
      class="max-w-full flex items-center gap-1.5 text-[1.2em] text-cover/60"
    >
      <IconLucideLink2 class="shrink-0 translate-y-px text-cover/40" />
      <span
        class="truncate"
        :class="isPlaybackSourceLinkable ? 'cursor-pointer transition-colors hover:text-cover' : ''"
        @click="goToResource(playbackSourceTarget)"
      >
        {{ playbackSourceText }}
      </span>
    </div>
  </div>
</template>
