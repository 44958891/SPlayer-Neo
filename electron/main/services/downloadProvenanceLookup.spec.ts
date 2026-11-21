// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadTask } from "@shared/types/download";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@main/database/index", () => ({ getDb: () => state.db }));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("@main/store", () => ({ store: { get: vi.fn() } }));
vi.mock("@main/utils/config", () => ({
  getDownloadDir: vi.fn(),
  getCoverCacheDir: vi.fn(),
  getAppCacheDir: vi.fn(),
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@main/utils/logger", () => ({
  downloadLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@main/services/engine", () => ({ getEngine: vi.fn() }));
vi.mock("@main/utils/fetchBytes", () => ({ fetchBytes: vi.fn() }));
vi.mock("@main/services/streaming/mediaSource", () => ({
  resolveStreamingMediaSource: vi.fn(),
}));
import {
  lookupDownloadedFile,
  lookupDownloadedFileInfo,
  lookupDownloadedFileInfoByPath,
} from "./downloadManager";
import { upsert as upsertTask } from "@main/database/downloads";

/** 已完成任务与随存 provenance */
const baseTask = (filePath: string, over: Partial<DownloadTask> = {}): DownloadTask => ({
  taskId: "t1",
  status: "done",
  qualityLevel: "lossless",
  received: 1,
  total: 1,
  createdAt: 1,
  finishedAt: 1,
  filePath,
  track: {
    source: "netease",
    id: "1",
    title: "test",
    artists: [],
    duration: 1000,
    quality: { codec: "flac", sampleRate: 44100, bitRate: 900000, channels: 2, bitsPerSample: 16 },
    qualityProvenance: {
      provider: "plugin",
      platform: "netease",
      pluginId: "p1",
      evidence: "response",
      level: "lossless",
    },
    fileSize: 8,
    mtime: 0,
  },
  ...over,
});

describe("已下载文件音质依据按印章复用", () => {
  let dir: string;
  let audioPath: string;

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
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "splayer-dl-prov-"));
    audioPath = path.join(dir, "a.flac");
    await fs.writeFile(audioPath, Buffer.alloc(8, 1));
    const stat = await fs.stat(audioPath);
    upsertTask(
      baseTask(audioPath, {
        track: { ...baseTask(audioPath).track, mtime: Math.floor(stat.mtimeMs) },
      }),
    );
  });
  afterEach(async () => {
    state.db?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("size+mtime 印章一致时回传 provenance 与随存音质", async () => {
    const byPath = await lookupDownloadedFileInfoByPath(audioPath);
    expect(byPath?.path).toBe(audioPath);
    expect(byPath?.qualityProvenance?.pluginId).toBe("p1");
    expect(byPath?.quality?.codec).toBe("flac");
    const byTrack = await lookupDownloadedFileInfo({ source: "netease", id: "1" });
    expect(byTrack?.qualityProvenance?.evidence).toBe("response");
    // 旧签名 lookup 仍只回传路径
    expect(await lookupDownloadedFile({ source: "netease", id: "1" })).toBe(audioPath);
  });

  it("亚毫秒文件时间与原生扫描器一致截断，而非四舍五入", async () => {
    await fs.utimes(audioPath, 1700000000.7898, 1700000000.7898);
    const stat = await fs.stat(audioPath);
    expect(Math.floor(stat.mtimeMs)).not.toBe(Math.round(stat.mtimeMs));
    upsertTask(
      baseTask(audioPath, {
        track: { ...baseTask(audioPath).track, mtime: Math.floor(stat.mtimeMs) },
      }),
    );
    expect((await lookupDownloadedFileInfoByPath(audioPath))?.qualityProvenance?.pluginId).toBe(
      "p1",
    );
  });

  it("文件被替换（内容变化）后 provenance 降级 generic，路径仍可用", async () => {
    await fs.writeFile(audioPath, Buffer.alloc(32, 2));
    const byPath = await lookupDownloadedFileInfoByPath(audioPath);
    expect(byPath?.path).toBe(audioPath);
    expect(byPath?.qualityProvenance).toBeUndefined();
    expect(byPath?.quality).toBeUndefined();
  });

  it("文件 mtime 被触碰后 provenance 同样不回传", async () => {
    const now = new Date();
    await fs.utimes(audioPath, now, new Date(Date.now() + 5000));
    const byPath = await lookupDownloadedFileInfoByPath(audioPath);
    expect(byPath?.qualityProvenance).toBeUndefined();
  });

  it("文件被删除后精确路径查询返回 null，按曲目查询跳过失效记录", async () => {
    await fs.unlink(audioPath);
    expect(await lookupDownloadedFileInfoByPath(audioPath)).toBeNull();
    expect(await lookupDownloadedFileInfo({ source: "netease", id: "1" })).toBeNull();
    expect(await lookupDownloadedFile({ source: "netease", id: "1" })).toBeNull();
  });

  it("旧记录没有文件印章时按未知来源处理", async () => {
    const oldPath = path.join(dir, "old.flac");
    await fs.writeFile(oldPath, Buffer.alloc(4, 3));
    upsertTask(
      baseTask(oldPath, {
        taskId: "legacy",
        finishedAt: 2,
        track: {
          ...baseTask(oldPath).track,
          qualityProvenance: {
            provider: "plugin",
            pluginId: "p1",
            evidence: "response",
          },
          fileSize: undefined,
          mtime: undefined,
        },
      }),
    );
    const rec = await lookupDownloadedFileInfoByPath(oldPath);
    expect(rec?.path).toBe(oldPath);
    expect(rec?.qualityProvenance).toBeUndefined();
    // 按曲目查询取最新完成者：legacy 的 finishedAt 更晚，返回 generic
    const newest = await lookupDownloadedFileInfo({ source: "netease", id: "1" });
    expect(newest?.path).toBe(oldPath);
    expect(newest?.qualityProvenance).toBeUndefined();
  });

  it("本地来源不参与下载记录查询，未知路径返回 null", async () => {
    expect(await lookupDownloadedFileInfoByPath(path.join(dir, "ghost.flac"))).toBeNull();
    expect(await lookupDownloadedFileInfo({ source: "local", id: "x" })).toBeNull();
  });
});
