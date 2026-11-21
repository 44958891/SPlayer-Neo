/**
 * 平台音质选择（渲染层包装）
 *
 * 选项目录与跨平台映射来自 @shared/utils/platformQuality（不重复实现），
 * 这里补充渲染层能力判断：按音源插件声明的 qualities / nativeQualities
 * 判定某个具体档位当前是否可播 / 可下载，供播放与下载菜单禁用不可达档位。
 */
import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import type { PlatformQualityOption, QualityLevel } from "@shared/types/quality";
import type { PluginInfo } from "@shared/types/plugin";
import { declaredQualitySupports } from "@shared/utils/platformQuality";
import { usePluginsStore } from "@/stores/plugins";

export {
  PLATFORM_QUALITY_OPTIONS,
  declaredQualitySupports,
  findPlatformQuality,
  resolvePlatformQuality,
  upgradePlatformQuality,
} from "@shared/utils/platformQuality";

/** 平台 → 音源插件 source key（与 audioSource 解析使用同一套键名） */
const PLUGIN_SOURCE_BY_PLATFORM: Record<Platform, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
  kuwo: "kw",
  migu: "mg",
};

/** 单个平台的音源插件档位声明汇总 */
export interface SourceQualityCapabilities {
  /** 是否有就绪且支持取链的音源插件 */
  hasPlugin: boolean;
  /** 是否存在未声明档位的旧脚本（可尝试通用物理档位） */
  hasUndeclaredPlugin: boolean;
  /** 是否至少一个插件声明过 qualities / nativeQualities */
  declared: boolean;
  /** 各就绪插件原生档位并集（小写）；无任何声明时缺省 */
  nativeTiers?: ReadonlySet<string>;
  /** 各就绪插件通用档位并集；无任何声明时缺省 */
  levels?: ReadonlySet<QualityLevel>;
}

/** 无任何就绪插件时的空能力 */
const NO_PLUGIN: SourceQualityCapabilities = {
  hasPlugin: false,
  hasUndeclaredPlugin: false,
  declared: false,
};

/**
 * 汇总某平台全部就绪音源插件的档位声明
 * @param platform - 在线平台
 * @param pluginList - 插件列表；缺省读取插件 store（组件环境）
 */
export const collectQualityCapabilities = (
  platform: Platform,
  pluginList?: readonly PluginInfo[],
): SourceQualityCapabilities => {
  const plugins = pluginList ?? usePluginsStore().list;
  const pluginSource = PLUGIN_SOURCE_BY_PLATFORM[platform];
  const native = new Set<string>();
  const levels = new Set<QualityLevel>();
  let hasPlugin = false;
  let hasUndeclaredPlugin = false;
  let declared = false;
  for (const info of plugins) {
    if (!info.enabled || info.status.state !== "ready") continue;
    const source = info.status.sources[pluginSource];
    if (!source?.actions.includes("musicUrl")) continue;
    hasPlugin = true;
    const hasNative = (source.nativeQualities?.length ?? 0) > 0;
    const hasLevels = (source.qualities?.length ?? 0) > 0;
    if (hasNative || hasLevels) {
      declared = true;
      if (hasNative) {
        for (const tier of source.nativeQualities!) native.add(tier.toLowerCase());
      }
      if (hasLevels) {
        for (const level of source.qualities!) levels.add(level);
      }
    } else {
      // 旧脚本未声明任何档位：物理通用档位仍可尝试
      hasUndeclaredPlugin = true;
    }
  }
  if (!hasPlugin) return NO_PLUGIN;
  return {
    hasPlugin: true,
    hasUndeclaredPlugin,
    declared,
    ...(declared ? { nativeTiers: native, levels } : {}),
  };
};

/**
 * 判断插件通道能否表达该档位
 *
 * 精确增强 / 空间档必须有任一插件的原生档位声明；物理通用档（含母带）在
 * 存在未声明旧脚本时放行（可按通用档位尝试），全部插件都声明过时要求
 * 目标被 qualities 或 nativeQualities 覆盖
 */
const pluginSupportsOption = (
  option: PlatformQualityOption,
  caps: SourceQualityCapabilities,
): boolean => {
  if (!caps.hasPlugin) return false;
  if (option.requiresDeclaration) {
    return caps.nativeTiers ? declaredQualitySupports(option, [...caps.nativeTiers]) : false;
  }
  if (caps.hasUndeclaredPlugin) return true;
  return (
    (caps.nativeTiers ? declaredQualitySupports(option, [...caps.nativeTiers]) : false) ||
    (caps.levels?.has(option.level) ?? false)
  );
};

/**
 * 播放菜单可用性：官方接口档位直接可用（正常播放），
 * 插件专属档位需要插件存在且声明覆盖
 */
export const canPlayQualityOption = (
  option: PlatformQualityOption,
  caps: SourceQualityCapabilities,
): boolean => (option.official ? true : pluginSupportsOption(option, caps));

/**
 * 下载菜单可用性：下载统一走插件，官方接口不参与，
 * 因此所有档位都要求插件存在；精确档另有声明要求
 */
export const canDownloadQualityOption = pluginSupportsOption;

/**
 * 解析曲目或来源字符串对应的在线平台；非在线平台（streaming/plugin 等）返回 undefined
 * @param trackOrSource - 曲目对象（可为 null）或任意 source 字符串
 */
export const platformOf = (
  trackOrSource: Track | string | null | undefined,
): Platform | undefined => {
  if (!trackOrSource) return undefined;
  if (typeof trackOrSource === "string") {
    return isPlatform(trackOrSource) ? trackOrSource : undefined;
  }
  return isPlatform(trackOrSource.source) ? trackOrSource.source : undefined;
};
