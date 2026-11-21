import type { Platform } from "./platform";
import type { AudioQuality } from "./player";
import type { QualityLevel, QualityProvenance } from "./quality";

/** 本次播放请求与实际交付的对照，不用于冒充平台原生档位 */
export interface PlaybackQualityStatus {
  selection: string;
  platform: Platform;
  state: "met" | "below" | "unconfirmed";
  actualLevel?: QualityLevel;
}

/** 共享校验器的实际文件输入 */
export interface PlaybackQualityInput {
  selection: string;
  source: string;
  quality?: AudioQuality;
  provenance?: QualityProvenance;
}
