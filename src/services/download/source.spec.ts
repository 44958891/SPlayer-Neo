import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  resolveByPluginBest: vi.fn(),
}));

vi.mock("@/services/audioSource", () => ({
  resolveByPluginBest: mocks.resolveByPluginBest,
}));

import { resolveDownloadSource } from "./source";
import { ErrorCode } from "@shared/types/errors";

const trackOf = (source: Track["source"]): Track => ({
  id: `${source}-1`,
  source,
  title: "歌",
  artists: [{ id: "a", name: "歌手" }],
  duration: 200000,
});

beforeEach(() => {
  mocks.resolveByPluginBest.mockReset();
  mocks.resolveByPluginBest.mockResolvedValue({
    ok: true,
    url: "https://example.com/a.flac",
    isTrial: false,
    provider: "plugin",
  });
});

describe("下载源解析的音质目标映射", () => {
  it("平台具体选择透传为解析器第五参，档位取自目录", async () => {
    const res = await resolveDownloadSource(trackOf("netease"), "hq", "netease:lossless");
    expect(res.ok).toBe(true);
    expect(mocks.resolveByPluginBest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "netease" }),
      "lossless",
      [],
      true,
      "netease:lossless",
    );
  });

  it("旧通用档位映射本平台目标：migu 的 hi-res 目标（canonical migu:hires）", async () => {
    await resolveDownloadSource(trackOf("migu"), "hi-res");
    expect(mocks.resolveByPluginBest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "migu" }),
      "hi-res",
      [],
      true,
      "migu:hires",
    );
  });

  it("legacy migu:migu-premium 存档选择按 alias 落到 hires 目标", async () => {
    const res = await resolveDownloadSource(trackOf("migu"), "hq", "migu:migu-premium");
    expect(res.ok).toBe(true);
    expect(mocks.resolveByPluginBest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "migu" }),
      "hi-res",
      [],
      true,
      "migu:hires",
    );
  });

  it("环绕声目标落到无环绕声平台（QQ）→ DOWNLOAD_QUALITY_NOT_MET，不调用解析器", async () => {
    const res = await resolveDownloadSource(trackOf("qqmusic"), "jyeffect");
    expect(res).toEqual({ ok: false, errorCode: ErrorCode.DOWNLOAD_QUALITY_NOT_MET });
    expect(mocks.resolveByPluginBest).not.toHaveBeenCalled();
  });

  it("不匹配当前平台的显式选择直接拒绝，不静默变成另一档位", async () => {
    const result = await resolveDownloadSource(trackOf("qqmusic"), "hq", "netease:sky");
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.DOWNLOAD_QUALITY_NOT_MET });
    expect(mocks.resolveByPluginBest).not.toHaveBeenCalled();
  });

  it("解析器失败与试听拒绝按原因码带出", async () => {
    mocks.resolveByPluginBest.mockResolvedValue({
      ok: false,
      errorCode: ErrorCode.NO_PLUGIN_AVAILABLE,
    });
    const res = await resolveDownloadSource(trackOf("kugou"), "hq");
    expect(res).toEqual({ ok: false, errorCode: ErrorCode.NO_PLUGIN_AVAILABLE });
  });

  it("流媒体曲目直接取流地址不走插件", async () => {
    const track = trackOf("streaming");
    track.serverId = "srv";
    track.originalId = "orig";
    const res = await resolveDownloadSource(track, "hq");
    expect(res.ok).toBe(true);
    expect(mocks.resolveByPluginBest).not.toHaveBeenCalled();
  });
});
