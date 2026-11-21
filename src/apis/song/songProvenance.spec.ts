import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  neteaseCall: vi.fn(),
  qqmusicCall: vi.fn(),
  kugouCall: vi.fn(),
  kuwoCall: vi.fn(),
}));
vi.mock("@/apis/netease", () => ({ netease: {}, neteaseCall: mocks.neteaseCall }));
vi.mock("@/apis/neteaseAuth", () => ({ isExplicitNeteaseAuthFailure: () => true }));
vi.mock("@/utils/format/netease", () => ({ songsToTracks: () => [] }));
vi.mock("@/apis/qqmusic", () => ({ qqmusicCall: mocks.qqmusicCall }));
vi.mock("@/apis/kugou", () => ({ kugouCall: mocks.kugouCall }));
vi.mock("@/apis/kuwo", () => ({ kuwoCall: mocks.kuwoCall }));
import { classifyNeteasePlayUrl, resolveNeteaseUrl } from "./netease";
import { resolveQQMusicUrl } from "./qqmusic";
import { resolveKugouUrl } from "./kugou";
import { resolveKuwoUrl } from "./kuwo";

/** 通用在线平台曲目 */
const baseTrack = (extra: Partial<Track> = {}): Track => ({
  id: "1",
  title: "test",
  source: "netease",
  artists: [],
  duration: 1000,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("网易云官方响应证据", () => {
  it("响应 level 映射档位并保留原生档位原文", () => {
    const res = classifyNeteasePlayUrl({
      url: "https://m/song",
      freeTrialInfo: null,
      level: "exhigh",
    });
    expect(res).toEqual({
      available: true,
      url: "https://m/song",
      isTrial: false,
      level: "hq",
      qualityProvenance: {
        provider: "official",
        platform: "netease",
        evidence: "response",
        nativeTier: "exhigh",
        level: "hq",
      },
    });
  });

  it("响应缺 level 时只保留通道证据", () => {
    const res = classifyNeteasePlayUrl({ url: "https://m/song", freeTrialInfo: null });
    expect(res).toEqual({
      available: true,
      url: "https://m/song",
      isTrial: false,
      level: undefined,
      qualityProvenance: {
        provider: "official",
        platform: "netease",
        evidence: "response",
      },
    });
  });

  it("不可播放结果不带来源证据", () => {
    const res = classifyNeteasePlayUrl({ url: null, fee: 1 });
    expect(res).toEqual({ available: false, errorCode: ErrorCode.NETEASE_VIP_REQUIRED });
  });

  it("登录恢复重试沿用响应证据归类", async () => {
    mocks.neteaseCall.mockRejectedValueOnce(new Error("301"));
    mocks.neteaseCall.mockResolvedValueOnce({
      data: [{ url: "https://m/song", level: "lossless" }],
    });
    const res = await resolveNeteaseUrl(baseTrack(), "lossless", {
      authenticated: true,
      validate: async () => true,
    });
    expect(res).toMatchObject({ available: true, level: "lossless" });
    expect(res.available && res.qualityProvenance).toEqual({
      provider: "official",
      platform: "netease",
      evidence: "response",
      nativeTier: "lossless",
      level: "lossless",
    });
  });
});

describe("QQ 音乐文件名证据", () => {
  it("命中模板前缀作为原生档位，证据为 filename", async () => {
    mocks.qqmusicCall.mockResolvedValueOnce({
      code: 0,
      data: [{ id: "m1", url: "https://qq/song.flac", level: "sky", nativeTier: "RS01" }],
    });
    const res = await resolveQQMusicUrl(baseTrack({ source: "qqmusic", mediaId: "media1" }), "sky");
    expect(res).toEqual({
      available: true,
      url: "https://qq/song.flac",
      isTrial: false,
      level: "sky",
      qualityProvenance: {
        provider: "official",
        platform: "qqmusic",
        evidence: "filename",
        nativeTier: "RS01",
        level: "sky",
      },
    });
  });

  it("未知档位字符串时保留前缀证据、档位缺省", async () => {
    mocks.qqmusicCall.mockResolvedValueOnce({
      code: 0,
      data: [{ id: "m1", url: "https://qq/song.flac", level: "future-tier", nativeTier: "X999" }],
    });
    const res = await resolveQQMusicUrl(baseTrack({ source: "qqmusic", mediaId: "media1" }), "hq");
    expect(res).toMatchObject({ available: true, level: undefined });
    expect(res.available && res.qualityProvenance).toEqual({
      provider: "official",
      platform: "qqmusic",
      evidence: "filename",
      nativeTier: "X999",
    });
  });
});

describe("酷狗 / 酷我请求证据", () => {
  /** 无损曲目（clamp 后请求档即返回档） */
  const losslessTrack = (source: "kugou" | "kuwo"): Track =>
    baseTrack({
      source,
      id: source === "kugou" ? "e10adc3949ba59abbe56e057f20f883e" : "kw1",
      extId: "audio1",
      album: { id: "album1", name: "album" },
      quality: {
        codec: "flac",
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        bitRate: 900000,
      },
    });

  it("酷狗返回档为请求 clamp 档，证据 request 不虚构品牌档", async () => {
    mocks.kugouCall.mockResolvedValueOnce({ code: 200, data: { url: "https://kg/song" } });
    const res = await resolveKugouUrl(losslessTrack("kugou"), "lossless");
    expect(res).toEqual({
      available: true,
      url: "https://kg/song",
      isTrial: false,
      level: "lossless",
      qualityProvenance: {
        provider: "official",
        platform: "kugou",
        evidence: "request",
        level: "lossless",
      },
    });
  });

  it("酷我请求档封顶 sq 时证据 request 且档位为 clamp 档", async () => {
    mocks.kuwoCall.mockResolvedValueOnce({ code: 200, url: "https://kw/song" });
    const res = await resolveKuwoUrl(
      losslessTrack("kuwo"),
      // 无损曲目 clamp 到 lossless；请求更高档验证封顶
      "hi-res",
    );
    expect(res).toEqual({
      available: true,
      url: "https://kw/song",
      isTrial: false,
      level: "lossless",
      qualityProvenance: {
        provider: "official",
        platform: "kuwo",
        evidence: "request",
        level: "lossless",
      },
    });
  });

  it("解析失败不带来源证据", async () => {
    mocks.kuwoCall.mockResolvedValueOnce({ code: 500, message: "rejected" });
    const res = await resolveKuwoUrl(losslessTrack("kuwo"), "sq");
    expect(res).toEqual({ available: false, errorCode: ErrorCode.URL_RESOLVE_FAILED });
  });
});
