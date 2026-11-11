<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useWindowControls } from "@/composables/useWindowControls";
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";
import { useUpdateStore } from "@/stores/update";
import { createLiquidReveal } from "@/composables/useLiquidTheme";
import { LiquidSynth } from "@/utils/liquid/sound";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import IconSun from "~icons/lucide/sun";
import IconMoon from "~icons/lucide/moon";
import IconMonitor from "~icons/lucide/monitor";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconTerminal from "~icons/lucide/terminal";
import IconSettings from "~icons/lucide/settings";
import IconScaling from "~icons/lucide/scaling";

const router = useRouter();
const { t } = useI18n();
const { show: showSettings } = useSettingsDialog();
const theme = useThemeStore();
const settings = useSettingsStore();
const update = useUpdateStore();
const { isBorderless } = useWindowControls();

/** 液体揭示 + 音效（懒建） */
const liquid = createLiquidReveal();
const synth = shallowRef<LiquidSynth | null>(null);
const getSynth = (): LiquidSynth => {
  if (!synth.value) {
    synth.value = new LiquidSynth({
      enabled: settings.appearance.liquidThemeSound,
      volume: settings.appearance.liquidThemeVolume,
    });
  }
  return synth.value;
};
// 设置变化时同步进 synth
watch(
  () => [settings.appearance.liquidThemeSound, settings.appearance.liquidThemeVolume],
  () => {
    synth.value?.update({
      enabled: settings.appearance.liquidThemeSound,
      volume: settings.appearance.liquidThemeVolume,
    });
  },
);

/** 界面缩放弹窗开关 */
const uiZoomOpen = ref(false);

const themeIcon = computed(() => {
  if (theme.mode === "light") return IconMoon;
  if (theme.mode === "dark") return IconMonitor;
  return IconSun;
});

const themeLabel = computed(() => {
  if (theme.mode === "light") return t("settings.themeMode.dark");
  if (theme.mode === "dark") return t("settings.themeMode.system");
  return t("settings.themeMode.light");
});

const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "theme",
    label: themeLabel.value,
    icon: themeIcon.value,
  },
  { key: "uiZoom", label: t("uiZoom.title"), icon: IconScaling },
  { key: "reload", label: t("nav.reload"), icon: IconRefreshCw, separator: true },
  { key: "devtools", label: t("nav.devtools"), icon: IconTerminal },
  { key: "settings", label: t("nav.globalSettings"), icon: IconSettings },
]);

const onMenuSelect = (key: string): void => {
  if (key === "theme") toggleThemeLiquid();
  else if (key === "reload") location.reload();
  else if (key === "devtools") window.api.system.toggleDevTools();
  else if (key === "uiZoom") uiZoomOpen.value = true;
  else if (key === "settings") showSettings();
};

/** 主题切换：优先液体揭示，不支持/动画关闭时直接切 */
const toggleThemeLiquid = (): void => {
  const next = theme.isDark ? "light" : "dark";
  const wantAnim =
    settings.appearance.liquidThemeReveal &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 用主题触发按钮作为液柱起点（模板里打了 data-theme-trigger）
  const originEl = document.querySelector<HTMLElement>("[data-theme-trigger]");

  if (wantAnim) {
    if (settings.appearance.liquidThemeSound) void getSynth().unlock();
    const ok = liquid.start({
      origin: originEl ?? { x: window.innerWidth - 60, y: 56 },
      to: next,
      duration: 1900,
      sound: settings.appearance.liquidThemeSound ? getSynth() : null,
      onThemeApplied: () => theme.cycleMode(),
    });
    if (ok) return;
  }
  theme.cycleMode();
};
</script>

<template>
  <div class="flex items-center justify-between flex-1 h-full min-w-0 app-drag-region">
    <!-- 左侧 -->
    <div class="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
      <SButton
        class="app-no-drag shrink-0"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        @click="router.back()"
      >
        <template #icon><IconLucideChevronLeft /></template>
      </SButton>
      <SButton
        class="app-no-drag shrink-0"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        @click="router.forward()"
      >
        <template #icon><IconLucideChevronRight /></template>
      </SButton>
      <NavSearch />
      <SButton
        v-if="update.hasUpdate"
        class="app-no-drag shrink-0"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        :title="t('update.dialogTitle')"
        @click="update.openDialog()"
      >
        <template #icon><IconLucideCircleArrowUp /></template>
      </SButton>
    </div>
    <!-- 中间 -->
    <div class="flex-1 h-full min-w-4" />
    <!-- 右侧 -->
    <div class="flex items-center gap-2 sm:gap-3 shrink-0">
      <NavUser />
      <SDropdownMenu :items="menuItems" @select="onMenuSelect">
        <template #trigger>
          <SButton
            class="app-no-drag shrink-0"
            variant="tertiary"
            circle
            :size="40"
            data-theme-trigger
          >
            <template #icon><IconLucideSettings /></template>
          </SButton>
        </template>
      </SDropdownMenu>
      <SDivider v-if="isBorderless" vertical />
      <WindowControls />
    </div>
    <UiZoomDialog v-model:open="uiZoomOpen" />
  </div>
</template>
