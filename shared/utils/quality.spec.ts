import { describe, expect, it } from "vitest";
import { levelMeets, levelOfQuality, qualityRank, QUALITY_ORDER } from "./quality";

describe("levelOfQuality（与渲染端同名函数同口径）", () => {
  it("24bit 192k → 母带", () => {
    expect(
      levelOfQuality({
        codec: "flac",
        sampleRate: 192000,
        bitsPerSample: 24,
        bitRate: 0,
        channels: 2,
      }),
    ).toBe("jymaster");
  });
  it("24bit 96k → Hi-Res", () => {
    expect(
      levelOfQuality({
        codec: "flac",
        sampleRate: 96000,
        bitsPerSample: 24,
        bitRate: 0,
        channels: 2,
      }),
    ).toBe("hi-res");
  });
  it("16bit 44.1k flac → Lossless", () => {
    expect(
      levelOfQuality({
        codec: "flac",
        sampleRate: 44100,
        bitsPerSample: 16,
        bitRate: 900000,
        channels: 2,
      }),
    ).toBe("lossless");
  });
  it("320k mp3 → HQ", () => {
    expect(
      levelOfQuality({
        codec: "mp3",
        sampleRate: 44100,
        bitsPerSample: 16,
        bitRate: 320000,
        channels: 2,
      }),
    ).toBe("hq");
  });
  it("128k mp3 → LQ", () => {
    expect(
      levelOfQuality({
        codec: "mp3",
        sampleRate: 44100,
        bitsPerSample: 16,
        bitRate: 128000,
        channels: 2,
      }),
    ).toBe("lq");
  });
  it("无编解码器 → LQ（无效文件）", () => {
    expect(levelOfQuality(undefined)).toBe("lq");
    expect(
      levelOfQuality({
        codec: "unknown",
        sampleRate: 0,
        bitsPerSample: 0,
        bitRate: 0,
        channels: 0,
      }),
    ).toBe("lq");
  });
});

describe("levelMeets（下载校验核心）", () => {
  const lossless16 = {
    codec: "flac",
    sampleRate: 44100,
    bitsPerSample: 16,
    bitRate: 900000,
    channels: 2,
  };
  const master = { codec: "flac", sampleRate: 192000, bitsPerSample: 24, bitRate: 0, channels: 2 };
  const mp3_128 = {
    codec: "mp3",
    sampleRate: 44100,
    bitsPerSample: 16,
    bitRate: 128000,
    channels: 2,
  };

  it("无损替换无损 → 达标", () => {
    expect(levelMeets(lossless16, "lossless")).toBe(true);
  });
  it("母带替换无损 → 达标", () => {
    expect(levelMeets(master, "lossless")).toBe(true);
  });
  it("128k mp3 替换无损原文件 → 不达标（本次事故的判据）", () => {
    expect(levelMeets(mp3_128, "lossless")).toBe(false);
  });
  it("96k/24 替换 192k/24 原文件 → 不达标", () => {
    const hires = { codec: "flac", sampleRate: 96000, bitsPerSample: 24, bitRate: 0, channels: 2 };
    expect(levelMeets(hires, "jymaster")).toBe(false);
  });
});

describe("QUALITY_ORDER / qualityRank", () => {
  it("顺序与渲染端一致", () => {
    expect(QUALITY_ORDER).toEqual([
      "lq",
      "sq",
      "hq",
      "lossless",
      "hi-res",
      "jyeffect",
      "sky",
      "jymaster",
    ]);
  });
  it("rank 单调递增", () => {
    expect(qualityRank("lq")).toBeLessThan(qualityRank("lossless"));
    expect(qualityRank("lossless")).toBeLessThan(qualityRank("jymaster"));
  });
});

/**
 * 下载音质不降级：用户选了高档位、音源只给低档位时必须判定不达标，
 * 下载管线据此报 DOWNLOAD_QUALITY_NOT_MET，而不是静默保存低音质文件。
 */
describe("levelMeets：所选档位未被满足时必须为 false", () => {
  const mk = (codec: string, sampleRate: number, bitsPerSample: number, bitRate: number) =>
    ({ codec, sampleRate, bitsPerSample, bitRate, channels: 2 }) as const;

  const MASTER = mk("flac", 192000, 24, 4608000);
  const HIRES = mk("flac", 96000, 24, 2304000);
  const LOSSLESS = mk("flac", 44100, 16, 1000000);
  const HQ = mk("mp3", 44100, 16, 320000);

  it("选母带时，Hi-Res / 无损 / 320k 都不算达标", () => {
    expect(levelMeets(MASTER, "jymaster")).toBe(true);
    expect(levelMeets(HIRES, "jymaster")).toBe(false);
    expect(levelMeets(LOSSLESS, "jymaster")).toBe(false);
    expect(levelMeets(HQ, "jymaster")).toBe(false);
  });

  it("选 Hi-Res 时，无损与 320k 不算达标，母带达标", () => {
    expect(levelMeets(HIRES, "hi-res")).toBe(true);
    expect(levelMeets(LOSSLESS, "hi-res")).toBe(false);
    expect(levelMeets(HQ, "hi-res")).toBe(false);
    expect(levelMeets(MASTER, "hi-res")).toBe(true);
  });

  it("选无损时，320k 不算达标", () => {
    expect(levelMeets(LOSSLESS, "lossless")).toBe(true);
    expect(levelMeets(HQ, "lossless")).toBe(false);
  });

  it("三平台母带档统一映射到宿主 jymaster，判定口径一致无冲突", () => {
    // QQ 臻品母带 2.0 / 网易超清母带 / 酷我大师 均落到 jymaster，
    // 谁取到的文件达标以实际位深+采样率为准，而不是以平台声明为准
    expect(qualityRank("jymaster")).toBeGreaterThan(qualityRank("hi-res"));
    expect(levelOfQuality(MASTER)).toBe("jymaster");
    expect(levelOfQuality(LOSSLESS)).not.toBe("jymaster");
  });
});
