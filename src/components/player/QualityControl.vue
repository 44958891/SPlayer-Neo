<script setup lang="ts">
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { PlatformQualityOption } from "@shared/types/quality";
import type { AudioQuality } from "@shared/types/player";
import type { QualityProvenance } from "@shared/types/quality";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import QualityIcon from "@/components/ui/QualityIcon.vue";
import QualityTag from "@/components/ui/QualityTag.vue";
import QualityStatusIndicator from "@/components/player/QualityStatusIndicator.vue";
import { qualitySelectionLabel } from "@/utils/qualityBadge";
import * as player from "@/core/player";
import { toast } from "@/composables/useToast";
import {
  PLATFORM_QUALITY_OPTIONS,
  canPlayQualityOption,
  collectQualityCapabilities,
  findPlatformQuality,
  platformOf,
  resolvePlatformQuality,
} from "@/utils/platformQuality";
import { isPlatform } from "@shared/types/platform";

const props = withDefaults(defineProps<{ cover?: boolean }>(), { cover: false });

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();

/** 是否支持切换在线音质 */
const canSwitchQuality = computed(() => isPlatform(media.track?.source) && !media.track?.cloud);

/** 实际播放音质：详情与当前曲目一体采用，避免换曲瞬间混入旧详情；详情加载前回落歌曲目录数据 */
const playQuality = computed<{
  quality: AudioQuality;
  provenance?: QualityProvenance;
  measured: boolean;
} | null>(() => {
  const detail = media.detail;
  const track = media.track;
  if (track && detail) {
    return { quality: detail.quality, provenance: detail.qualityProvenance, measured: true };
  }
  if (!track?.quality) return null;
  return {
    quality: track.quality,
    provenance: track.qualityProvenance,
    measured: track.source === "local",
  };
});

/** 当前歌曲平台 */
const platform = computed(() => platformOf(media.track));

/** 当前平台的音源插件档位声明 */
const capabilities = computed(() =>
  platform.value
    ? collectQualityCapabilities(platform.value)
    : { hasPlugin: false, hasUndeclaredPlugin: false, declared: false },
);

/** 当前生效的选择（旧通用偏好映射到本平台具体档位） */
const currentSelection = computed(() => {
  const current = platform.value;
  if (!current) return "";
  return (
    resolvePlatformQuality(current, settings.player.songLevel, settings.player.songQualitySelection)
      ?.id ?? ""
  );
});

/** 本次播放的请求与实际对照；详情未加载时为空，不产生警示 */
const playbackStatus = computed(() => media.detail?.playbackQuality);

/** 本次请求目标的名称：优先取实际下发请求，详情缺失时回落当前菜单选择 */
const requestedLabel = computed(() =>
  qualitySelectionLabel(playbackStatus.value?.selection ?? currentSelection.value, platform.value),
);

/** 平台自己的菜单项：官方档位直接可用，插件专属档位按声明禁用并附原因 */
const qualityOptions = computed<SSelectOption[]>(() => {
  const current = platform.value;
  if (!current) return [];
  return PLATFORM_QUALITY_OPTIONS[current].map((option: PlatformQualityOption) => {
    const enabled = canPlayQualityOption(option, capabilities.value);
    const reason = !capabilities.value.hasPlugin
      ? t("quality.selection.pluginRequired")
      : t("quality.selection.unavailable");
    return {
      value: option.id,
      label: enabled ? t(option.labelKey) : `${t(option.labelKey)} · ${reason}`,
      disabled: !enabled,
      icon: () => h(QualityIcon, { family: option.family, cover: props.cover }),
    };
  });
});

const chipBase =
  "inline-flex min-w-9 shrink-0 items-center justify-center px-2 py-1 leading-none rounded-md border border-solid text-xs";

/** 切换音质：同时记录通用档位与平台具体选择，并跳过下载/缓存重载 */
const onQualityChange = (value: string | number | boolean): void => {
  const current = platform.value;
  const option = current ? findPlatformQuality(String(value), current) : undefined;
  if (!option) return;
  if (!canPlayQualityOption(option, capabilities.value)) {
    toast.warning(t("quality.selection.unsupported"));
    return;
  }
  settings.player.songLevel = option.level;
  settings.player.songQualitySelection = option.id;
  void player.reloadCurrentTrack(undefined, true);
};
</script>

<template>
  <SPopselect
    v-if="canSwitchQuality && media.track"
    :model-value="currentSelection"
    :options="qualityOptions"
    side="top"
    :side-offset="8"
    :cover="cover"
    @update:model-value="onQualityChange"
  >
    <template #header>
      <div
        :class="[
          'w-0 min-w-full px-2.5 pt-2 pb-1.5 text-xs leading-snug border-b border-b-solid',
          cover
            ? 'text-cover/55 border-b-white/10'
            : 'text-on-surface-variant/70 border-b-on-surface/8',
        ]"
      >
        <div class="mb-0.5 text-sm font-medium" :class="cover ? 'text-cover' : 'text-on-surface'">
          {{ t("settings.songLevel.switchTitle") }}
        </div>
        <div class="mb-0.5 flex items-center gap-1.5">
          <span class="shrink-0">{{ t("quality.playback.actual") }}</span>
          <QualityTag
            v-if="playQuality"
            :quality="playQuality.quality"
            :provenance="playQuality.provenance"
            :measured="playQuality.measured"
            :cover="cover"
          />
          <span v-else>—</span>
          <QualityStatusIndicator :status="playbackStatus" />
        </div>
        <div class="mb-0.5">
          {{ t("quality.playback.requested") }}
          ·
          {{ requestedLabel || t("quality.playback.targetUnavailable") }}
        </div>
        {{ t("quality.selection.switchHint") }}
      </div>
    </template>
    <template #trigger>
      <span
        :class="[
          chipBase,
          'cursor-pointer transition-colors',
          cover
            ? 'border-cover/30 hover:border-cover/60'
            : 'border-on-surface-variant/30 hover:border-on-surface-variant/60',
        ]"
      >
        <QualityTag
          v-if="playQuality"
          :quality="playQuality.quality"
          :provenance="playQuality.provenance"
          :measured="playQuality.measured"
          :cover="cover"
        />
        <span v-else>—</span>
      </span>
    </template>
  </SPopselect>
  <STooltip
    v-else-if="media.track"
    :content="t('settings.songLevel.unsupportedHint')"
    :side-offset="16"
    side="top"
  >
    <span :class="[chipBase, cover ? 'border-cover/25' : 'border-on-surface-variant/25']">
      <QualityTag
        v-if="playQuality"
        :quality="playQuality.quality"
        :provenance="playQuality.provenance"
        :measured="playQuality.measured"
      />
      <span v-else>—</span>
    </span>
  </STooltip>
</template>
