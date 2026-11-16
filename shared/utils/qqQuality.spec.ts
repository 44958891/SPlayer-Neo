import { describe, expect, it } from "vitest";
import { getQQQualityCandidates } from "@shared/utils/qqQuality";

/**
 * QQ 音源档位降级链（测 shared 里的纯实现，主进程直接复用同一份）。
 *
 * 修复背景：模板原先只到 hi-res，选「臻品母带」时 findIndex 返回 -1、
 * 退化成整表，于是静默降回 hi-res——表现为「QQ 音源老是拿不到高档位」。
 */
describe("QQ 音源档位候选链", () => {
  it("选臻品母带时以 Q000 开头（不再从 hi-res 开始）", () => {
    const c = getQQQualityCandidates("jymaster");
    expect(c[0].prefix).toBe("Q000");
    expect(c[0].level).toBe("jymaster");
    expect(c.map((x) => x.level)).toEqual([
      "jymaster",
      "sky",
      "hi-res",
      "lossless",
      "hq",
      "sq",
      "lq",
    ]);
  });

  it("选无损时从 F000 开始，不会把请求浪费在母带上", () => {
    const c = getQQQualityCandidates("lossless");
    expect(c[0].prefix).toBe("F000");
    expect(c.map((x) => x.level)).toEqual(["lossless", "hq", "sq", "lq"]);
  });

  it("选 320k 时只请求 mp3/aac 及以下", () => {
    const c = getQQQualityCandidates("hq");
    expect(c[0].prefix).toBe("M800");
    expect(c.every((x) => x.ext === ".mp3" || x.ext === ".m4a")).toBe(true);
  });

  it("环绕声 jyeffect（QQ 无此实现）对齐到 sky，而不是退回全表", () => {
    const c = getQQQualityCandidates("jyeffect");
    expect(c[0].level).toBe("sky");
  });

  it("未知档位退化为完整链（从最高开始），不会崩溃", () => {
    const c = getQQQualityCandidates("something-new");
    expect(c[0].level).toBe("jymaster");
    expect(c.length).toBe(7);
  });

  it("每个候选前缀形如 字母+3位字母数字 且带扩展名（防拼出非法 filename）", () => {
    for (const level of ["jymaster", "sky", "hi-res", "lossless", "hq", "sq", "lq"]) {
      for (const c of getQQQualityCandidates(level)) {
        // Q000 / RS01 / AI00 / F000 / M800 / M500 / C400
        expect(c.prefix).toMatch(/^[A-Z][A-Z0-9]{3}$/);
        expect(c.ext).toMatch(/^\.\w+$/);
      }
    }
  });
});
