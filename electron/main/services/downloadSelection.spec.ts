// @vitest-environment node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadRequest, DownloadTask } from "@shared/types/download";
import type { QualityProvenance } from "@shared/types/quality";
import { ErrorCode } from "@shared/types/errors";

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  downloadDir: "",
  cacheDir: "",
  probe: vi.fn(),
  writeTags: vi.fn(),
}));
vi.mock("@main/database/index", () => ({ getDb: () => state.db }));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => {
      const table: Record<string, unknown> = {
        "download.folderScheme": "none",
        "download.fileTemplate": "{title}",
        "download.overwritePolicy": "overwrite",
        "download.concurrency": 1,
        "download.skipExistingLocal": false,
      };
      return table[key];
    },
  },
}));
vi.mock("@main/utils/config", () => ({
  getDownloadDir: () => state.downloadDir,
  getCoverCacheDir: () => state.cacheDir,
  getAppCacheDir: () => state.cacheDir,
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@main/utils/logger", () => ({
  downloadLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@main/services/engine", () => ({
  getEngine: () => ({ probeTrackFile: state.probe, writeTrackTags: state.writeTags }),
}));
vi.mock("@main/utils/fetchBytes", () => ({ fetchBytes: vi.fn() }));
vi.mock("@main/services/streaming/mediaSource", () => ({
  resolveStreamingMediaSource: vi.fn(),
}));
import * as db from "@main/database/downloads";
import { broadcast } from "@main/utils/broadcast";
import { cancel, enqueue, failResolution } from "./downloadManager";

const NONE_TAGS = {
  embedCover: false,
  embedMeta: false,
  embedLyric: false,
  writeLrc: false,
  saveTtml: false,
};

/** 构建带平台选择、直带 URL 与解析依据的下载请求 */
const buildRequest = (
  taskId: string,
  over: Omit<Partial<DownloadRequest>, "track"> & {
    track?: Partial<DownloadRequest["track"]>;
  },
): DownloadRequest => {
  const { track, ...rest } = over;
  return {
    taskId,
    track: { source: "netease", id: "1", title: "song", artists: [], duration: 200000, ...track },
    qualityLevel: "sky",
    qualitySelection: "netease:sky",
    url: "https://music/audio",
    tagOptions: NONE_TAGS,
    lyricFileFormat: "lrc",
    ...rest,
  };
};

/** 插件明确回传的档位依据 */
const brand = (over: Partial<QualityProvenance>): QualityProvenance => ({
  provider: "plugin",
  pluginId: "p1",
  sourceKey: "wy",
  platform: "netease",
  evidence: "plugin",
  ...over,
});

/** 等待任务结束（done/failed） */
const waitForFinish = async (taskId: string): Promise<DownloadTask> => {
  await vi.waitFor(() => {
    const status = db.findById(taskId)?.status;
    expect(["done", "failed"]).toContain(status);
  });
  return db.findById(taskId)!;
};

/** 探针按路径区分：下载目录里的待替换原文件 vs 缓存目录里的下载候选 */
const mockProbe = (
  original: { codec: string; sampleRate: number; bitsPerSample: number } | null,
  candidate: { codec: string; sampleRate: number; bitsPerSample: number },
): void => {
  state.probe.mockImplementation(async (filePath: string) => {
    if (filePath.startsWith(state.downloadDir)) return original;
    return candidate;
  });
};

describe("下载平台选择档位校验", () => {
  beforeEach(async () => {
    state.db = new Database(":memory:");
    state.db.exec(`
      CREATE TABLE download_tasks (
        task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
        quality_selection TEXT, target_dir TEXT, replace_source_path TEXT, min_level TEXT, status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0, file_path TEXT, error_code TEXT,
        tag_warning INTEGER NOT NULL DEFAULT 0, probed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, finished_at INTEGER
      );
    `);
    state.downloadDir = await fsp.mkdtemp(path.join(os.tmpdir(), "splayer-dl-sel-"));
    state.cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), "splayer-dl-selcache-"));
    state.writeTags.mockReset().mockResolvedValue([{ success: true }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(Buffer.alloc(64, 1), {
            headers: { "content-type": "audio/flac", "content-length": "64" },
          }),
      ),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fsp.rm(state.downloadDir, { recursive: true, force: true });
    await fsp.rm(state.cacheDir, { recursive: true, force: true });
  });

  it("空间音频冒牌货：解析依据的品牌档位对不上 → DOWNLOAD_QUALITY_NOT_MET", async () => {
    // 依据声明的是 hires 而非 sky 档，任意高等级文件不能冒充空间音频
    mockProbe(null, { codec: "flac", sampleRate: 96000, bitsPerSample: 24 });
    await enqueue(
      buildRequest("sel-impostor", {
        qualityProvenance: brand({ nativeTier: "hires", level: "sky" }),
      }),
    );
    const task = await waitForFinish("sel-impostor");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
  });

  it("QQ 全景声：品牌回执命中 → 落盘成功且选择随任务持久化", async () => {
    mockProbe(null, { codec: "flac", sampleRate: 44100, bitsPerSample: 16 });
    await enqueue(
      buildRequest("sel-plain-spatial", {
        track: { source: "qqmusic", id: "9" },
        qualityLevel: "sky",
        qualitySelection: "qqmusic:qq-spatial",
        qualityProvenance: brand({
          platform: "qqmusic",
          sourceKey: "tx",
          nativeTier: "atmos",
        }),
      }),
    );
    const task = await waitForFinish("sel-plain-spatial");
    expect(task.status).toBe("done");
    expect(task.qualitySelection).toBe("qqmusic:qq-spatial");
    expect(task.track.quality?.codec).toBe("flac");
    expect(db.findById("sel-plain-spatial")?.qualitySelection).toBe("qqmusic:qq-spatial");
  });

  it("QQ 全景声2.0：atmos_plus 回执命中 → 落盘成功且选择持久化", async () => {
    mockProbe(null, { codec: "flac", sampleRate: 44100, bitsPerSample: 16 });
    await enqueue(
      buildRequest("sel-plus-spatial", {
        track: { source: "qqmusic", id: "9" },
        qualityLevel: "sky",
        qualitySelection: "qqmusic:qq-spatial-2.0",
        qualityProvenance: brand({
          platform: "qqmusic",
          sourceKey: "tx",
          nativeTier: "atmos_plus",
        }),
      }),
    );
    const task = await waitForFinish("sel-plus-spatial");
    expect(task.status).toBe("done");
    expect(task.qualitySelection).toBe("qqmusic:qq-spatial-2.0");
    expect(db.findById("sel-plus-spatial")?.qualitySelection).toBe("qqmusic:qq-spatial-2.0");
  });

  it.each([
    { selection: "qqmusic:qq-spatial", nativeTier: "atmos_plus" },
    { selection: "qqmusic:qq-spatial-2.0", nativeTier: "atmos" },
  ])(
    "全景声 plain/plus 回执不得互相代替：$selection + $nativeTier → DOWNLOAD_QUALITY_NOT_MET",
    async ({ selection, nativeTier }) => {
      mockProbe(null, { codec: "flac", sampleRate: 44100, bitsPerSample: 16 });
      await enqueue(
        buildRequest(`sel-swap-${selection.split(":")[1]}-${nativeTier}`, {
          track: { source: "qqmusic", id: "9" },
          qualityLevel: "sky",
          qualitySelection: selection,
          qualityProvenance: brand({ platform: "qqmusic", sourceKey: "tx", nativeTier }),
        }),
      );
      const id = `sel-swap-${selection.split(":")[1]}-${nativeTier}`;
      const task = await waitForFinish(id);
      expect(task.status).toBe("failed");
      expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    },
  );

  it("QQ 母带统一目标：规范 master 选择 + master 回执 → 落盘成功且选择持久化", async () => {
    mockProbe(null, { codec: "flac", sampleRate: 176400, bitsPerSample: 24 });
    await enqueue(
      buildRequest("sel-master", {
        track: { source: "qqmusic", id: "9" },
        qualityLevel: "jymaster",
        qualitySelection: "qqmusic:master",
        qualityProvenance: brand({
          platform: "qqmusic",
          sourceKey: "tx",
          nativeTier: "master",
        }),
      }),
    );
    const task = await waitForFinish("sel-master");
    expect(task.status).toBe("done");
    expect(task.qualitySelection).toBe("qqmusic:master");
    expect(db.findById("sel-master")?.qualitySelection).toBe("qqmusic:master");
  });

  it.each([
    { selection: "qqmusic:qq-master-4.0", nativeTier: "qq-master-4.0" },
    { selection: "qqmusic:qq-master-2.0", nativeTier: "qq-master-2.0" },
  ])(
    "历史母带 $selection 统一到母带门槛：合法母带文件落盘成功并原样持久化",
    async ({ selection, nativeTier }) => {
      // 旧 4.0/2.0 选择都归一到统一母带目标，历史版本回执同样命中母带门槛
      mockProbe(null, { codec: "flac", sampleRate: 176400, bitsPerSample: 24 });
      await enqueue(
        buildRequest(`sel-legacy-${selection.split(":")[1]}`, {
          track: { source: "qqmusic", id: "9" },
          qualityLevel: "jymaster",
          qualitySelection: selection,
          qualityProvenance: brand({
            platform: "qqmusic",
            sourceKey: "tx",
            nativeTier,
          }),
        }),
      );
      const id = `sel-legacy-${selection.split(":")[1]}`;
      const task = await waitForFinish(id);
      expect(task.status).toBe("done");
      expect(task.qualitySelection).toBe(selection);
      expect(db.findById(id)?.qualitySelection).toBe(selection);
    },
  );

  it("已下线臻品选择 qqmusic:qq-premium-2.0 仍校验拒绝，不静默换档", async () => {
    mockProbe(null, { codec: "flac", sampleRate: 176400, bitsPerSample: 24 });
    await enqueue(
      buildRequest("sel-retired-premium", {
        track: { source: "qqmusic", id: "9" },
        qualityLevel: "jymaster",
        qualitySelection: "qqmusic:qq-premium-2.0",
        qualityProvenance: brand({
          platform: "qqmusic",
          sourceKey: "tx",
          nativeTier: "qq-premium-2.0",
        }),
      }),
    );
    const task = await waitForFinish("sel-retired-premium");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
  });

  it.each(["kuwo:kuwo-premium-2.0", "kuwo:kuwo-spatial", "kuwo:hires"])(
    "酷我已移除档位选择 %s 显式拒绝，不静默变低档",
    async (qualitySelection) => {
      mockProbe(null, { codec: "flac", sampleRate: 96000, bitsPerSample: 24 });
      await enqueue(
        buildRequest(`sel-kw-retired-${qualitySelection.split(":")[1]}`, {
          track: { source: "kuwo", id: "9" },
          qualityLevel: qualitySelection.endsWith("hires") ? "hi-res" : "sky",
          qualitySelection,
          qualityProvenance: brand({
            platform: "kuwo",
            sourceKey: "kw",
            nativeTier: qualitySelection.endsWith("hires") ? "hires" : "kuwo-spatial",
          }),
        }),
      );
      const id = `sel-kw-retired-${qualitySelection.split(":")[1]}`;
      const task = await waitForFinish(id);
      expect(task.status).toBe("failed");
      expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    },
  );

  it("未知选择标识 → DOWNLOAD_QUALITY_NOT_MET", async () => {
    mockProbe(null, { codec: "flac", sampleRate: 44100, bitsPerSample: 16 });
    await enqueue(
      buildRequest("sel-unknown", {
        qualityLevel: "lossless",
        qualitySelection: "netease:nope",
      }),
    );
    const task = await waitForFinish("sel-unknown");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
  });

  it("升级目标未达标：原文件实测更高时取 max 下限，失败保留原文件", async () => {
    // 原文件是 CD 规格无损，目标 Hi-Res，但候选也只有 CD 规格 → 拒绝替换
    const original = path.join(state.downloadDir, "orig-keep.flac");
    await fsp.writeFile(original, Buffer.alloc(16, 1));
    mockProbe(
      { codec: "flac", sampleRate: 44100, bitsPerSample: 16 },
      {
        codec: "flac",
        sampleRate: 44100,
        bitsPerSample: 16,
      },
    );
    await enqueue(
      buildRequest("sel-upgrade-keep", {
        qualityLevel: "hi-res",
        qualitySelection: "netease:hires",
        minLevel: "hi-res",
        targetDir: state.downloadDir,
        replaceSourcePath: original,
        qualityProvenance: brand({ nativeTier: "hires", level: "hi-res", evidence: "response" }),
      }),
    );
    const task = await waitForFinish("sel-upgrade-keep");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    expect(fs.existsSync(original)).toBe(true);
  });

  it("原文件损坏探测不出档位时按显式 minLevel 校验目标，达标才删原文件", async () => {
    const original = path.join(state.downloadDir, "orig-broken.flac");
    await fsp.writeFile(original, Buffer.alloc(16, 1));
    mockProbe(null, { codec: "flac", sampleRate: 96000, bitsPerSample: 24 });
    await enqueue(
      buildRequest("sel-upgrade-broken", {
        qualityLevel: "hi-res",
        qualitySelection: "netease:hires",
        minLevel: "hi-res",
        targetDir: state.downloadDir,
        replaceSourcePath: original,
        qualityProvenance: brand({ nativeTier: "hires", level: "hi-res", evidence: "response" }),
      }),
    );
    const task = await waitForFinish("sel-upgrade-broken");
    expect(task.status).toBe("done");
    expect(fs.existsSync(original)).toBe(false);
    expect(fs.existsSync(task.filePath!)).toBe(true);
  });

  it("同曲同通用等级、不同具体选择不入同键去重；同选择已完成仍拦截", async () => {
    mockProbe(null, { codec: "flac", sampleRate: 44100, bitsPerSample: 16 });
    const base = {
      track: { source: "qqmusic" as const, id: "9" },
      qualityLevel: "sky" as const,
    };
    const plain = {
      qualitySelection: "qqmusic:qq-spatial",
      qualityProvenance: brand({
        platform: "qqmusic",
        sourceKey: "tx",
        nativeTier: "atmos",
      }),
    };
    await enqueue(buildRequest("sel-dedupe-plain", { ...base, ...plain }));
    await waitForFinish("sel-dedupe-plain");
    // 同选择且文件仍在 → 已下载拦截
    const same = await enqueue(buildRequest("sel-dedupe-same", { ...base, ...plain }));
    expect(same).toEqual({ ok: false, reason: "downloaded" });
    // 不同选择（plus 全景声）→ 独立任务入队
    const other = await enqueue(
      buildRequest("sel-dedupe-plus", {
        ...base,
        qualitySelection: "qqmusic:qq-spatial-2.0",
        qualityProvenance: brand({
          platform: "qqmusic",
          sourceKey: "tx",
          nativeTier: "atmos_plus",
        }),
      }),
    );
    expect(other).toEqual({ ok: true });
    cancel("sel-dedupe-plus");
  });

  it("酷狗母带升级：24/96 文件符合平台母带保证规格（Hi-Res）→ 升级成功且原文件删除", async () => {
    const original = path.join(state.downloadDir, "orig-kg-master.flac");
    await fsp.writeFile(original, Buffer.alloc(16, 1));
    mockProbe(
      { codec: "flac", sampleRate: 44100, bitsPerSample: 16 },
      { codec: "flac", sampleRate: 96000, bitsPerSample: 24 },
    );
    await enqueue(
      buildRequest("sel-upgrade-kg-master", {
        track: { source: "kugou", id: "7" },
        qualityLevel: "jymaster",
        qualitySelection: "kugou:kugou-master",
        qualityProvenance: brand({
          platform: "kugou",
          sourceKey: "kg",
          nativeTier: "kugou-master",
        }),
        targetDir: state.downloadDir,
        replaceSourcePath: original,
        minLevel: "hi-res",
      }),
    );
    const task = await waitForFinish("sel-upgrade-kg-master");
    expect(task.status).toBe("done");
    expect(fs.existsSync(original)).toBe(false);
    expect(fs.existsSync(task.filePath!)).toBe(true);
    expect(task.track.quality?.sampleRate).toBe(96000);
    expect(task.track.qualityProvenance?.nativeTier).toBe("kugou-master");
  });

  it("酷狗母带升级：新文件低于原文件实测档位 → 拒绝替换并保留原文件", async () => {
    const original = path.join(state.downloadDir, "orig-kg-down.flac");
    await fsp.writeFile(original, Buffer.alloc(16, 1));
    mockProbe(
      { codec: "flac", sampleRate: 96000, bitsPerSample: 24 },
      { codec: "flac", sampleRate: 44100, bitsPerSample: 16 },
    );
    await enqueue(
      buildRequest("sel-upgrade-kg-down", {
        track: { source: "kugou", id: "8" },
        qualityLevel: "jymaster",
        qualitySelection: "kugou:kugou-master",
        qualityProvenance: brand({
          platform: "kugou",
          sourceKey: "kg",
          nativeTier: "kugou-master",
        }),
        targetDir: state.downloadDir,
        replaceSourcePath: original,
        minLevel: "hi-res",
      }),
    );
    const task = await waitForFinish("sel-upgrade-kg-down");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    expect(fs.existsSync(original)).toBe(true);
    // 失败行持久化升级参数：重启后重试仍可继续原位升级
    const persisted = db.findById("sel-upgrade-kg-down");
    expect(persisted?.targetDir).toBe(state.downloadDir);
    expect(persisted?.replaceSourcePath).toBe(original);
    expect(persisted?.minLevel).toBe("hi-res");
  });

  it("酷狗母带升级：原文件已是更高规格（24/192）时不得降级替换", async () => {
    const original = path.join(state.downloadDir, "orig-kg-nodown.flac");
    await fsp.writeFile(original, Buffer.alloc(16, 1));
    mockProbe(
      { codec: "flac", sampleRate: 192000, bitsPerSample: 24 },
      { codec: "flac", sampleRate: 96000, bitsPerSample: 24 },
    );
    await enqueue(
      buildRequest("sel-upgrade-kg-nodown", {
        track: { source: "kugou", id: "10" },
        qualityLevel: "jymaster",
        qualitySelection: "kugou:kugou-master",
        qualityProvenance: brand({
          platform: "kugou",
          sourceKey: "kg",
          nativeTier: "kugou-master",
        }),
        targetDir: state.downloadDir,
        replaceSourcePath: original,
        minLevel: "hi-res",
      }),
    );
    const task = await waitForFinish("sel-upgrade-kg-nodown");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    expect(fs.existsSync(original)).toBe(true);
  });

  it("酷狗母带升级：调用方显式要求更高物理下限时仍拒绝低规格文件", async () => {
    const original = path.join(state.downloadDir, "orig-kg-explicit.flac");
    await fsp.writeFile(original, Buffer.alloc(16, 1));
    mockProbe(
      { codec: "flac", sampleRate: 44100, bitsPerSample: 16 },
      { codec: "flac", sampleRate: 96000, bitsPerSample: 24 },
    );
    await enqueue(
      buildRequest("sel-upgrade-kg-explicit", {
        track: { source: "kugou", id: "12" },
        qualityLevel: "jymaster",
        qualitySelection: "kugou:kugou-master",
        qualityProvenance: brand({
          platform: "kugou",
          sourceKey: "kg",
          nativeTier: "kugou-master",
        }),
        targetDir: state.downloadDir,
        replaceSourcePath: original,
        minLevel: "jymaster",
      }),
    );
    const task = await waitForFinish("sel-upgrade-kg-explicit");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    expect(fs.existsSync(original)).toBe(true);
  });

  it("酷狗母带升级：无品牌声明回执（请求回显）→ 拒绝并保留原文件", async () => {
    const original = path.join(state.downloadDir, "orig-kg-nodecl.flac");
    await fsp.writeFile(original, Buffer.alloc(16, 1));
    mockProbe(
      { codec: "flac", sampleRate: 44100, bitsPerSample: 16 },
      { codec: "flac", sampleRate: 96000, bitsPerSample: 24 },
    );
    await enqueue(
      buildRequest("sel-upgrade-kg-nodecl", {
        track: { source: "kugou", id: "11" },
        qualityLevel: "jymaster",
        qualitySelection: "kugou:kugou-master",
        qualityProvenance: brand({ platform: "kugou", sourceKey: "kg", evidence: "request" }),
        targetDir: state.downloadDir,
        replaceSourcePath: original,
        minLevel: "hi-res",
      }),
    );
    const task = await waitForFinish("sel-upgrade-kg-nodecl");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    expect(fs.existsSync(original)).toBe(true);
  });

  it.each([
    { id: "res-fail-plain", label: "未带原因码", code: undefined },
    { id: "res-fail-badcode", label: "白名单外非法码", code: "NOT_A_REAL_CODE" },
  ])("解析失败兜底：$label → 任务持久化 UNKNOWN", async ({ id, code }) => {
    await enqueue(buildRequest(id, { url: undefined }));
    // 轮到任务且缺 URL 时主进程广播解析请求，门注册完成后再回传失败
    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(
        "download:resolve",
        expect.objectContaining({ taskId: id }),
      );
    });
    failResolution(id, code);
    const task = await waitForFinish(id);
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.UNKNOWN);
    expect(db.findById(id)?.errorCode).toBe(ErrorCode.UNKNOWN);
  });

  it("解析失败带合法原因码 → 任务持久化该码而非 UNKNOWN", async () => {
    await enqueue(buildRequest("res-fail-quality", { url: undefined }));
    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(
        "download:resolve",
        expect.objectContaining({ taskId: "res-fail-quality" }),
      );
    });
    failResolution("res-fail-quality", ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    const task = await waitForFinish("res-fail-quality");
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
    expect(db.findById("res-fail-quality")?.errorCode).toBe(ErrorCode.DOWNLOAD_QUALITY_NOT_MET);
  });
});
