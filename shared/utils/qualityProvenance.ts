import type { AudioQuality } from "../types/player";
import type { MusicUrlRes } from "../types/plugin";
import { isPlatform, type Platform } from "../types/platform";
import type { QualityEvidence, QualityLevel, QualityProvenance } from "../types/quality";
import { levelOfQuality, qualityRank } from "./quality";

const LEVELS: readonly QualityLevel[] = [
  "lq",
  "sq",
  "hq",
  "lossless",
  "hi-res",
  "jyeffect",
  "sky",
  "jymaster",
];
const EVIDENCE: readonly QualityEvidence[] = [
  "response",
  "plugin",
  "request",
  "filename",
  "catalog",
];
const SOURCE_PLATFORMS: Readonly<Record<string, Platform>> = {
  wy: "netease",
  ncm: "netease",
  tx: "qqmusic",
  qm: "qqmusic",
  kg: "kugou",
  kw: "kuwo",
  mg: "migu",
};
const LOSSLESS = new Set([
  "flac",
  "alac",
  "ape",
  "wav",
  "aiff",
  "wavpack",
  "tta",
  "dsd_lsbf",
  "dsd_msbf",
  "dsd_lsbf_planar",
  "dsd_msbf_planar",
]);

/** 平台专属档位标识，不能从采样率或通用请求档位推定 */
export type BrandedQualityTier =
  | "netease-master"
  | "netease-sky"
  | "netease-surround"
  | "qq-master"
  | "qq-master-4"
  | "qq-premium"
  | "qq-spatial"
  | "qq-spatial-2"
  | "kuwo-master"
  | "kuwo-master-quality"
  | "kuwo-premium"
  | "kuwo-spatial"
  | "kugou-master"
  | "kugou-spatial"
  | "migu-master"
  | "migu-premium"
  | "migu-spatial";

interface BrandedTier {
  tier: BrandedQualityTier;
  level: QualityLevel;
  /** 空间处理和立体声文件规格不能按同一条排名判定 */
  physical: "master" | "hi-res" | "spatial";
}

const TIERS: Partial<Record<Platform, Readonly<Record<string, BrandedTier>>>> = {
  netease: {
    jymaster: { tier: "netease-master", level: "jymaster", physical: "master" },
    master: { tier: "netease-master", level: "jymaster", physical: "master" },
    sky: { tier: "netease-sky", level: "sky", physical: "spatial" },
    jyeffect: { tier: "netease-surround", level: "jyeffect", physical: "spatial" },
  },
  qqmusic: {
    "qq-master-4.0": { tier: "qq-master-4", level: "jymaster", physical: "master" },
    "臻品母带4.0": { tier: "qq-master-4", level: "jymaster", physical: "master" },
    "qq-master-2.0": { tier: "qq-master", level: "jymaster", physical: "master" },
    master: { tier: "qq-master", level: "jymaster", physical: "master" },
    atmos: { tier: "qq-spatial", level: "sky", physical: "spatial" },
    atmos_plus: { tier: "qq-spatial-2", level: "sky", physical: "spatial" },
    "qq-spatial-2.0": { tier: "qq-spatial-2", level: "sky", physical: "spatial" },
    "臻品全景声2.0": { tier: "qq-spatial-2", level: "sky", physical: "spatial" },
    "臻品母带2.0": { tier: "qq-master", level: "jymaster", physical: "master" },
    "qq-premium-2.0": { tier: "qq-premium", level: "sky", physical: "hi-res" },
    "臻品音质2.0": { tier: "qq-premium", level: "sky", physical: "hi-res" },
    "qq-spatial": { tier: "qq-spatial", level: "sky", physical: "spatial" },
    臻品全景声: { tier: "qq-spatial", level: "sky", physical: "spatial" },
  },
  kuwo: {
    "kuwo-master": { tier: "kuwo-master", level: "jymaster", physical: "master" },
    master: { tier: "kuwo-master-quality", level: "jymaster", physical: "master" },
    至臻母带: { tier: "kuwo-master", level: "jymaster", physical: "master" },
    大师音质: { tier: "kuwo-master-quality", level: "jymaster", physical: "master" },
    "kuwo-premium-2.0": { tier: "kuwo-premium", level: "sky", physical: "hi-res" },
    "至臻音质2.0": { tier: "kuwo-premium", level: "sky", physical: "hi-res" },
    "kuwo-spatial": { tier: "kuwo-spatial", level: "sky", physical: "spatial" },
    至臻全景声: { tier: "kuwo-spatial", level: "sky", physical: "spatial" },
  },
  kugou: {
    "kugou-master": { tier: "kugou-master", level: "jymaster", physical: "hi-res" },
    master: { tier: "kugou-master", level: "jymaster", physical: "hi-res" },
    蝰蛇超清母带: { tier: "kugou-master", level: "jymaster", physical: "hi-res" },
    蝰蛇超清: { tier: "kugou-master", level: "jymaster", physical: "hi-res" },
    atmos: { tier: "kugou-spatial", level: "sky", physical: "spatial" },
    "kugou-spatial": { tier: "kugou-spatial", level: "sky", physical: "spatial" },
    杜比全景声: { tier: "kugou-spatial", level: "sky", physical: "spatial" },
    蝰蛇全景声: { tier: "kugou-spatial", level: "sky", physical: "spatial" },
  },
  migu: {
    "migu-master": { tier: "migu-master", level: "jymaster", physical: "master" },
    master: { tier: "migu-master", level: "jymaster", physical: "master" },
    zq32: { tier: "migu-master", level: "jymaster", physical: "master" },
    zq: { tier: "migu-premium", level: "hi-res", physical: "hi-res" },
    至臻母带音质: { tier: "migu-master", level: "jymaster", physical: "master" },
    "migu-premium": { tier: "migu-premium", level: "hi-res", physical: "hi-res" },
    至臻音质: { tier: "migu-premium", level: "hi-res", physical: "hi-res" },
    "migu-spatial": { tier: "migu-spatial", level: "sky", physical: "spatial" },
    至臻全景声: { tier: "migu-spatial", level: "sky", physical: "spatial" },
    av3a: { tier: "migu-spatial", level: "sky", physical: "spatial" },
  },
};

/** 仅归一已知的平台来源键，不按歌曲目录或 URL 域名猜来源
 * @param sourceKey - 提供者明确回传的来源键
 * @returns 已知的平台
 */
export const platformFromSourceKey = (sourceKey: string | undefined): Platform | undefined => {
  const key = sourceKey?.trim().toLowerCase();
  return key && isPlatform(key)
    ? key
    : key && Object.hasOwn(SOURCE_PLATFORMS, key)
      ? SOURCE_PLATFORMS[key]
      : undefined;
};

/** 校验跨进程或数据库读出的来源信息，并剔除额外字段
 * @param value - 待校验数据
 * @returns 轻量可序列化的来源信息，非法数据返回空
 */
export const validateQualityProvenance = (value: unknown): QualityProvenance | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (input.provider !== "official" && input.provider !== "plugin") return undefined;
  if (!EVIDENCE.includes(input.evidence as QualityEvidence)) return undefined;
  const result: QualityProvenance = {
    provider: input.provider,
    evidence: input.evidence as QualityEvidence,
  };
  if (typeof input.platform === "string" && isPlatform(input.platform))
    result.platform = input.platform;
  if (typeof input.level === "string" && LEVELS.includes(input.level as QualityLevel))
    result.level = input.level as QualityLevel;
  if (input.platformEvidence === "explicit" || input.platformEvidence === "source")
    result.platformEvidence = input.platformEvidence;
  for (const key of [
    "pluginId",
    "sourceKey",
    "nativeTier",
    "requestedTier",
    "requestedSelection",
  ] as const) {
    const text = input[key];
    if (typeof text === "string" && text.trim() && text.length <= (key === "pluginId" ? 256 : 96)) {
      result[key] = text.trim();
    }
  }
  return result;
};

/** 保留插件明确返回的信息，旧脚本的请求回显不升级为档位确认
 * @param result - 插件取链响应
 * @param pluginId - 实际使用的插件
 * @param sourceKey - 请求使用的来源键，仅用于追溯
 * @returns 本次取链的音质依据
 */
export const provenanceFromPlugin = (
  result: MusicUrlRes,
  pluginId: string,
  sourceKey: string,
): QualityProvenance =>
  validateQualityProvenance({
    provider: "plugin",
    pluginId,
    sourceKey,
    platform:
      platformFromSourceKey(result.actualSource) ??
      (result.sourceEvidence === "gzPlayback-v1" ? platformFromSourceKey(sourceKey) : undefined),
    platformEvidence: result.actualSource
      ? "explicit"
      : result.sourceEvidence === "gzPlayback-v1"
        ? "source"
        : undefined,
    nativeTier: result.nativeTier,
    requestedTier: result.requestedTier,
    requestedSelection: result.requestedSelection,
    level: result.quality,
    evidence: result.nativeTier ? "plugin" : "request",
  })!;

/** 音质徽标描述，实测技术规格与平台专属档位分别保留 */
export interface QualityBadgeDescriptor {
  level: QualityLevel;
  platform?: Platform;
  tier?: BrandedQualityTier;
  mismatch: boolean;
}

/** 判断实测规格是否明显违背声明，不用技术参数证明空间音频或品牌身份
 * @param quality - 解码器实测参数
 * @param level - 提供者声明的档位
 * @param physical - 已知专属档位的物理规格要求
 * @returns 是否存在明确的规格矛盾
 */
const contradicts = (
  quality: AudioQuality,
  level: QualityLevel | undefined,
  physical?: BrandedTier["physical"],
): boolean => {
  if (!quality.codec || quality.codec === "unknown") return false;
  if (physical === "spatial") return false;
  const lossless = LOSSLESS.has(quality.codec.toLowerCase());
  const needsMaster = physical ? physical === "master" : level === "jymaster";
  const needsHiRes = physical ? physical === "hi-res" : level === "hi-res";
  if (needsMaster || needsHiRes) {
    return (
      !lossless ||
      (quality.bitsPerSample > 0 && quality.bitsPerSample < 24) ||
      (quality.sampleRate > 0 && quality.sampleRate < (needsMaster ? 176400 : 96000))
    );
  }
  if (level === "lossless" && !lossless) return true;
  if (!lossless && quality.bitRate > 0) {
    return (
      (level === "hq" && quality.bitRate < 300000) || (level === "sq" && quality.bitRate < 180000)
    );
  }
  return false;
};

/** 根据档位证据和文件参数选徽标，独立于下载下限判定
 * @param quality - 音频参数，列表目录中的参数可标记为未实测
 * @param provenance - 解析或保存文件时保留的来源证据
 * @param measured - 参数是否来自实际文件解码
 * @returns 通用或平台专属徽标及声明矛盾标记
 */
export const resolveQualityBadge = (
  quality: AudioQuality | undefined,
  provenance: QualityProvenance | undefined,
  measured = true,
): QualityBadgeDescriptor => {
  const info = validateQualityProvenance(provenance);
  const nativeTier = info?.nativeTier?.replace(/\s+/g, "").toLowerCase();
  const trustedTier = info && (info.evidence === "response" || info.evidence === "plugin");
  const platformTiers = trustedTier && info.platform ? TIERS[info.platform] : undefined;
  const branded =
    platformTiers && nativeTier && Object.hasOwn(platformTiers, nativeTier)
      ? platformTiers[nativeTier]
      : undefined;
  const mismatch = Boolean(
    measured && quality && contradicts(quality, info?.level, branded?.physical),
  );
  const inferred = levelOfQuality(quality);
  // 实测高规格文件恢复通用 Master，品牌母带仍需独立的来源证据
  const generic = inferred === "jymaster" && !measured ? "hi-res" : inferred;
  const physicalLevels: readonly QualityLevel[] = ["lq", "sq", "hq", "lossless", "hi-res"];
  const confirmedLevel =
    info &&
    info.evidence !== "request" &&
    info.evidence !== "catalog" &&
    physicalLevels.includes(info.level as QualityLevel)
      ? info.level
      : undefined;
  const requestHiRes =
    info?.evidence === "request" && info.level === "hi-res" && generic === "jymaster";
  const technicalLevel =
    confirmedLevel && !mismatch && qualityRank(generic) > qualityRank(confirmedLevel)
      ? confirmedLevel
      : generic;
  const declared = !quality && info?.level;
  // 当品牌档位存在时，优先使用其配置档位作为显示档位
  const displayLevel: QualityLevel =
    branded && !mismatch
      ? branded.level // 品牌档位的level字段已经是QualityLevel类型
      : declared && physicalLevels.includes(declared)
        ? declared
        : requestHiRes
          ? "hi-res"
          : technicalLevel;
  return {
    level: displayLevel,
    platform: info?.platform,
    tier: !mismatch ? branded?.tier : undefined,
    mismatch,
  };
};
