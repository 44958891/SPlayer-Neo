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
