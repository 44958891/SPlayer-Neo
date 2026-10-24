import { describe, expect, it } from "vitest";
import {
  CHECK_SONGS,
  MIN_BPS_BY_QUALITY,
  SOURCE_LABELS,
  checkSongKey,
  estimateBps,
  judgeBitrateMismatch,
  pickCheckQualities,
  summarizeChecks,
  type CheckPointResult,
} from "./sourceCheck";

describe("CHECK_SONGS 测试曲健壮性", () => {
  it("每个测试曲自带 source / songmid / 时长，且 source 与键一致", () => {
    for (const [key, song] of Object.entries(CHECK_SONGS)) {
      expect(song.source).toBe(key);
      expect(song.songmid.length).toBeGreaterThan(0);
      expect(song.durationSec).toBeGreaterThan(60);
      expect(song.interval).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("每首测试曲都有平台展示名", () => {
    for (const song of Object.values(CHECK_SONGS)) {
      expect(SOURCE_LABELS[song.source]).toBeTruthy();
    }
  });

  it("platform 与宿主口径一致（取链键 ${track.source}:${track.id} 同命名空间）", () => {
    expect(CHECK_SONGS.wy.platform).toBe("netease");
    expect(CHECK_SONGS.tx.platform).toBe("qqmusic");
    expect(CHECK_SONGS.kg.platform).toBe("kugou");
    expect(CHECK_SONGS.kw.platform).toBe("kuwo");
    expect(CHECK_SONGS.mg.platform).toBe("migu");
    expect(CHECK_SONGS.sd.platform).toBe("soda");
  });
});

describe("checkSongKey 曲目键", () => {
  it("用平台 key 而非插件源 key（与 resolveByPluginBest 同口径）", () => {
    expect(checkSongKey(CHECK_SONGS.kw)).toBe("kuwo:228908");
    expect(checkSongKey(CHECK_SONGS.wy)).toBe("netease:1330348068");
  });
});

describe("pickCheckQualities 档位挑选", () => {
  it("声明档位 ≤2 时全测", () => {
    expect(pickCheckQualities(["lq", "hq"])).toEqual(["hq", "lq"]);
  });

  it("多档时取最高档 + 无损档", () => {
    expect(pickCheckQualities(["lq", "hq", "lossless", "hi-res", "jymaster"])).toEqual([
      "jymaster",
      "lossless",
    ]);
  });

  it("声明数组顺序乱（sq 在末位）也按真实高低取最高档", () => {
    const picked = pickCheckQualities(["lq", "hq", "lossless", "hi-res", "jymaster", "sq"]);
    expect(picked[0]).toBe("jymaster");
    expect(picked).toContain("lossless");
  });

  it("无 lossless 时补一个次高档，保证两个测试点", () => {
    expect(pickCheckQualities(["lq", "sq", "hq"])).toEqual(["hq", "sq"]);
  });

  it("去重", () => {
    expect(pickCheckQualities(["hq", "hq", "lq"])).toEqual(["hq", "lq"]);
  });

  it("空数组不报错", () => {
    expect(pickCheckQualities([])).toEqual([]);
  });
});

describe("estimateBps 码率反推", () => {
  it("42.7MB / 288s ≈ 1243kbps", () => {
    expect(estimateBps(44771860, 288)).toBe(1243663);
  });
  it("体积或时长非正 → 0", () => {
    expect(estimateBps(0, 200)).toBe(0);
    expect(estimateBps(1000, 0)).toBe(0);
  });
});

describe("judgeBitrateMismatch 档位对照", () => {
  it("声明母带 + 实测 128k → 标出虚报", () => {
    const msg = judgeBitrateMismatch("jymaster", 128_000);
    expect(msg).toContain("jymaster");
    expect(msg).toContain("128kbps");
  });

  it("声明无损 + 实测 900k → 相符", () => {
    expect(judgeBitrateMismatch("lossless", 900_000)).toBe("");
  });

  it("实测码率未知（0）→ 跳过判定", () => {
    expect(judgeBitrateMismatch("jymaster", 0)).toBe("");
  });

  it("低档位地板低，320k mp3 声明 hq 相符", () => {
    expect(judgeBitrateMismatch("hq", 320_000)).toBe("");
  });

  it("各档位地板单调不减", () => {
    const order = ["lq", "sq", "hq", "lossless", "hi-res", "jymaster"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(MIN_BPS_BY_QUALITY[order[i]]).toBeGreaterThanOrEqual(MIN_BPS_BY_QUALITY[order[i - 1]]);
    }
  });
});

describe("summarizeChecks 汇总", () => {
  const point = (status: CheckPointResult["status"]): CheckPointResult => ({
    pluginId: "p",
    source: "wy",
    quality: "lossless",
    status,
    message: "",
    sizeBytes: 0,
    probedBps: 0,
    linkMs: 0,
    probeMs: 0,
  });

  it("按状态计数", () => {
    const s = summarizeChecks([
      point("ok"),
      point("ok"),
      point("mismatch"),
      point("hard"),
      point("soft"),
      point("unsupported"),
    ]);
    expect(s).toEqual({ total: 6, ok: 2, mismatch: 1, hard: 1, soft: 1, unsupported: 1 });
  });

  it("空列表全零", () => {
    expect(summarizeChecks([])).toEqual({
      total: 0,
      ok: 0,
      mismatch: 0,
      hard: 0,
      soft: 0,
      unsupported: 0,
    });
  });
});
