// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadRequest, DownloadResolution } from "@shared/types/download";
import type { DownloadTask } from "@shared/types/download";
import type { QualityProvenance } from "@shared/types/quality";

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
import { enqueue, submitResolution, lookupDownloadedFileInfoByPath } from "./downloadManager";

/** 历史任务 track 上残留的旧品牌依据 */
const staleBrand: QualityProvenance = {
  provider: "plugin",
  platform: "kuwo",
  pluginId: "legacy-plugin",
  evidence: "catalog",
  level: "lossless",
};

/** 本次解析回传的新品牌依据 */
const freshBrand: QualityProvenance = {
  provider: "plugin",
  platform: "netease",
  pluginId: "p1",
  sourceKey: "wy",
  nativeTier: "jymaster",
  level: "jymaster",
  evidence: "response",
};

/** 构建缺 URL 的下载请求（走 download:resolve 即时解析路径） */
const buildRequest = (
  taskId: string,
  trackOver: Partial<DownloadTask["track"]> = {},
): DownloadRequest => ({
  taskId,
  track: {
    source: "netease",
    id: "1",
    title: "song",
    artists: [],
    duration: 200000,
    qualityProvenance: staleBrand,
    ...trackOver,
  },
  qualityLevel: "lossless",
  tagOptions: {
    embedCover: false,
    embedMeta: false,
    embedLyric: false,
    writeLrc: false,
    saveTtml: false,
  },
  lyricFileFormat: "lrc",
});

/** 等待任务结束（done/failed） */
const waitForFinish = async (taskId: string): Promise<DownloadTask> => {
  await vi.waitFor(() => {
    const status = db.findById(taskId)?.status;
    expect(["done", "failed"]).toContain(status);
  });
  return db.findById(taskId)!;
};

describe("下载落盘 provenance 只认本次解析", () => {
  beforeEach(async () => {
    state.db = new Database(":memory:");
    state.db.exec(`
      CREATE TABLE download_tasks (
        task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
        quality_selection TEXT,
        status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
        file_path TEXT, error_code TEXT, tag_warning INTEGER NOT NULL DEFAULT 0,
        probed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
      );
    `);
    state.downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "splayer-dl-final-"));
    state.cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "splayer-dl-cache-"));
    state.probe.mockReset().mockResolvedValue({
      codec: "flac",
      sampleRate: 44100,
      bitsPerSample: 16,
      bitRate: 900000,
      channels: 2,
    });
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
    await fs.rm(state.downloadDir, { recursive: true, force: true });
    await fs.rm(state.cacheDir, { recursive: true, force: true });
  });

  it("入队即剥离旧 track 残留品牌；本次解析未回传 provenance 时落盘不保存品牌", async () => {
    const req = buildRequest("t-clear");
    await enqueue(req);
    // 排队行已不带旧品牌
    const queued = db.findById("t-clear");
    expect(queued?.track.qualityProvenance).toBeUndefined();
    submitResolution("t-clear", { url: "https://music/audio" } satisfies DownloadResolution);
    const task = await waitForFinish("t-clear");
    expect(task.status).toBe("done");
    const rec = db.findCompletedByPath(task.filePath!);
    expect(rec?.path).toBe(task.filePath);
    // 实测音质与文件印章照常保存
    expect(rec?.quality?.codec).toBe("flac");
    expect(rec?.fileSize).toBe(64);
    expect(rec?.mtime).not.toBeNull();
    // 旧品牌不得透传
    expect(rec?.qualityProvenance).toBeUndefined();
    expect(await lookupDownloadedFileInfoByPath(task.filePath!)).toMatchObject({
      path: task.filePath,
      qualityProvenance: undefined,
    });
  });

  it("本次解析回传 provenance 时随文件保存并可通过印章复用", async () => {
    await enqueue(buildRequest("t-brand"));
    submitResolution("t-brand", { url: "https://music/audio", qualityProvenance: freshBrand });
    const task = await waitForFinish("t-brand");
    expect(task.status).toBe("done");
    expect(task.track.qualityProvenance).toEqual(freshBrand);
    const info = await lookupDownloadedFileInfoByPath(task.filePath!);
    expect(info?.qualityProvenance).toEqual(freshBrand);
    expect(info?.quality?.codec).toBe("flac");
  });

  it("脏 resolution provenance 被剔除，不落品牌", async () => {
    await enqueue(buildRequest("t-junk"));
    submitResolution("t-junk", {
      url: "https://music/audio",
      qualityProvenance: { provider: "evil", evidence: "nope" } as unknown as QualityProvenance,
    });
    const task = await waitForFinish("t-junk");
    expect(task.status).toBe("done");
    expect(task.track.qualityProvenance).toBeUndefined();
  });
});
