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

/** 当前模式对应的图标（二态：浅色显示太阳、深色显示月亮） */
const themeIcon = computed(() => (theme.isDark ? IconMoon : IconSun));

/** 独立主题按钮的提示：显示点击后切到的模式 */
const themeLabel = computed(() =>
  theme.isDark ? t("settings.themeMode.light") : t("settings.themeMode.dark"),
);

const menuItems = computed<DropdownMenuItem[]>(() => [
  { key: "uiZoom", label: t("uiZoom.title"), icon: IconScaling },
  { key: "reload", label: t("nav.reload"), icon: IconRefreshCw, separator: true },
  { key: "devtools", label: t("nav.devtools"), icon: IconTerminal },
  { key: "settings", label: t("nav.globalSettings"), icon: IconSettings },
]);

const onMenuSelect = (key: string): void => {
  if (key === "reload") location.reload();
  else if (key === "devtools") window.api.system.toggleDevTools();
  else if (key === "uiZoom") uiZoomOpen.value = true;
  else if (key === "settings") showSettings();
};

/** 主题切换：优先液体揭示，不支持/动画关闭时直接切 */
const toggleThemeLiquid = (e?: MouseEvent): void => {
  const next = theme.isDark ? "light" : "dark";
  const wantAnim =
    settings.appearance.liquidThemeReveal &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 液柱从触发按钮下缘流出：优先取事件源，兜底查 data-theme-trigger
  const originEl =
    (e?.currentTarget as HTMLElement | null) ??
    document.querySelector<HTMLElement>("[data-theme-trigger]");

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
      <!-- 主题切换：独立圆钮，放在头像左侧；液体动画从这颗按钮下缘流出 -->
      <SButton
        class="app-no-drag shrink-0"
        variant="tertiary"
        circle
        :size="40"
        :title="themeLabel"
        data-theme-trigger
        @click="toggleThemeLiquid"
      >
        <template #icon><component :is="themeIcon" /></template>
      </SButton>
      <NavUser />
      <SDropdownMenu :items="menuItems" @select="onMenuSelect">
        <template #trigger>
          <SButton class="app-no-drag shrink-0" variant="tertiary" circle :size="40">
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
