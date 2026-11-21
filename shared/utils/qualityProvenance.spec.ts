import { describe, expect, it } from "vitest";
import type { AudioQuality } from "../types/player";
import type { QualityProvenance } from "../types/quality";
import { levelMeets } from "./quality";
import {
  platformFromSourceKey,
  provenanceFromPlugin,
  resolveQualityBadge,
  validateQualityProvenance,
} from "./qualityProvenance";

const masterFile: AudioQuality = {
  codec: "flac",
  sampleRate: 192000,
  bitsPerSample: 24,
  bitRate: 6000000,
  channels: 2,
};
const losslessFile: AudioQuality = { ...masterFile, sampleRate: 44100, bitsPerSample: 16 };

/** 构造官方或插件响应明确声明的平台档位 */
const declared = (
  platform: QualityProvenance["platform"],
  nativeTier: string,
): QualityProvenance => ({
  provider: "plugin",
  platform,
  nativeTier,
  evidence: "plugin",
  level: "jymaster",
  pluginId: "p",
});

describe("平台音质标识依据", () => {
  it("相同规格可以显示通用 Master，但不能推断属于同一品牌", () => {
    expect(resolveQualityBadge(masterFile, undefined)).toEqual({
      level: "jymaster",
      platform: undefined,
      tier: undefined,
      mismatch: false,
    });
    expect(resolveQualityBadge(masterFile, declared("netease", "jymaster")).tier).toBe(
      "netease-master",
    );
    expect(resolveQualityBadge(masterFile, declared("qqmusic", "臻品母带 2.0")).tier).toBe(
      "qq-master",
    );
    expect(resolveQualityBadge(masterFile, declared("kuwo", "至臻母带")).tier).toBe("kuwo-master");
    expect(resolveQualityBadge(masterFile, declared("migu", "至臻母带音质")).tier).toBe(
      "migu-master",
    );
  });

  it.each(["qq-master-4.0", "臻品母带4.0", "臻品母带 4.0"])(
    "QQ 明确回执 %s 识别为 4.0，不能从请求或其他平台推定",
    (nativeTier) => {
      expect(resolveQualityBadge(masterFile, declared("qqmusic", nativeTier))).toMatchObject({
        tier: "qq-master-4",
        level: "jymaster",
        mismatch: false,
      });
      expect(
        resolveQualityBadge(masterFile, { ...declared("qqmusic", nativeTier), evidence: "request" })
          .tier,
      ).toBeUndefined();
      expect(resolveQualityBadge(masterFile, declared("netease", nativeTier)).tier).toBeUndefined();
      expect(resolveQualityBadge(losslessFile, declared("qqmusic", nativeTier))).toMatchObject({
        tier: undefined,
        mismatch: true,
      });
    },
  );

  it.each([
    ["atmos", "qq-spatial"],
    ["atmos_plus", "qq-spatial-2"],
    ["qq-spatial-2.0", "qq-spatial-2"],
    ["臻品全景声 2.0", "qq-spatial-2"],
  ])("QQ 实际回执 %s 精确区分两种全景声", (nativeTier, tier) => {
    const info = { ...declared("qqmusic", nativeTier), level: "sky" as const };
    expect(resolveQualityBadge(losslessFile, info)).toMatchObject({
      level: "sky",
      tier,
      mismatch: false,
    });
    expect(
      resolveQualityBadge(losslessFile, { ...info, evidence: "request" }).tier,
    ).toBeUndefined();
  });

  it("插件品牌名与历史文件来源分别保留", () => {
    expect(resolveQualityBadge(masterFile, declared("kuwo", "大师音质")).tier).toBe(
      "kuwo-master-quality",
    );
    expect(
      resolveQualityBadge({ ...masterFile, sampleRate: 96000 }, declared("kugou", "蝰蛇超清")).tier,
    ).toBe("kugou-master");
    expect(
      resolveQualityBadge(losslessFile, { ...declared("kugou", "蝰蛇全景声"), level: "sky" }).tier,
    ).toBe("kugou-spatial");
    expect(resolveQualityBadge(masterFile, declared("migu", "至臻母带音质")).tier).toBe(
      "migu-master",
    );
    expect(
      resolveQualityBadge(masterFile, { ...declared("kuwo", "kuwo-premium-2.0"), level: "sky" })
        .tier,
    ).toBe("kuwo-premium");
  });

  it("QQ 通用母带回执保留品牌，不自动冒充 4.0", () => {
    const info = provenanceFromPlugin(
      {
        url: "https://audio/file",
        nativeTier: "master",
        quality: "jymaster",
        sourceEvidence: "gzPlayback-v1",
      },
      "em",
      "tx",
    );
    expect(resolveQualityBadge(masterFile, info).tier).toBe("qq-master");
  });

  it.each([176400, 192000])(
    "实测本地 24bit/%iHz 恢复 Master，目录声明仍不冒充实测",
    (sampleRate) => {
      const quality = { ...masterFile, sampleRate };
      expect(resolveQualityBadge(quality, undefined, true)).toMatchObject({
        level: "jymaster",
        tier: undefined,
        platform: undefined,
      });
      expect(resolveQualityBadge(quality, undefined, false)).toMatchObject({
        level: "hi-res",
        tier: undefined,
      });
      expect(resolveQualityBadge({ ...quality, sampleRate: 96000 }, undefined, true).level).toBe(
        "hi-res",
      );
    },
  );

  it("不从统一的 master 请求或歌曲目录来源推断专属品牌", () => {
    expect(
      resolveQualityBadge(masterFile, { ...declared("qqmusic", "master"), evidence: "request" })
        .tier,
    ).toBeUndefined();
    expect(
      resolveQualityBadge(masterFile, { ...declared("netease", "jymaster"), evidence: "request" })
        .tier,
    ).toBeUndefined();
    expect(
      resolveQualityBadge(masterFile, { ...declared("netease", "jymaster"), evidence: "catalog" })
        .tier,
    ).toBeUndefined();
    expect(
      resolveQualityBadge(masterFile, { ...declared(undefined, "jymaster") }).tier,
    ).toBeUndefined();
  });

  it.each(["Q000", "RS01"])("未经认证的 QQ 文件前缀 %s 不能证明臻品档位", (nativeTier) => {
    const info: QualityProvenance = {
      ...declared("qqmusic", nativeTier),
      provider: "official",
      evidence: "filename",
    };
    expect(resolveQualityBadge(masterFile, info).tier).toBeUndefined();
  });

  it("插件回包里的真实平台优先于目录请求，但旧插件不制造平台归属", () => {
    const legacy = provenanceFromPlugin(
      { url: "https://cdn/song.flac", quality: "jymaster", requestedTier: "master" },
      "lx",
      "wy",
    );
    expect(legacy).toMatchObject({
      provider: "plugin",
      sourceKey: "wy",
      evidence: "request",
      requestedTier: "master",
    });
    expect(legacy.platform).toBeUndefined();
    expect(resolveQualityBadge(masterFile, legacy).tier).toBeUndefined();
    const explicit = provenanceFromPlugin(
      {
        url: "https://cdn/song.flac",
        quality: "jymaster",
        actualSource: "tx",
        nativeTier: "臻品母带2.0",
      },
      "resolver",
      "wy",
    );
    expect(explicit.platform).toBe("qqmusic");
    expect(resolveQualityBadge(masterFile, explicit).tier).toBe("qq-master");
  });

  it("QQ Hi-Res 返回 192kHz 仍使用确认的 Hi-Res 档位，本地未知文件保持 Master", () => {
    const info: QualityProvenance = {
      provider: "official",
      platform: "qqmusic",
      nativeTier: "AI00",
      level: "hi-res",
      evidence: "filename",
    };
    expect(resolveQualityBadge(masterFile, info)).toMatchObject({
      level: "hi-res",
      platform: "qqmusic",
      tier: undefined,
    });
    expect(resolveQualityBadge(masterFile, undefined).level).toBe("jymaster");
  });

  it("版本化插件回执确认来源通道及实际档位，请求目标单独保存", () => {
    const info = provenanceFromPlugin(
      {
        url: "https://audio/file",
        quality: "hi-res",
        sourceEvidence: "gzPlayback-v1",
        nativeTier: "hires",
        requestedTier: "flac24bit",
        requestedSelection: "qqmusic:AI00",
      },
      "em",
      "tx",
    );
    expect(info).toMatchObject({
      platform: "qqmusic",
      platformEvidence: "source",
      nativeTier: "hires",
      requestedTier: "flac24bit",
      requestedSelection: "qqmusic:AI00",
      evidence: "plugin",
    });
    expect(resolveQualityBadge(masterFile, info).level).toBe("hi-res");
    const master = provenanceFromPlugin(
      {
        url: "https://audio/file",
        quality: "jymaster",
        sourceEvidence: "gzPlayback-v1",
        nativeTier: "master",
        requestedTier: "master",
      },
      "em",
      "kg",
    );
    expect(resolveQualityBadge({ ...masterFile, sampleRate: 96000 }, master)).toMatchObject({
      tier: "kugou-master",
      mismatch: false,
    });
  });

  it("母带声明与实测文件矛盾时显示实测规格，不显示母带", () => {
    expect(resolveQualityBadge(losslessFile, declared("netease", "jymaster"))).toMatchObject({
      level: "lossless",
      tier: undefined,
      mismatch: true,
    });
    expect(
      resolveQualityBadge({ ...masterFile, sampleRate: 96000 }, declared("qqmusic", "臻品母带2.0")),
    ).toMatchObject({ level: "hi-res", tier: undefined, mismatch: true });
  });

  it("空间音频需要原生档位依据，立体声解码参数不等于空间音频失效", () => {
    const info = { ...declared("netease", "sky"), level: "sky" as const };
    expect(resolveQualityBadge(losslessFile, info)).toMatchObject({
      tier: "netease-sky",
      level: "sky",
      mismatch: false,
    });
    expect(
      resolveQualityBadge(losslessFile, { ...info, evidence: "request" }).tier,
    ).toBeUndefined();
  });

  it("目录规格不当作实测矛盾，实际文件校验仍然严格", () => {
    const info = declared("netease", "jymaster");
    expect(resolveQualityBadge(losslessFile, info, false).mismatch).toBe(false);
    expect(levelMeets(losslessFile, "jymaster")).toBe(false);
    expect(levelMeets(masterFile, "jymaster")).toBe(true);
  });
});

describe("来源信息跨进程校验", () => {
  it.each([undefined, null, {}, { provider: "official", evidence: "fabricated" }])(
    "丢弃无效来源 %j",
    (input) => {
      expect(validateQualityProvenance(input)).toBeUndefined();
    },
  );

  it("仅保留有限长度的已知字段，不把 URL 或其他插件数据带入保存记录", () => {
    expect(
      validateQualityProvenance({
        ...declared("kuwo", "至臻母带"),
        url: "https://secret",
        nativeTier: "x".repeat(1000),
        level: "premium",
      }),
    ).toEqual({ provider: "plugin", platform: "kuwo", pluginId: "p", evidence: "plugin" });
  });

  it("来源别名只匹配确切平台键", () => {
    expect(platformFromSourceKey("tx")).toBe("qqmusic");
    expect(platformFromSourceKey(" KW ")).toBe("kuwo");
    expect(platformFromSourceKey("netease")).toBe("netease");
    expect(platformFromSourceKey("custom-source")).toBeUndefined();
    expect(platformFromSourceKey("https://qq.com/audio")).toBeUndefined();
  });
});
