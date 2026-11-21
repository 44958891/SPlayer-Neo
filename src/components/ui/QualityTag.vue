<script setup lang="ts">
import type { AudioQuality } from "@shared/types/player";
import type { QualityLevel, QualityProvenance } from "@shared/types/quality";
import { QUALITY_LABELS } from "@/utils/quality";
import { qualityBadgeText, qualityLevelLabel, resolveQualityBadgeView } from "@/utils/qualityBadge";
import { qualityArtworkFor } from "@/utils/qualityArtwork";
import QualityIcon from "./QualityIcon.vue";
import "@/styles/quality.css";

const props = withDefaults(
  defineProps<{
    /** 通用档位（未提供实际 quality 时按请求目标渲染） */
    level?: QualityLevel;
    /** 实际音质参数（实测或目录声明） */
    quality?: AudioQuality;
    /** 档位来源证据 */
    provenance?: QualityProvenance;
    /** 参数是否来自实际解码 */
    measured?: boolean;
    /** 封面背景下沿用类别色并适配文字对比度 */
    cover?: boolean;
  }>(),
  { measured: false, cover: false },
);

/** 编码未知时保留占位，不能由缺失参数伪造标准档 */
const view = computed(() => {
  if (props.quality) {
    if (!props.quality.codec || props.quality.codec === "unknown") return null;
    const badge = resolveQualityBadgeView(props.quality, props.provenance, props.measured);
    return { ...badge, ...qualityBadgeText(badge, props.quality) };
  }
  if (!props.level) return null;
  return {
    level: props.level,
    mismatch: false,
    label: QUALITY_LABELS[props.level],
    tooltip: qualityLevelLabel(props.level),
  };
});

const artwork = computed(() => (view.value ? qualityArtworkFor(view.value) : null));
</script>

<template>
  <span
    v-if="view && artwork"
    class="quality-tag quality-tone"
    :class="[
      `quality-tone--${artwork.family}`,
      { 'quality-tone--cover': cover, 'quality-tone--warning': view.mismatch },
    ]"
    :title="view.tooltip"
  >
    <QualityIcon :family="artwork.family" class="quality-tag-icon" />
    <span class="quality-name">{{ view.label }}</span>
  </span>
  <span v-else class="quality-placeholder">—</span>
</template>

<style scoped>
.quality-tag {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 16px;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  vertical-align: middle;
  user-select: none;
}

.quality-tag .quality-tag-icon {
  color: inherit;
}

.quality-name {
  display: block;
  letter-spacing: 0;
}

.quality-placeholder {
  color: rgb(var(--s-on-surface-variant) / 0.5);
  font-size: 11px;
  line-height: 16px;
}
</style>
