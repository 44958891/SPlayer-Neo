<script setup lang="ts">
import type { PlaybackQualityStatus } from "@shared/types/playbackQuality";
import { playbackStatusText } from "@/utils/qualityBadge";
import STooltip from "@/components/ui/STooltip.vue";
import IconLucideTriangleAlert from "~icons/lucide/triangle-alert";

const props = defineProps<{
  /** 主进程回传的请求与实际对照；缺失或 met 时不渲染 */
  status?: PlaybackQualityStatus;
}>();

/** 对照文案；below / unconfirmed 才产生警示提示 */
const text = computed(() => playbackStatusText(props.status));
</script>

<template>
  <STooltip v-if="text?.tooltip" :content="text.tooltip" :side-offset="8">
    <span class="inline-flex shrink-0 cursor-help items-center text-amber-500 dark:text-amber-400">
      <IconLucideTriangleAlert class="size-3.5" />
    </span>
  </STooltip>
</template>
