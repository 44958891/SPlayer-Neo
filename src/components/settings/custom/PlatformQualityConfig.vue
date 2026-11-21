<script setup lang="ts">
import type { Platform } from "@shared/types/platform";
import { ALL_PLATFORMS, PLATFORM_NAME, isPlatform } from "@shared/types/platform";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import QualityIcon from "@/components/ui/QualityIcon.vue";
import {
  PLATFORM_QUALITY_OPTIONS,
  findPlatformQuality,
  resolvePlatformQuality,
} from "@/utils/platformQuality";

const props = defineProps<{ mode: "playback" | "download" }>();

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();

/**
 * 编辑面板查看的平台（仅切换目录文案用，不按平台分别保存）；
 * 优先正在播放歌曲的平台，缺省网易（目录最全）
 */
const viewingPlatform = ref<Platform>(
  isPlatform(media.track?.source) ? media.track.source : "netease",
);

/** 当前模式保存的默认目标映射到该平台的等价选项（单对：通用档位 + 具体选择） */
const currentOption = computed(() => {
  const platform = viewingPlatform.value;
  if (props.mode === "playback") {
    return resolvePlatformQuality(
      platform,
      settings.player.songLevel,
      settings.player.songQualitySelection,
    );
  }
  const download = settings.system.download;
  return resolvePlatformQuality(platform, download.quality, download.qualitySelection);
});

/** 该平台的只读目录选项；插件专属档位附提示（设置里不禁用，偏好允许离线先配置） */
const qualityOptions = computed(() =>
  PLATFORM_QUALITY_OPTIONS[viewingPlatform.value].map((option) => ({
    value: option.id,
    label: option.official
      ? t(option.labelKey)
      : `${t(option.labelKey)} · ${t("quality.selection.pluginRequired")}`,
    icon: () => h(QualityIcon, { family: option.family }),
  })),
);

const platformOptions = ALL_PLATFORMS.map((platform) => ({
  value: platform,
  label: PLATFORM_NAME[platform],
}));

/** 选择目录项：写回单对默认值（播放走本地 store，下载走 setSystem IPC，顺序写入） */
const onSelect = async (value: string | number | boolean): Promise<void> => {
  const option = findPlatformQuality(String(value), viewingPlatform.value);
  if (!option) return;
  if (props.mode === "playback") {
    settings.player.songLevel = option.level;
    settings.player.songQualitySelection = option.id;
    return;
  }
  await settings.setSystem("download.quality", option.level);
  await settings.setSystem("download.qualitySelection", option.id);
};
</script>

<template>
  <div class="flex flex-col gap-2 w-full">
    <div>
      <div class="mb-1 text-xs text-on-surface-variant/70">
        {{ t("quality.selection.platform") }}
      </div>
      <SSelect
        :model-value="viewingPlatform"
        :options="platformOptions"
        @update:model-value="viewingPlatform = String($event) as Platform"
      />
    </div>
    <div>
      <div class="mb-1 text-xs text-on-surface-variant/70">
        {{
          t(
            props.mode === "playback"
              ? "quality.selection.playbackDefault"
              : "quality.selection.downloadDefault",
          )
        }}
      </div>
      <SSelect
        :model-value="currentOption?.id ?? ''"
        :options="qualityOptions"
        :placeholder="t('quality.selection.unavailable')"
        @update:model-value="onSelect"
      />
    </div>
    <div class="text-xs leading-snug text-on-surface-variant/60">
      {{ t("quality.selection.defaultHint") }}
    </div>
  </div>
</template>
