import type { Platform } from "../types/platform";
import type { PlatformQualityOption, QualityFamily, QualityLevel } from "../types/quality";

/** 构造稳定的平台选择标识与请求描述
 * @param platform - 菜单所属平台
 * @param nativeTier - 提供者使用的原生档位
 * @param level - 兼容旧协议的宿主等级
 * @param family - 跨平台目标意图
 * @param lxCandidates - LX 脚本可接受的精确原生档位
 * @param official - 官方播放接口是否支持
 * @param requiresDeclaration - 是否必须获得实际档位声明
 * @param minimumLevel - 平台品牌档位的最低文件规格
 * @returns 平台音质选项
 */
const option = (
  platform: Platform,
  nativeTier: string,
  level: QualityLevel,
  family: QualityFamily,
  lxCandidates: readonly string[],
  official = true,
  requiresDeclaration = false,
  minimumLevel?: QualityLevel,
): PlatformQualityOption => ({
  id: `${platform}:${nativeTier}`,
  platform,
  nativeTier,
  level,
  family,
  labelKey: `quality.option.${platform}.${family}`,
  lxCandidates,
  official,
  requiresDeclaration,
  minimumLevel,
});

/** 各平台自己的菜单，不把同一宿主档位当成同一种品牌音质 */
export const PLATFORM_QUALITY_OPTIONS: Readonly<
  Record<Platform, readonly PlatformQualityOption[]>
> = {
  netease: [
    option("netease", "standard", "lq", "standard", ["128k", "128", "standard"]),
    option("netease", "higher", "sq", "higher", ["192k", "192"]),
    option("netease", "exhigh", "hq", "hq", ["320k", "320", "hq", "high"]),
    option("netease", "lossless", "lossless", "lossless", ["flac", "lossless", "sq"]),
    option("netease", "hires", "hi-res", "hi-res", ["flac24bit", "hires", "hi-res"]),
    option("netease", "jyeffect", "jyeffect", "surround", ["jyeffect", "surround"], true, true),
    option("netease", "sky", "sky", "spatial", ["sky", "atmos", "atmos_plus"], true, true),
    option("netease", "jymaster", "jymaster", "master", ["master", "jymaster"]),
  ],
  qqmusic: [
    option("qqmusic", "C400", "lq", "standard", ["128k", "128", "standard"]),
    option("qqmusic", "M800", "hq", "hq", ["320k", "320", "hq", "high"]),
    option("qqmusic", "F000", "lossless", "lossless", ["flac", "lossless", "sq"]),
    option("qqmusic", "AI00", "hi-res", "hi-res", ["flac24bit", "hires", "hi-res"]),
    // 全景声只认 raw atmos；atmos_plus 属于独立的 2.0 档，不混入
    option(
      "qqmusic",
      "qq-spatial",
      "sky",
      "spatial",
      ["atmos", "qq-spatial", "臻品全景声"],
      false,
      true,
    ),
    option(
      "qqmusic",
      "qq-spatial-2.0",
      "sky",
      "spatial-plus",
      // 只认精确 atmos_plus 与中文 2.0 名，普通 atmos 回执不能冒充 2.0
      ["atmos_plus", "qq-spatial-2.0", "臻品全景声2.0"],
      false,
      true,
    ),
    // QQ 母带统一目标，优先使用插件原生 master；历史版本名仅作兼容别名
    option(
      "qqmusic",
      "master",
      "jymaster",
      "master",
      [
        "master",
        "jymaster",
        "qq-master",
        "臻品母带",
        "qq-master-4.0",
        "臻品母带4.0",
        "qq-master-2.0",
        "臻品母带2.0",
      ],
      false,
      true,
      "jymaster",
    ),
  ],
  kugou: [
    option("kugou", "128", "lq", "standard", ["128k", "128", "standard"]),
    option("kugou", "320", "hq", "hq", ["320k", "320", "hq", "high"]),
    option("kugou", "flac", "lossless", "lossless", ["flac", "lossless", "sq"]),
    // 沿用旧选择标识，优先请求插件原生 hires 档
    option("kugou", "high", "hi-res", "hi-res", ["hires", "flac24bit", "hi-res"]),
    option(
      "kugou",
      "kugou-spatial",
      "sky",
      "spatial",
      ["atmos", "kugou-spatial", "atmos_plus", "sky", "蝰蛇全景声"],
      false,
      true,
    ),
    option(
      "kugou",
      "kugou-master",
      "jymaster",
      "master",
      ["master", "kugou-master", "jymaster", "蝰蛇超清", "蝰蛇超清母带"],
      false,
      true,
      "hi-res",
    ),
  ],
  kuwo: [
    option("kuwo", "128kmp3", "lq", "standard", ["128k", "128", "standard"]),
    option("kuwo", "320kmp3", "hq", "hq", ["320k", "320", "hq", "high"]),
    option("kuwo", "flac", "lossless", "lossless", ["flac", "lossless", "sq"]),
    // 大师音质按插件声明请求，实际文件仍需满足母带规格
    option(
      "kuwo",
      "kuwo-master",
      "jymaster",
      "master",
      // raw master 排最前；旧至臻串不作为母带请求优先 token
      ["master", "kuwo-master", "jymaster", "大师音质"],
      false,
      true,
      "jymaster",
    ),
  ],
  migu: [
    option("migu", "PQ", "lq", "standard", ["128k", "128", "standard", "pq"], false),
    option("migu", "HQ", "hq", "hq", ["320k", "320", "hq", "high"], false),
    option("migu", "SQ", "lossless", "lossless", ["flac", "lossless", "sq"], false),
    // 普通 HiRes 为规范档；旧至臻选择在平台内映射到这一项
    option("migu", "hires", "hi-res", "hi-res", ["hires", "flac24bit", "hi-res"], false),
  ],
};

/** QQ 母带统一选择标识 */
const QQ_MASTER_ID = "qqmusic:master";

/** 历史母带选择统一到 master，其他平台别名仍限制在原平台 */
const LEGACY_SELECTION_MAP: Readonly<Record<string, string>> = {
  "qqmusic:qq-master-4.0": QQ_MASTER_ID,
  "qqmusic:qq-master-2.0": QQ_MASTER_ID,
  "qqmusic:qq-master": QQ_MASTER_ID,
  "qqmusic:jymaster": QQ_MASTER_ID,
  "qqmusic:臻品母带": QQ_MASTER_ID,
  "qqmusic:臻品母带4.0": QQ_MASTER_ID,
  "qqmusic:臻品母带2.0": QQ_MASTER_ID,
  "migu:migu-premium": "migu:hires",
};

/** 已从菜单移除的品牌选择及保留的旧意图：存档原样保留供源入口显式报错，
 * 跨平台按该 family 推等价档，本平台不再提供对应项 */
const RETIRED_SELECTION_FAMILY: ReadonlyMap<string, QualityFamily> = new Map([
  ["qqmusic:qq-premium-2.0", "premium"],
  ["kuwo:hires", "hi-res"],
  ["kuwo:kuwo-premium-2.0", "premium"],
  ["kuwo:kuwo-spatial", "spatial"],
  ["migu:migu-master", "master"],
  ["migu:migu-spatial", "spatial"],
]);

const LEVEL_FAMILY: Readonly<Record<QualityLevel, QualityFamily>> = {
  lq: "standard",
  sq: "higher",
  hq: "hq",
  lossless: "lossless",
  "hi-res": "hi-res",
  jyeffect: "surround",
  sky: "spatial",
  jymaster: "master",
};

/** 校验菜单选择并限制在当前歌曲平台；旧别名仅限原平台内映射到规范档
 * @param id - 保存或跨进程传递的选择标识
 * @param platform - 可选的平台约束
 * @returns 合法选项
 */
export const findPlatformQuality = (
  id: string | undefined,
  platform?: Platform,
): PlatformQualityOption | undefined => {
  if (!id) return undefined;
  const key = platform ?? (id.split(":", 1)[0] as Platform);
  if (!Object.hasOwn(PLATFORM_QUALITY_OPTIONS, key)) return undefined;
  const hit = PLATFORM_QUALITY_OPTIONS[key].find((entry) => entry.id === id);
  const aliased = LEGACY_SELECTION_MAP[id];
  return (
    hit ??
    (aliased && aliased.startsWith(`${key}:`)
      ? PLATFORM_QUALITY_OPTIONS[key].find((entry) => entry.id === aliased)
      : undefined)
  );
};

/** 将旧通用偏好或另一平台的具体选择映射为本平台目标，不能由目录规格猜档位
 * @param platform - 当前歌曲平台
 * @param level - 历史全局音质等级
 * @param selection - 上次保存的具体选择
 * @returns 该平台的等价选项，无对应音效时返回空
 */
export const resolvePlatformQuality = (
  platform: Platform,
  level: QualityLevel,
  selection?: string,
): PlatformQualityOption | undefined => {
  const selected = findPlatformQuality(selection);
  const exact = selected?.platform === platform ? selected : undefined;
  if (exact) return exact;
  // 已退休选择与目标同平台：菜单已无对应项，显式无解而非静默换档
  if (
    !selected &&
    selection !== undefined &&
    selection.startsWith(`${platform}:`) &&
    RETIRED_SELECTION_FAMILY.has(selection)
  ) {
    return undefined;
  }
  // 已退休选择在其他平台保留旧意图；spatial-plus 无等价时不降级为普通 spatial
  const family =
    selected?.family ?? RETIRED_SELECTION_FAMILY.get(selection ?? "") ?? LEVEL_FAMILY[level];
  const options = PLATFORM_QUALITY_OPTIONS[platform];
  return (
    options.find((entry) => entry.family === family) ??
    (family === "higher" ? options.find((entry) => entry.family === "hq") : undefined)
  );
};

/** 规范化存档中的音质选择：旧别名升级为规范档，已退休标识原样保留
 * （源入口显式报错，禁止清空后隐式降档），其余未知标识清除
 * @param id - 存档选择标识
 * @returns 规范化后的标识或空
 */
export const normalizeStoredQualitySelection = (id: string | undefined): string | undefined => {
  if (!id) return undefined;
  const aliased = LEGACY_SELECTION_MAP[id];
  if (aliased) return aliased;
  if (RETIRED_SELECTION_FAMILY.has(id)) return id;
  return findPlatformQuality(id) ? id : undefined;
};

/** 检查 LX 源声明是否明确包含这一具体档位
 * @param item - 平台选择项
 * @param declared - 源原始 qualitys 声明，小写形式
 * @returns 能精确表达请求时返回真
 */
export const declaredQualitySupports = (
  item: PlatformQualityOption,
  declared: readonly string[] | undefined,
): boolean =>
  Boolean(
    declared?.some(
      (raw) =>
        raw.toLowerCase() === item.id.toLowerCase() ||
        item.lxCandidates.includes(raw.toLowerCase()),
    ),
  );

/** 升级只选择可以用实际文件规格验证的目标，不使用空间效果替代位深和采样率
 * @param platform - 匹配到的在线平台
 * @param level - 无损、高解析或母带规格目标
 * @returns 对应平台的文件规格目标
 */
export const upgradePlatformQuality = (
  platform: Platform,
  level: QualityLevel,
): PlatformQualityOption | undefined =>
  PLATFORM_QUALITY_OPTIONS[platform].find(
    (entry) => entry.level === level && (!entry.requiresDeclaration || entry.family === "master"),
  );
