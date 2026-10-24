<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";

const theme = useThemeStore();

const visible = computed(() => theme.effectiveStyle === "image" && !!theme.imageBackground.src);

const imageStyle = computed<Record<string, string>>(() => ({
  objectFit: "cover",
  filter: theme.imageBackground.blur > 0 ? `blur(${theme.imageBackground.blur}px)` : "none",
  transform: `scale(${theme.imageBackground.scale})`,
}));

/**
 * 压暗层颜色：暗色主题压黑、亮色主题提白
 *
 * 亮色主题的正文色是深色，若仍用黑色遮罩会让深色文字落在深色背景上（实测对比度仅 1.15:1，
 * 标题几乎不可见）。亮色下至少 0.66 不透明度，保证深色文字在任意背景图上可读。
 */
const overlayStyle = computed<{ opacity: number }>(() => ({
  opacity: theme.isDark ? theme.imageBackground.dim : Math.max(theme.imageBackground.dim, 0.66),
}));
</script>

<template>
  <div v-if="visible" class="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
    <img
      :src="theme.imageBackground.src"
      class="w-full h-full select-none"
      :style="imageStyle"
      draggable="false"
      alt=""
    />
    <div
      class="absolute inset-0 transition-[opacity,background-color]"
      :class="theme.isDark ? 'bg-black' : 'bg-white'"
      :style="overlayStyle"
    />
  </div>
</template>
