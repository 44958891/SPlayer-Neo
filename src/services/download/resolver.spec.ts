import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadResolvePayload } from "@shared/types/download";
import type { QualityProvenance } from "@shared/types/quality";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  resolveDownloadSource: vi.fn(),
  resolveDownloadLyric: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  t: vi.fn((key: string) => key),
  onResolve: vi.fn(),
  submitResolution: vi.fn(),
  failResolution: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/services/download/source", () => ({
  resolveDownloadSource: mocks.resolveDownloadSource,
}));
vi.mock("@/services/download/lyric", () => ({
  resolveDownloadLyric: mocks.resolveDownloadLyric,
}));
vi.mock("@/utils/lyric/serialize", () => ({ buildDownloadLyric: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n", () => ({ default: { global: { t: mocks.t } } }));

import { initDownloadResolver } from "./resolver";

/** onResolve 捕获到的实际回调 */
let captured: ((payload: DownloadResolvePayload) => void) | null = null;

beforeEach(() => {
  captured = null;
  mocks.onResolve.mockImplementation((cb: (payload: DownloadResolvePayload) => void) => {
    captured = cb;
    return mocks.unsubscribe;
  });
  window.api = {
    download: {
      onResolve: mocks.onResolve,
      submitResolution: mocks.submitResolution,
      failResolution: mocks.failResolution,
    },
  } as unknown as typeof window.api;
});

/** 构建主进程下发的解析请求载荷（歌词开关全关，聚焦 URL/原因码链路） */
const payload = (taskId: string): DownloadResolvePayload => ({
  taskId,
  track: { source: "qqmusic", id: "9", title: "song", artists: [], duration: 200000 },
  qualityLevel: "jymaster",
  qualitySelection: "qqmusic:master",
  tagOptions: {
    embedCover: false,
    embedMeta: false,
    embedLyric: false,
    writeLrc: false,
    saveTtml: false,
  },
  lyricFileFormat: "lrc",
});

describe("download:resolve 即时解析回传", () => {
  it.each([
    { label: "档位不达标", code: ErrorCode.DOWNLOAD_QUALITY_NOT_MET },
    { label: "探针拒绝", code: ErrorCode.SOURCE_PROBE_REJECTED },
    { label: "无插件", code: ErrorCode.NO_PLUGIN_AVAILABLE },
  ])("解析失败（$label）→ failResolution 第二参准确透传原因码", async ({ code }) => {
    mocks.resolveDownloadSource.mockResolvedValueOnce({ ok: false, errorCode: code });
    initDownloadResolver();
    captured!(payload("res-coded"));
    await vi.waitFor(() => expect(mocks.failResolution).toHaveBeenCalledTimes(1));
    // 第二参必须显式存在：回退成单参调用（原因码被丢弃）时此断言失败
    expect(mocks.failResolution).toHaveBeenCalledWith("res-coded", code);
    expect(mocks.submitResolution).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
  });

  it("解析抛未知异常 → failResolution 第二参显式为 undefined（按 UNKNOWN 兜底）", async () => {
    mocks.resolveDownloadSource.mockRejectedValueOnce(new Error("boom"));
    initDownloadResolver();
    captured!(payload("res-unknown"));
    await vi.waitFor(() => expect(mocks.failResolution).toHaveBeenCalledTimes(1));
    expect(mocks.failResolution).toHaveBeenCalledWith("res-unknown", undefined);
    expect(mocks.submitResolution).not.toHaveBeenCalled();
  });

  it("解析成功 → submitResolution 透传 URL/体积/provenance 且不报失败", async () => {
    const provenance: QualityProvenance = {
      provider: "plugin",
      pluginId: "em",
      sourceKey: "tx",
      platform: "qqmusic",
      nativeTier: "master",
      evidence: "plugin",
    };
    mocks.resolveDownloadSource.mockResolvedValueOnce({
      ok: true,
      url: "https://music/audio",
      size: 1024,
      qualityProvenance: provenance,
    });
    const unsubscribe = initDownloadResolver();
    captured!(payload("res-ok"));
    await vi.waitFor(() => expect(mocks.submitResolution).toHaveBeenCalledTimes(1));
    expect(mocks.submitResolution).toHaveBeenCalledWith(
      "res-ok",
      expect.objectContaining({
        url: "https://music/audio",
        declaredSize: 1024,
        qualityProvenance: provenance,
      }),
    );
    expect(mocks.failResolution).not.toHaveBeenCalled();
    // 订阅句柄原样保留：解析器返回的取消函数可直接退订
    unsubscribe();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
