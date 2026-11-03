import { levelOfQuality } from "@shared/utils/quality";
import { describe, expect, it } from "vitest";
import { getQualityLevel } from "./quality";

/**
 * DSD 文件的档位判定
 *
 * 数据取自实测：probeTrackFile 对 DSD64 DSF 返回
 * codec=dsd_lsbf_planar / sampleRate=352800 / bitsPerSample=8。
 */
const dsd64 = {
  codec: "dsd_lsbf_planar",
  sampleRate: 352800,
  bitsPerSample: 8,
  bitRate: 5644800,
  channels: 2,
};

describe("DSD 档位判定", () => {
  it("主进程与渲染层对 DSD 给出相同结论", () => {
    expect(levelOfQuality(dsd64)).toBe(getQualityLevel(dsd64));
  });

  it("DSD64 判为 lossless 家族（不是 lq/hq 这类有损档）", () => {
    const level = levelOfQuality(dsd64);
    expect(["lossless", "hi-res", "jymaster"]).toContain(level);
  });
});
