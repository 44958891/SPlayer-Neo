<script setup lang="ts">
import type { QualityLevel } from "@/utils/quality";
import { QUALITY_LABELS, isLosslessLevel } from "@/utils/quality";
import standardIcon from "@/assets/quality/standard.svg?raw";
import hqIcon from "@/assets/quality/hq.svg?raw";
import sqIcon from "@/assets/quality/sq.svg?raw";
import hiresIcon from "@/assets/quality/hires.svg?raw";
import spatialIcon from "@/assets/quality/spatial.svg?raw";
import vividIcon from "@/assets/quality/vivid.svg?raw";
import IconLucideDisc3 from "~icons/lucide/disc-3";

const props = withDefaults(defineProps<{ level: QualityLevel }>(), {});

/** 网易云客户端官方音质字形（已转 currentColor，随档位配色） */
const GLYPHS: Partial<Record<QualityLevel, string>> = {
  lq: standardIcon,
  sq: standardIcon,
  hq: hqIcon,
  lossless: sqIcon,
  "hi-res": hiresIcon,
  sky: spatialIcon,
  jyeffect: vividIcon,
};

const isMaster = computed(() => props.level === "jymaster");
const label = computed(() => QUALITY_LABELS[props.level]);
const glyph = computed(() => GLYPHS[props.level]);
/** 母带用官方亮金（无官方字形，以黑胶唱片区分），无损家族官方金，基础档随中性色 */
const colorClass = computed(() => {
  if (isMaster.value) return "text-[#D19A2F] dark:text-[#EBB52A]";
  return isLosslessLevel(props.level)
    ? "text-[#C17F73] dark:text-[#D89C8E]"
    : "text-on-surface-variant/70";
});
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold leading-none"
    :class="colorClass"
    :title="label"
  >
    <span v-if="glyph" class="inline-block size-3 [&>svg]:size-full" v-html="glyph" />
    <IconLucideDisc3 v-else class="size-3" />
    {{ label }}
  </span>
</template>
