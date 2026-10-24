import { describe, expect, it } from "vitest";
import { MIN_BYTES_PER_SEC, isTimeoutMessage, judgeProbe, parseContentSize } from "./audioProbe";

const headers = (over: Partial<Parameters<typeof judgeProbe>[0]> = {}) => ({
  status: 200,
  contentType: "audio/mpeg",
  sizeBytes: 8_000_000,
  ...over,
});

describe("judgeProbe 音频 URL 探针判定", () => {
  it("正常音频 + 体积充足 → 通过", () => {
    const v = judgeProbe(headers(), 240);
    expect(v.ok).toBe(true);
    expect(v.hard).toBe(false);
  });

  it("HTTP 4xx → 硬失败", () => {
    const v = judgeProbe(headers({ status: 403 }), 240);
    expect(v.ok).toBe(false);
    expect(v.hard).toBe(true);
    expect(v.message).toContain("403");
  });

  it("返回 HTML 页面（防盗链）→ 硬失败", () => {
    const v = judgeProbe(headers({ contentType: "text/html; charset=utf-8" }), 240);
    expect(v.ok).toBe(false);
    expect(v.hard).toBe(true);
    expect(v.message).toContain("非音频");
  });

  it("octet-stream 视为可接受（未配 MIME 的 CDN）", () => {
    expect(judgeProbe(headers({ contentType: "application/octet-stream" }), 240).ok).toBe(true);
  });

  it("无 Content-Type 但 URL 是 .flac → 通过", () => {
    const v = judgeProbe(
      headers({ contentType: null, finalUrl: "https://cdn.example.com/a/b.flac?token=x" }),
      240,
    );
    expect(v.ok).toBe(true);
  });

  it("无 Content-Type 且 URL 非音频 → 硬失败", () => {
    const v = judgeProbe(
      headers({ contentType: null, finalUrl: "https://cdn.example.com/play" }),
      240,
    );
    expect(v.ok).toBe(false);
  });

  it("30s 试听片段（体积远低于时长地板）→ 硬失败并提示", () => {
    // 4 分钟歌曲，只有 0.5MB ≈ 16kbps
    const v = judgeProbe(headers({ sizeBytes: 500_000 }), 240);
    expect(v.ok).toBe(false);
    expect(v.hard).toBe(true);
    expect(v.message).toContain("试听片段");
  });

  it("时长未知（0）时跳过体积反推", () => {
    expect(judgeProbe(headers({ sizeBytes: 1000 }), 0).ok).toBe(true);
  });

  it("体积恰在地板上方（等于时长 × 8000）→ 通过", () => {
    const size = 240 * MIN_BYTES_PER_SEC;
    expect(judgeProbe(headers({ sizeBytes: size }), 240).ok).toBe(true);
    expect(judgeProbe(headers({ sizeBytes: size - 1 }), 240).ok).toBe(false);
  });
});

describe("parseContentSize 体积解析", () => {
  it("优先使用 content-range 总长", () => {
    expect(parseContentSize("bytes 0-0/39899545", "1")).toBe(39899545);
  });
  it("无 content-range 时用 content-length", () => {
    expect(parseContentSize(null, "12345")).toBe(12345);
    expect(parseContentSize(null, "12345", 200)).toBe(12345);
  });
  it("206 且无 content-range → 体积未知为 0（不得用分段长度顶替）", () => {
    // Range 请求下 content-length 是这一小段的长度（通常为 1），拿它当完整大小会误判成试听片段
    expect(parseContentSize(null, "1", 206)).toBe(0);
    expect(parseContentSize(null, "12345", 206)).toBe(0);
  });
  it("206 但带 content-range → 仍取总长", () => {
    expect(parseContentSize("bytes 0-0/39899545", "1", 206)).toBe(39899545);
  });
  it("两者都无 → 0", () => {
    expect(parseContentSize(null, null)).toBe(0);
  });
  it("异常值 → 0", () => {
    expect(parseContentSize(null, "abc")).toBe(0);
    expect(parseContentSize("bytes 0-0/*", null)).toBe(0);
  });
});

describe("isTimeoutMessage 超时判定", () => {
  it("中文超时 / timeout / aborted 均识别", () => {
    expect(isTimeoutMessage("请求超时")).toBe(true);
    expect(isTimeoutMessage("read tcp: i/o timeout")).toBe(true);
    expect(isTimeoutMessage("The operation was aborted due to timeout")).toBe(true);
    expect(isTimeoutMessage("无版权")).toBe(false);
  });
});
