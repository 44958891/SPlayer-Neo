import { beforeEach, describe, expect, it } from "vitest";
import type { AudioQuality } from "@shared/types/player";
import type { PlaybackQualityStatus } from "@shared/types/playbackQuality";
import type { BrandedQualityTier } from "@shared/utils/qualityProvenance";
import type { QualityLevel, QualityProvenance } from "@shared/types/quality";
import i18n from "@/i18n";
import {
  playbackStatusText,
  qualityBadgeText,
  qualityLevelLabel,
  qualitySelectionLabel,
  qualityTierLabel,
  resolveQualityBadgeView,
} from "./qualityBadge";

const flac = (sampleRate: number, bitsPerSample: number): AudioQuality => ({
  codec: "flac",
  sampleRate,
  bitsPerSample,
  bitRate: 1000000,
  channels: 2,
});

const mp3 = (bitRate: number): AudioQuality => ({
  codec: "mp3",
  sampleRate: 44100,
  bitsPerSample: 16,
  bitRate,
  channels: 2,
});

/**
 * 构造来源证据
 * @param extra - 覆盖字段
 */
const provenance = (extra: Partial<QualityProvenance> = {}): QualityProvenance => ({
  provider: "official",
  evidence: "response",
  ...extra,
});

const ALL_TIERS: BrandedQualityTier[] = [
  "netease-master",
  "netease-sky",
  "netease-surround",
  "qq-master",
  "qq-master-4",
  "qq-premium",
  "qq-spatial",
  "qq-spatial-2",
  "kuwo-master",
  "kuwo-master-quality",
  "kuwo-premium",
  "kuwo-spatial",
  "kugou-master",
  "kugou-spatial",
  "migu-master",
  "migu-premium",
  "migu-spatial",
];

const ALL_LEVELS: QualityLevel[] = [
  "lq",
  "sq",
  "hq",
  "lossless",
  "hi-res",
  "jyeffect",
  "sky",
  "jymaster",
];

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
});

describe("resolveQualityBadgeView 徽标判定", () => {
  it("官方响应确认的 QQ 臻品母带给出专属档位", () => {
    const view = resolveQualityBadgeView(
      flac(192000, 24),
      provenance({ platform: "qqmusic", nativeTier: "臻品母带2.0" }),
    );
    expect(view.tier).toBe("qq-master");
    expect(view.level).toBe("jymaster");
    expect(view.platform).toBe("qqmusic");
    expect(view.mismatch).toBe(false);
  });

  it("QQ 4.0 精确回执和通用母带家族使用不同文案", () => {
    const view = resolveQualityBadgeView(
      flac(192000, 24),
      provenance({ platform: "qqmusic", nativeTier: "qq-master-4.0" }),
    );
    expect(qualityBadgeText(view).label).toBe("臻品母带 4.0");
    i18n.global.locale.value = "en-US";
    expect(qualityBadgeText(view).label).toBe("Premium Master 4.0");
  });

  it("QQ 全景声 2.0 与普通全景声文案分别来自实际档位", () => {
    for (const [nativeTier, label] of [
      ["atmos", "臻品全景声"],
      ["atmos_plus", "臻品全景声 2.0"],
    ]) {
      const view = resolveQualityBadgeView(
        flac(44100, 16),
        provenance({ platform: "qqmusic", nativeTier, level: "sky" }),
      );
      expect(qualityBadgeText(view).label).toBe(label);
    }
  });

  it("未知来源的实测 24bit/192kHz 恢复通用 Master，不冒充平台母带", () => {
    const view = resolveQualityBadgeView(flac(192000, 24), undefined);
    expect(view.tier).toBeUndefined();
    expect(view.platform).toBeUndefined();
    expect(view.level).toBe("jymaster");
  });

  it("filename 证据的 Q000 不给专属档位，按文件规格展示", () => {
    const view = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({ platform: "qqmusic", nativeTier: "Q000", evidence: "filename" }),
      false,
    );
    expect(view.tier).toBeUndefined();
    expect(view.level).toBe("lossless");
    expect(view.evidence).toBe("filename");
  });

  it("request 证据是请求回显，不升级为档位确认", () => {
    const view = resolveQualityBadgeView(
      flac(96000, 24),
      provenance({
        provider: "plugin",
        platform: "netease",
        nativeTier: "hires",
        evidence: "request",
      }),
    );
    expect(view.tier).toBeUndefined();
    expect(view.level).toBe("hi-res");
    expect(view.evidence).toBe("request");
  });

  it("插件声明的空间声档保留专属档位，实测参数不参与矛盾判定", () => {
    const view = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({
        provider: "plugin",
        platform: "kuwo",
        nativeTier: "至臻全景声",
        evidence: "plugin",
      }),
      false,
    );
    expect(view.tier).toBe("kuwo-spatial");
    expect(view.level).toBe("sky");
    expect(view.mismatch).toBe(false);
  });

  it("实测参数与声明的母带档矛盾时标记 mismatch 并回落通用档位", () => {
    const view = resolveQualityBadgeView(
      mp3(128000),
      provenance({ platform: "netease", nativeTier: "jymaster" }),
    );
    expect(view.mismatch).toBe(true);
    expect(view.tier).toBeUndefined();
    expect(view.level).toBe("lq");
  });

  it("未实测的目录参数不产生矛盾标记", () => {
    const view = resolveQualityBadgeView(
      mp3(128000),
      provenance({ platform: "netease", nativeTier: "jymaster" }),
      false,
    );
    expect(view.mismatch).toBe(false);
  });
});

describe("qualityBadgeText 徽标文案", () => {
  it("专属档位短标签带平台名与规格的完整提示", () => {
    const view = resolveQualityBadgeView(
      flac(192000, 24),
      provenance({ platform: "qqmusic", nativeTier: "臻品母带2.0" }),
    );
    const text = qualityBadgeText(view, flac(192000, 24));
    expect(text.label).toBe("臻品母带");
    expect(text.tooltip).toContain("QQ音乐 · 臻品母带");
    expect(text.tooltip).toContain("FLAC · 24bit · 192.0kHz");
    expect(text.tooltip).toContain("音源接口响应已确认");
    expect(text.tooltip).not.toContain("不符");
  });

  it("插件声明档位在提示中明确未经独立验证", () => {
    const view = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({
        provider: "plugin",
        platform: "kuwo",
        nativeTier: "至臻全景声",
        evidence: "plugin",
      }),
      false,
    );
    const text = qualityBadgeText(view, flac(44100, 16));
    expect(text.label).toBe("至臻全景声");
    expect(text.tooltip).toContain("音源插件声明档位，未经解码独立验证");
  });

  it("矛盾时提示告警，filename 与目录数据注明未实测", () => {
    const mismatchView = resolveQualityBadgeView(
      mp3(128000),
      provenance({ platform: "netease", nativeTier: "jymaster" }),
    );
    expect(qualityBadgeText(mismatchView, mp3(128000)).tooltip).toContain("实测参数与声明档位不符");

    const filenameView = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({ platform: "qqmusic", nativeTier: "Q000", evidence: "filename" }),
      false,
    );
    expect(qualityBadgeText(filenameView, flac(44100, 16)).tooltip).toContain("依文件名推断");

    const catalogView = resolveQualityBadgeView(flac(44100, 16), undefined, false);
    expect(qualityBadgeText(catalogView, flac(44100, 16)).tooltip).toContain("来自曲目目录信息");

    const localView = resolveQualityBadgeView(flac(44100, 16), undefined);
    expect(qualityBadgeText(localView, flac(44100, 16)).tooltip).toContain("参数来自文件解码实测");
  });

  it("英文环境下输出对应文案", () => {
    i18n.global.locale.value = "en-US";
    const view = resolveQualityBadgeView(
      flac(192000, 24),
      provenance({ platform: "qqmusic", nativeTier: "臻品母带2.0" }),
    );
    const text = qualityBadgeText(view, flac(192000, 24));
    expect(text.label).toBe("Premium Master");
    expect(text.tooltip).toContain("Confirmed by source API response");
  });
});

describe("qualityBadgeText 请求对照", () => {
  it("有请求目标时单列请求行，并保留原生档位原文行", () => {
    const view = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({
        provider: "plugin",
        platform: "netease",
        nativeTier: "flac",
        requestedSelection: "netease:hires",
        requestedTier: "hires",
        evidence: "plugin",
      }),
    );
    const text = qualityBadgeText(view, flac(44100, 16));
    expect(text.tooltip).toContain("高解析度无损 Hi-Res");
    expect(text.tooltip).toContain(
      i18n.global.t("quality.playback.requested", { quality: "高解析度无损 Hi-Res" }),
    );
    expect(text.tooltip).toContain(i18n.global.t("quality.tooltip.nativeTier", { tier: "flac" }));
  });

  it("未知请求目标不回显原始来源键", () => {
    const view = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({ requestedSelection: "ghost:raw-token" }),
    );
    const text = qualityBadgeText(view, flac(44100, 16));
    expect(text.tooltip).not.toContain("raw-token");
    expect(text.tooltip).not.toContain(
      i18n.global.t("quality.playback.requested", { quality: "" }),
    );
    expect(qualitySelectionLabel("ghost:raw-token", "netease")).toBe("");
  });

  it("来源通道回执的平台身份附免责声明，显式声明不附", () => {
    const source = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({
        provider: "plugin",
        platform: "netease",
        nativeTier: "flac",
        platformEvidence: "source",
        evidence: "plugin",
      }),
    );
    expect(qualityBadgeText(source, flac(44100, 16)).tooltip).toContain(
      i18n.global.t("quality.playback.sourceChannel"),
    );

    const explicit = resolveQualityBadgeView(
      flac(44100, 16),
      provenance({ provider: "official", platform: "netease", evidence: "response" }),
    );
    expect(qualityBadgeText(explicit, flac(44100, 16)).tooltip).not.toContain(
      i18n.global.t("quality.playback.sourceChannel"),
    );
  });
});

describe("playbackStatusText 请求状态文案", () => {
  const below: PlaybackQualityStatus = {
    selection: "netease:hires",
    platform: "netease",
    state: "below",
    actualLevel: "lossless",
  };

  it("met 与无对照不产生警示，仅给出请求名称", () => {
    expect(playbackStatusText({ ...below, state: "met" }).tooltip).toBe("");
    expect(playbackStatusText(undefined).tooltip).toBe("");
    expect(playbackStatusText(null).requested).toBe("");
  });

  it("below 列出请求与实际档位名称，实际名称与助手同参数一致", () => {
    const text = playbackStatusText(below);
    expect(text.requested).toBe("高解析度无损 Hi-Res");
    expect(text.actual).toBe(qualityLevelLabel("lossless"));
    expect(text.tooltip).toContain(text.requested);
    expect(text.tooltip).toContain(text.actual);
    expect(text.tooltip).toContain(
      i18n.global.t("quality.playback.below", {
        requested: text.requested,
        actual: text.actual,
      }),
    );
  });

  it("unconfirmed 状态给出未确认提示", () => {
    const text = playbackStatusText({ ...below, state: "unconfirmed" });
    expect(text.tooltip).toContain(
      i18n.global.t("quality.playback.unconfirmed", {
        requested: text.requested,
        actual: text.actual,
      }),
    );
  });

  it("实际档位缺失时省略实际行，状态消息用占位", () => {
    const text = playbackStatusText({ ...below, state: "unconfirmed", actualLevel: undefined });
    expect(text.actual).toBe("");
    expect(text.tooltip).not.toContain(i18n.global.t("quality.playback.actual", { quality: "" }));
    expect(text.tooltip).toContain(
      i18n.global.t("quality.playback.unconfirmed", { requested: text.requested, actual: "—" }),
    );
  });

  it("未知选择回退到目标不可用提示，不展示原始键", () => {
    const text = playbackStatusText({ ...below, selection: "netease:ghost" });
    expect(text.requested).toBe("");
    expect(text.tooltip).toContain(i18n.global.t("quality.playback.targetUnavailable"));
    expect(text.tooltip).not.toContain("netease:ghost");
    expect(text.tooltip).toContain(
      i18n.global.t("quality.playback.below", {
        requested: i18n.global.t("quality.playback.targetUnavailable"),
        actual: text.actual,
      }),
    );
  });
});

describe("档位标签覆盖完整", () => {
  it("全部专属档位在两种语言下都有本地化标签", () => {
    for (const tier of ALL_TIERS) {
      expect(qualityTierLabel(tier)).not.toContain("quality.tier");
      i18n.global.locale.value = "en-US";
      expect(qualityTierLabel(tier)).not.toContain("quality.tier");
      i18n.global.locale.value = "zh-CN";
    }
  });

  it("全部通用档位在两种语言下都有本地化名称", () => {
    for (const level of ALL_LEVELS) {
      expect(qualityLevelLabel(level)).not.toContain("quality.level");
      i18n.global.locale.value = "en-US";
      expect(qualityLevelLabel(level)).not.toContain("quality.level");
      i18n.global.locale.value = "zh-CN";
    }
  });
});
