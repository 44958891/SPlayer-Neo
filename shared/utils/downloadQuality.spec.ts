import { describe, expect, it } from "vitest";
import type { AudioQuality } from "../types/player";
import type { QualityProvenance } from "../types/quality";
import { downloadQualityMeets, qualityDeclarationMeets } from "./downloadQuality";
import { findPlatformQuality } from "./platformQuality";

/** 探测得到的音频参数 */
const audio = (over: Partial<AudioQuality>): AudioQuality => ({
  codec: "flac",
  sampleRate: 44100,
  bitsPerSample: 16,
  bitRate: 900000,
  channels: 2,
  ...over,
});

/** 构造插件明确回传的档位依据 */
const provenance = (over: Partial<QualityProvenance>): QualityProvenance => ({
  provider: "plugin",
  pluginId: "p1",
  platform: "netease",
  evidence: "plugin",
  ...over,
});

/** QQ 母带全别名回执，统一归一 canonical qq-master */
const masterReceipts = [
  "master",
  "qq-master",
  "jymaster",
  "臻品母带",
  "qq-master-4.0",
  "臻品母带4.0",
  "qq-master-2.0",
  "臻品母带2.0",
];

describe("qualityDeclarationMeets", () => {
  it("只有声明回执匹配才确认母带，选择证据不能代替文件校验", () => {
    const option = findPlatformQuality("qqmusic:master")!;
    const confirmed = provenance({ platform: "qqmusic", nativeTier: "master" });
    expect(qualityDeclarationMeets(option, confirmed)).toBe(true);
    expect(qualityDeclarationMeets(option, { ...confirmed, evidence: "request" })).toBe(false);
    expect(qualityDeclarationMeets(option, { ...confirmed, platform: "kugou" })).toBe(false);
    expect(qualityDeclarationMeets(option, { ...confirmed, nativeTier: "hires" })).toBe(false);
    expect(qualityDeclarationMeets(option, undefined)).toBe(false);
    expect(
      downloadQualityMeets({
        selection: option.id,
        source: "qqmusic",
        qualityLevel: "jymaster",
        provenance: confirmed,
        quality: audio({}),
      }),
    ).toBe(false);
  });

  it("全景声与全景声升级版回执仍不可互换", () => {
    const option = findPlatformQuality("qqmusic:qq-spatial-2.0")!;
    expect(
      qualityDeclarationMeets(
        option,
        provenance({ platform: "qqmusic", nativeTier: "atmos_plus" }),
      ),
    ).toBe(true);
    expect(
      qualityDeclarationMeets(option, provenance({ platform: "qqmusic", nativeTier: "atmos" })),
    ).toBe(false);
  });
});

describe("downloadQualityMeets", () => {
  it("无选择返回 undefined，沿用原有通用下限", () => {
    expect(
      downloadQualityMeets({
        qualityLevel: "lossless",
        source: "netease",
        quality: audio({}),
      }),
    ).toBeUndefined();
  });

  it("未知选择标识 → 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:foo",
        qualityLevel: "sky",
        source: "netease",
        provenance: provenance({ nativeTier: "sky" }),
        quality: audio({}),
      }),
    ).toBe(false);
  });

  it("来源平台与选择不一致 → 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "kuwo:kuwo-master",
        qualityLevel: "jymaster",
        source: "netease",
        provenance: provenance({ platform: "kuwo", nativeTier: "kuwo-master" }),
        quality: audio({ sampleRate: 176400, bitsPerSample: 24 }),
      }),
    ).toBe(false);
  });

  it("通用档位与选择档位不一致 → 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:sky",
        qualityLevel: "jyeffect",
        source: "netease",
        provenance: provenance({ nativeTier: "sky" }),
        quality: audio({}),
      }),
    ).toBe(false);
  });

  it("解码不出有效音频 → 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:sky",
        qualityLevel: "sky",
        source: "netease",
        provenance: provenance({ nativeTier: "sky" }),
        quality: audio({ codec: "unknown" }),
      }),
    ).toBe(false);
  });

  it("空间音频冒牌货：声明依据不是该品牌档位 → 拒绝", () => {
    // nativeTier 命中的是 hi-res 而非 netease-sky，不能拿任意高等级文件冒充空间音频
    expect(
      downloadQualityMeets({
        selection: "netease:sky",
        qualityLevel: "sky",
        source: "netease",
        provenance: provenance({ nativeTier: "hires" }),
        quality: audio({ sampleRate: 96000, bitsPerSample: 24 }),
      }),
    ).toBe(false);
  });

  it("空间音频：requestedTier 回显不构成证据（evidence=request）→ 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:sky",
        qualityLevel: "sky",
        source: "netease",
        provenance: provenance({ nativeTier: "sky", evidence: "request" }),
        quality: audio({}),
      }),
    ).toBe(false);
  });

  it("空间音频：无解析依据 → 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:sky",
        qualityLevel: "sky",
        source: "netease",
        quality: audio({}),
      }),
    ).toBe(false);
  });

  it("空间音频：原生档位声明命中品牌规范档位 → 通过", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:sky",
        qualityLevel: "sky",
        source: "netease",
        provenance: provenance({ nativeTier: "Sky", evidence: "response" }),
        quality: audio({ codec: "aac", bitRate: 400000 }),
      }),
    ).toBe(true);
  });

  it("QQ 全景声：品牌回执命中 → 通过（文件规格本身不证明空间档）", () => {
    expect(
      downloadQualityMeets({
        selection: "qqmusic:qq-spatial",
        qualityLevel: "sky",
        source: "qqmusic",
        provenance: provenance({ platform: "qqmusic", nativeTier: "atmos" }),
        quality: audio({ codec: "aac", bitRate: 400000 }),
      }),
    ).toBe(true);
  });

  it("QQ 全景声2.0：atmos_plus 品牌回执命中 → 通过", () => {
    expect(
      downloadQualityMeets({
        selection: "qqmusic:qq-spatial-2.0",
        qualityLevel: "sky",
        source: "qqmusic",
        provenance: provenance({ platform: "qqmusic", nativeTier: "atmos_plus" }),
        quality: audio({ codec: "aac", bitRate: 400000 }),
      }),
    ).toBe(true);
  });

  it.each([
    { selection: "qqmusic:qq-spatial", nativeTier: "atmos_plus" },
    { selection: "qqmusic:qq-spatial-2.0", nativeTier: "atmos" },
  ])("全景声 plain/plus 回执不得互相代替：%s + %s → 拒绝", ({ selection, nativeTier }) => {
    expect(
      downloadQualityMeets({
        selection,
        qualityLevel: "sky",
        source: "qqmusic",
        provenance: provenance({ platform: "qqmusic", nativeTier }),
        quality: audio({ codec: "aac", bitRate: 400000 }),
      }),
    ).toBe(false);
  });

  it.each(["qqmusic:qq-spatial", "qqmusic:qq-spatial-2.0"])(
    "QQ 全景声 %s：无解析依据 → 拒绝",
    (selection) => {
      expect(
        downloadQualityMeets({
          selection,
          qualityLevel: "sky",
          source: "qqmusic",
          quality: audio({ codec: "aac", bitRate: 400000 }),
        }),
      ).toBe(false);
    },
  );

  it.each(masterReceipts)(
    "臻品母带：回执 %s + 24bit/192kHz 文件按同一 canonical 品牌达标",
    (nativeTier) => {
      expect(
        downloadQualityMeets({
          selection: "qqmusic:master",
          qualityLevel: "jymaster",
          source: "qqmusic",
          provenance: provenance({ platform: "qqmusic", nativeTier }),
          quality: audio({ sampleRate: 192000, bitsPerSample: 24 }),
        }),
      ).toBe(true);
    },
  );

  it.each(masterReceipts)(
    "臻品母带：回执 %s + 16bit/44.1kHz 文件低于母带物理下限 → 拒绝",
    (nativeTier) => {
      expect(
        downloadQualityMeets({
          selection: "qqmusic:master",
          qualityLevel: "jymaster",
          source: "qqmusic",
          provenance: provenance({ platform: "qqmusic", nativeTier }),
          quality: audio({}),
        }),
      ).toBe(false);
    },
  );

  it("臻品母带：request 回显不构成档位证据 → 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "qqmusic:master",
        qualityLevel: "jymaster",
        source: "qqmusic",
        provenance: provenance({ platform: "qqmusic", nativeTier: "master", evidence: "request" }),
        quality: audio({ sampleRate: 192000, bitsPerSample: 24 }),
      }),
    ).toBe(false);
  });

  it("臻品母带：旧 4.0 选择与 canonical master 接受同一别名回执", () => {
    expect(
      downloadQualityMeets({
        selection: "qqmusic:qq-master-4.0",
        qualityLevel: "jymaster",
        source: "qqmusic",
        provenance: provenance({ platform: "qqmusic", nativeTier: "臻品母带4.0" }),
        quality: audio({ sampleRate: 192000, bitsPerSample: 24 }),
      }),
    ).toBe(true);
  });

  it.each(["qqmusic:qq-premium-2.0", "kuwo:kuwo-premium-2.0", "kuwo:kuwo-spatial", "kuwo:hires"])(
    "已下线的 QQ 旧臻品/酷我旧档选择 %s 不再合法 → 拒绝",
    (selection) => {
      const platform = selection.startsWith("kuwo") ? "kuwo" : "qqmusic";
      expect(
        downloadQualityMeets({
          selection,
          qualityLevel: selection === "kuwo:hires" ? "hi-res" : "sky",
          source: platform,
          provenance: provenance({ platform, nativeTier: "master" }),
          quality: audio({ sampleRate: 96000, bitsPerSample: 24 }),
        }),
      ).toBe(false);
    },
  );

  it("酷狗母带按已确认品牌档位和最低规格校验，不误套通用 Master192 门槛", () => {
    const check = {
      selection: "kugou:kugou-master",
      qualityLevel: "jymaster" as const,
      source: "kugou",
      quality: audio({ sampleRate: 96000, bitsPerSample: 24 }),
      provenance: provenance({ platform: "kugou", nativeTier: "master", level: "jymaster" }),
    };
    expect(downloadQualityMeets(check)).toBe(true);
    expect(downloadQualityMeets({ ...check, provenance: undefined })).toBe(false);
    expect(downloadQualityMeets({ ...check, quality: audio({}) })).toBe(false);
  });

  it("升级目标边界：无损目标 + 有损 320k → 拒绝", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:lossless",
        qualityLevel: "lossless",
        source: "netease",
        quality: audio({ codec: "mp3", bitRate: 320000 }),
      }),
    ).toBe(false);
  });

  it("升级目标边界：无损目标 + CD 规格无损 → 通过", () => {
    expect(
      downloadQualityMeets({
        selection: "netease:lossless",
        qualityLevel: "lossless",
        source: "netease",
        quality: audio({}),
      }),
    ).toBe(true);
  });
});
