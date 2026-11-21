import type { PlaybackQualityInput, PlaybackQualityStatus } from "../types/playbackQuality";
import { findPlatformQuality } from "./platformQuality";
import { levelOfQuality, levelMeets, qualityRank } from "./quality";
import { downloadQualityMeets } from "./downloadQuality";
import { validateQualityProvenance } from "./qualityProvenance";

/** 对照请求目标、提供者回执与原始解码参数检查交付结果
 * @param input - 本次具体选择、实际加载提供者与解码参数
 * @returns 请求达标、明确未达标或缺少档位依据
 */
export const assessPlaybackQuality = (input: PlaybackQualityInput): PlaybackQualityStatus => {
  const option = findPlatformQuality(input.selection);
  if (!option) throw new Error("Unknown playback quality selection");
  const quality = input.quality;
  const provenance = validateQualityProvenance(input.provenance);
  const actualLevel =
    quality?.codec && quality.codec !== "unknown" ? levelOfQuality(quality) : undefined;
  const result: PlaybackQualityStatus = {
    selection: option.id,
    platform: option.platform,
    state: "unconfirmed",
    actualLevel,
  };
  if (!["official", "plugin", "cache"].includes(input.source)) return result;
  if (!quality?.codec || quality.codec === "unknown") return result;
  const minimum =
    option.minimumLevel ??
    (option.family === "premium"
      ? "hi-res"
      : option.requiresDeclaration
        ? undefined
        : option.level);
  if (minimum && !levelMeets(quality, minimum)) return { ...result, state: "below" };
  const confirmed =
    provenance && provenance.evidence !== "request" && provenance.evidence !== "catalog";
  if (
    confirmed &&
    provenance.level &&
    minimum &&
    qualityRank(provenance.level) < qualityRank(minimum)
  ) {
    return { ...result, state: "below", actualLevel: provenance.level };
  }
  if (option.requiresDeclaration) {
    return {
      ...result,
      state: downloadQualityMeets({
        selection: option.id,
        qualityLevel: option.level,
        source: option.platform,
        provenance,
        quality,
      })
        ? "met"
        : "unconfirmed",
    };
  }
  // 文件实测足以证明普通物理档位，平台原生品牌仍由徽标的来源规则判断
  return { ...result, state: "met" };
};
