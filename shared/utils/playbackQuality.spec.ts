import { describe, expect, it } from "vitest";
import type { AudioQuality } from "../types/player";
import type { QualityProvenance } from "../types/quality";
import { assessPlaybackQuality } from "./playbackQuality";

const hires: AudioQuality = {
  codec: "flac",
  sampleRate: 96000,
  bitsPerSample: 24,
  channels: 2,
  bitRate: 3000000,
};
const lossless: AudioQuality = { ...hires, sampleRate: 44100, bitsPerSample: 16 };
const source = (
  platform: QualityProvenance["platform"],
  nativeTier: string,
  level: QualityProvenance["level"],
): QualityProvenance => ({
  provider: "plugin",
  platform,
  nativeTier,
  level,
  evidence: "plugin",
  platformEvidence: "source",
});

describe("实际播放档位验证", () => {
  it("QQ Hi-Res 的 192kHz 文件满足 Hi-Res 请求，但不修改请求目标", () => {
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:AI00",
        source: "official",
        quality: { ...hires, sampleRate: 192000 },
        provenance: {
          ...source("qqmusic", "AI00", "hi-res"),
          evidence: "filename",
          provider: "official",
        },
      }),
    ).toMatchObject({ selection: "qqmusic:AI00", state: "met" });
  });

  it.each(["migu:hires", "netease:hires"])("%s 请求返回普通无损为未达标", (selection) => {
    expect(
      assessPlaybackQuality({
        selection,
        source: "plugin",
        quality: lossless,
        provenance: source("migu", "flac", "lossless"),
      }),
    ).toMatchObject({ state: "below", actualLevel: "lossless" });
  });

  it("legacy migu:migu-premium 选择按 alias 映射 hires 目标", () => {
    expect(
      assessPlaybackQuality({
        selection: "migu:migu-premium",
        source: "plugin",
        quality: lossless,
        provenance: source("migu", "flac", "lossless"),
      }),
    ).toMatchObject({ selection: "migu:hires", state: "below" });
  });

  it("酷狗确认的品牌母带可以是 96kHz，但不能仅凭请求回显认定母带", () => {
    const check = {
      selection: "kugou:kugou-master",
      source: "plugin",
      quality: hires,
      provenance: source("kugou", "master", "jymaster"),
    };
    expect(assessPlaybackQuality(check).state).toBe("met");
    expect(
      assessPlaybackQuality({
        ...check,
        provenance: {
          ...check.provenance,
          nativeTier: undefined,
          requestedTier: "master",
          evidence: "request",
        },
      }).state,
    ).toBe("unconfirmed");
    expect(assessPlaybackQuality({ ...check, quality: lossless }).state).toBe("below");
  });

  it("提供者明确报告低档时不把技术高规格当成请求达标", () => {
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:AI00",
        source: "plugin",
        quality: hires,
        provenance: source("qqmusic", "flac", "lossless"),
      }).state,
    ).toBe("below");
  });

  it("QQ 全景声档位需要准确回执，采样率不能证明", () => {
    expect(
      assessPlaybackQuality({ selection: "qqmusic:qq-spatial", source: "plugin", quality: hires })
        .state,
    ).toBe("unconfirmed");
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:qq-spatial",
        source: "plugin",
        quality: lossless,
        provenance: source("qqmusic", "atmos", "sky"),
      }).state,
    ).toBe("met");
  });

  it("QQ 全景声 plain 与 plus 各认各的品牌回执，不得互相代替", () => {
    // plus 选择的 2.0 回执
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:qq-spatial-2.0",
        source: "plugin",
        quality: lossless,
        provenance: source("qqmusic", "atmos_plus", "sky"),
      }).state,
    ).toBe("met");
    // 普通全景声回执不能点亮 2.0
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:qq-spatial-2.0",
        source: "plugin",
        quality: lossless,
        provenance: source("qqmusic", "atmos", "sky"),
      }).state,
    ).toBe("unconfirmed");
    // 2.0 回执也不能冒充普通全景声
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:qq-spatial",
        source: "plugin",
        quality: lossless,
        provenance: source("qqmusic", "atmos_plus", "sky"),
      }).state,
    ).toBe("unconfirmed");
  });

  it("臻品母带4.0：精确 4 回执 + 母带规格文件达标", () => {
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:qq-master-4.0",
        source: "plugin",
        quality: { ...hires, sampleRate: 176400 },
        provenance: source("qqmusic", "qq-master-4.0", "jymaster"),
      }).state,
    ).toBe("met");
  });

  it.each(["master", "qq-master-2.0"])(
    "臻品母带4.0：回执 %s 只归一母带品牌，不冒充 4.0 达标",
    (nativeTier) => {
      expect(
        assessPlaybackQuality({
          selection: "qqmusic:qq-master-4.0",
          source: "plugin",
          quality: { ...hires, sampleRate: 176400 },
          provenance: source("qqmusic", nativeTier, "jymaster"),
        }).state,
      ).toBe("unconfirmed");
    },
  );

  it.each([
    { name: "CD 规格无损", quality: lossless },
    { name: "Hi-Res 规格（不足母带）", quality: hires },
  ])("臻品母带4.0：$name 未达最低母带规格 → 未达标", ({ quality }) => {
    expect(
      assessPlaybackQuality({
        selection: "qqmusic:qq-master-4.0",
        source: "plugin",
        quality,
        provenance: source("qqmusic", "qq-master-4.0", "jymaster"),
      }).state,
    ).toBe("below");
  });

  it.each(["qqmusic:qq-premium-2.0", "kuwo:kuwo-premium-2.0", "kuwo:kuwo-spatial", "kuwo:hires"])(
    "已下线的 QQ 旧臻品/酷我旧档选择 %s 不再合法 → 拒绝",
    (selection) => {
      expect(() =>
        assessPlaybackQuality({
          selection,
          source: "plugin",
          quality: hires,
          provenance: source("qqmusic", "excellent2", "sky"),
        }),
      ).toThrow();
    },
  );

  it.each(["local", "download", "streaming", "trial"])(
    "%s 不由在线目标验证器改写或拒绝",
    (provider) => {
      expect(
        assessPlaybackQuality({ selection: "qqmusic:AI00", source: provider, quality: lossless })
          .state,
      ).toBe("unconfirmed");
    },
  );

  it("缺少原始文件参数时只标未确认", () => {
    expect(
      assessPlaybackQuality({
        selection: "migu:migu-premium",
        source: "plugin",
        provenance: source("migu", "hires", "hi-res"),
      }).state,
    ).toBe("unconfirmed");
  });
});
