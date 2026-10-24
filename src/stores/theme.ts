import type { ThemeMode, ThemeSource, AppearanceStyle, ImageBackgroundConfig } from "@/types/theme";
import {
  generatePalette,
  applyThemeToDOM,
  extractColorFromImageUrl,
  DEFAULT_PRIMARY,
  SOLID_PALETTE_LIGHT,
  SOLID_PALETTE_DARK,
} from "@/utils/color";

/** 主题模式循环顺序 */
const MODE_CYCLE: ThemeMode[] = ["light", "dark", "system"];

export const useThemeStore = defineStore(
  "theme",
  () => {
    /** 主题模式 */
    const mode = ref<ThemeMode>("system");
    /** 颜色来源 */
    const source = ref<ThemeSource>("default");
    /** 自定义主色 HEX */
    const customColor = ref(DEFAULT_PRIMARY);
    /** 全局着色 */
    const globalTint = ref(false);
    /** 封面取色 HEX */
    const coverColor = ref<string | null>(null);
    /** 外观风格 */
    const appearanceStyle = ref<AppearanceStyle>("solid");
    /** 图片背景配置 */
    const imageBackground = reactive<ImageBackgroundConfig>({
      src: "",
      blur: 0,
      dim: 0.4,
      scale: 1.2,
    });
    /** 从背景图提取的主色 */
    const imageBackgroundColor = ref<string | null>(null);

    /** 实际生效的风格 */
    const effectiveStyle = computed<AppearanceStyle>(() =>
      appearanceStyle.value === "image" && !imageBackground.src ? "solid" : appearanceStyle.value,
    );

    /** 系统暗色偏好 */
    const systemDark = usePreferredDark();

    /** 当前是否为暗色（图片背景不再强制暗色，主题模式始终生效） */
    const isDark = computed(() => {
      if (mode.value === "dark") return true;
      if (mode.value === "light") return false;
      return systemDark.value;
    });

    /** 当前使用的主色 HEX */
    const activeColor = computed(() => {
      if (source.value === "cover" && coverColor.value) return coverColor.value;
      if (source.value === "custom") return customColor.value;
      return DEFAULT_PRIMARY;
    });

    /** 实际生效的全局着色 */
    const effectiveGlobalTint = computed(() =>
      effectiveStyle.value === "image" ? true : globalTint.value,
    );
    /** 实际生效的封面颜色 */
    const trackedColorForCover = computed(() =>
      effectiveStyle.value === "image" ? imageBackgroundColor.value : coverColor.value,
    );
    /** 实际生效的主色 HEX */
    const effectiveColor = computed(() => {
      if (source.value === "cover" && trackedColorForCover.value) return trackedColorForCover.value;
      if (source.value === "custom") return customColor.value;
      return DEFAULT_PRIMARY;
    });

    /** 应用主题到 DOM */
    const apply = (): void => {
      const useSolid =
        source.value === "solid" || (source.value === "cover" && !trackedColorForCover.value);
      const palette = useSolid
        ? isDark.value
          ? SOLID_PALETTE_DARK
          : SOLID_PALETTE_LIGHT
        : generatePalette(effectiveColor.value, isDark.value, effectiveGlobalTint.value);
      applyThemeToDOM(palette, coverColor.value, isDark.value);
      document.documentElement.dataset.appearanceStyle = effectiveStyle.value;
    };

    /** 循环切换主题模式 */
    const cycleMode = (): void => {
      const idx = MODE_CYCLE.indexOf(mode.value);
      mode.value = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    };

    /** 设置自定义主色 HEX */
    const setCustomColor = (hex: string): void => {
      customColor.value = hex;
      source.value = "custom";
    };

    /** 设置颜色来源 */
    const setSource = (newSource: ThemeSource): void => {
      source.value = newSource;
    };

    /** 重新提取背景图主色 */
    const refreshImageColor = async (src: string): Promise<void> => {
      imageBackgroundColor.value = src ? await extractColorFromImageUrl(src) : null;
    };

    /** 背景图宽度上限：超过则降采样，避免巨图拖垮合成 */
    const MAX_BG_WIDTH = 3200;
    let downscalingBackground = false;

    /**
     * 背景图超大时降采样重存（如全景图 16000px 宽），完成后更新 src
     * gif 动图跳过；失败静默保留原图
     */
    const maybeDownscaleBackground = async (src: string): Promise<void> => {
      if (!src || downscalingBackground || src.endsWith(".gif")) return;
      downscalingBackground = true;
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        await img.decode();
        if (img.naturalWidth <= MAX_BG_WIDTH || !img.naturalWidth) return;
        const width = MAX_BG_WIDTH;
        const height = Math.max(
          1,
          Math.round((img.naturalHeight * MAX_BG_WIDTH) / img.naturalWidth),
        );
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
        const newUrl = await window.api.theme.saveBackgroundImage(await blob.arrayBuffer());
        if (newUrl && newUrl !== src) imageBackground.src = newUrl;
      } catch (err) {
        console.warn("[theme] background downscale failed:", err);
      } finally {
        downscalingBackground = false;
      }
    };

    /** 初始化 */
    const init = (): void => {
      if (typeof customColor.value !== "string" || !customColor.value.startsWith("#")) {
        customColor.value = DEFAULT_PRIMARY;
      }
      // 启动时若已有背景图（顺带检查是否需要降采样巨图）
      if (imageBackground.src) {
        void refreshImageColor(imageBackground.src);
        void maybeDownscaleBackground(imageBackground.src);
      }
      apply();
      // 监听背景图变化
      watch(
        () => imageBackground.src,
        (src) => {
          void refreshImageColor(src);
          void maybeDownscaleBackground(src);
        },
      );
      // 影响渲染的值变化
      watch([isDark, effectiveColor, source, effectiveGlobalTint, coverColor, effectiveStyle], () =>
        apply(),
      );
    };

    return {
      mode,
      source,
      customColor,
      globalTint,
      coverColor,
      appearanceStyle,
      imageBackground,
      imageBackgroundColor,
      isDark,
      activeColor,
      effectiveStyle,
      cycleMode,
      setCustomColor,
      setSource,
      init,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: [
        "mode",
        "source",
        "customColor",
        "globalTint",
        "appearanceStyle",
        "imageBackground",
        "imageBackgroundColor",
      ],
    },
  },
);
