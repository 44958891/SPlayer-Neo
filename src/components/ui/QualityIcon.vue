<script setup lang="ts">
import type { QualityFamily } from "@shared/types/quality";
import { qualityArtworkForFamily } from "@/utils/qualityArtwork";
import "@/styles/quality.css";

const props = withDefaults(defineProps<{ family: QualityFamily; cover?: boolean }>(), {
  cover: false,
});

const artwork = computed(() => qualityArtworkForFamily(props.family));
</script>

<template>
  <svg
    class="quality-emblem quality-tone"
    :class="[`quality-tone--${family}`, { 'quality-tone--cover': cover }]"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(path, index) in artwork.paths" :key="index" :d="path" />
  </svg>
</template>

<style scoped>
.quality-emblem {
  display: block;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
}
</style>
