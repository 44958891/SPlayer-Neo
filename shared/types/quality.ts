import type { Platform } from "./platform";
import type { AudioQuality } from "./player";

/** 宿主通用音质档位，供解析偏好与文件规格比较使用 */
export type QualityLevel =
  "jymaster" | "sky" | "jyeffect" | "hi-res" | "lossless" | "hq" | "sq" | "lq";

/** 平台音质意图，与历史通用档位分开，避免臻品增强与空间音频混用 */
export type QualityFamily =
  | "standard"
  | "higher"
  | "hq"
  | "lossless"
  | "hi-res"
  | "premium"
  | "surround"
  | "spatial"
  | "spatial-plus"
  | "master";

/** 平台菜单中的具体音质选项 */
export interface PlatformQualityOption {
  id: string;
  platform: Platform;
  level: QualityLevel;
  family: QualityFamily;
  labelKey: string;
  nativeTier: string;
  lxCandidates: readonly string[];
  /** 官方播放接口可直接请求；下载仍统一走插件 */
  official: boolean;
  /** 空间及增强档位需要明确的来源声明，文件参数本身不能证明 */
  requiresDeclaration?: boolean;
  /** 品牌档位的最低技术规格，未设置时沿用通用档位要求 */
  minimumLevel?: QualityLevel;
}

/** 档位依据，文件解码结果不改变原始声明的可信程度 */
export type QualityEvidence = "response" | "plugin" | "request" | "filename" | "catalog";

/** 音频实际解析来源，与歌单所属平台及文件技术参数分别保存 */
export interface QualityProvenance {
  provider: "official" | "plugin";
  /** 官方通道或插件明确回传的平台，不从歌单来源推定 */
  platform?: Platform;
  pluginId?: string;
  /** 插件原始来源键，未知来源也可保留供提示 */
  sourceKey?: string;
  /** 来源身份的依据，source 表示插件返回请求通道的版本化档位回执 */
  platformEvidence?: "explicit" | "source";
  /** 本次请求目标，与实际返回的原生档位分别保存 */
  requestedSelection?: string;
  requestedTier?: string;
  /** 提供者返回的原生档位，不能用请求档位冒充响应 */
  nativeTier?: string;
  /** 提供者声明的通用档位，实测参数仍以 AudioQuality 为准 */
  level?: QualityLevel;
  evidence: QualityEvidence;
}

/** 已存在音频文件及随文件保存的音质信息 */
export interface ResolvedAudioFile {
  path: string;
  quality?: AudioQuality;
  qualityProvenance?: QualityProvenance;
}
