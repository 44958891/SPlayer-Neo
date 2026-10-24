import { describe, expect, it } from "vitest";
import type { AudioQuality } from "@shared/types/player";
import { getQualityLabel, getQualityLevel, isLosslessQuality, qualityMeets } from "./quality";

const mp3 = (bitRate: number): AudioQuality => ({
  codec: "mp3",
  sampleRate: 44100,
  bitsPerSample: 16,
  bitRate,
  channels: 2,
});

const flac = (sampleRate: number, bitsPerSample: number): AudioQuality => ({
  codec: "flac",
  sampleRate,
  bitsPerSample,
  bitRate: 1000000,
  channels: 2,
});

describe("getQualityLevel 流元数据探测", () => {
  it("24bit/192kHz 判为母带档（网易母带 / 本地母带文件）", () => {
    expect(getQualityLevel(flac(192000, 24))).toBe("jymaster");
    expect(getQualityLevel(flac(176400, 24))).toBe("jymaster");
    expect(getQualityLabel(flac(192000, 24))).toBe("Master");
  });

  it("24bit/96kHz 判为 Hi-Res，48k/24 以下仍为 Lossless", () => {
    expect(getQualityLevel(flac(96000, 24))).toBe("hi-res");
    expect(getQualityLevel(flac(48000, 24))).toBe("lossless");
    expect(getQualityLabel(flac(96000, 24))).toBe("Hi-Res");
  });

  it("16bit 无损判为 Lossless，有损按码率分档", () => {
    expect(getQualityLevel(flac(44100, 16))).toBe("lossless");
    expect(getQualityLevel(mp3(320000))).toBe("hq");
    expect(getQualityLevel(mp3(192000))).toBe("sq");
    expect(getQualityLevel(mp3(128000))).toBe("lq");
  });

  it("信息缺失回落 LQ，母带档仍算无损", () => {
    expect(getQualityLevel(undefined)).toBe("lq");
    expect(
      getQualityLevel({
        codec: "unknown",
        sampleRate: 0,
        bitsPerSample: 0,
        bitRate: 0,
        channels: 2,
      }),
    ).toBe("lq");
    expect(isLosslessQuality(flac(192000, 24))).toBe(true);
    expect(isLosslessQuality(flac(44100, 16))).toBe(true);
    expect(isLosslessQuality(mp3(320000))).toBe(false);
  });

  it("qualityMeets：实际档位未知视为满足，已知则按序比较", () => {
    expect(qualityMeets(undefined, "jymaster")).toBe(true);
    expect(qualityMeets("jymaster", "hi-res")).toBe(true);
    expect(qualityMeets("hi-res", "jymaster")).toBe(false);
  });
});
