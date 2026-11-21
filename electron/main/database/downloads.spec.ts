// @vitest-environment node
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadTask } from "@shared/types/download";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import { listAll, listCompletedPaths, findById, upsert } from "./downloads";

describe("下载记录精确查询", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`CREATE TABLE download_tasks (
      task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
      quality_selection TEXT, target_dir TEXT, replace_source_path TEXT, min_level TEXT,
      status TEXT NOT NULL, received INTEGER, total INTEGER, file_path TEXT,
      error_code TEXT, tag_warning INTEGER, probed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER, finished_at INTEGER
    )`);
  });
  afterEach(() => state.db?.close());

  it("仅返回同平台同 ID 的已完成记录，不限制音质，最新文件优先", () => {
    const task: DownloadTask = {
      taskId: "older",
      status: "done",
      qualityLevel: "hq",
      received: 1,
      total: 1,
      createdAt: 1,
      finishedAt: 1,
      filePath: "older.flac",
      track: { source: "netease", id: "1", title: "test", artists: [], duration: 1000 },
    };
    upsert(task);
    upsert({
      ...task,
      taskId: "newer",
      qualityLevel: "lossless",
      finishedAt: 2,
      filePath: "newer.flac",
    });
    upsert({ ...task, taskId: "other-platform", track: { ...task.track, source: "qqmusic" } });
    upsert({ ...task, taskId: "other-song", track: { ...task.track, id: "2" } });
    upsert({ ...task, taskId: "pending", status: "downloading" });
    upsert({ ...task, taskId: "failed", status: "failed" });
    upsert({ ...task, taskId: "no-path", filePath: undefined });
    expect(listCompletedPaths(task.track)).toEqual(["newer.flac", "older.flac"]);
  });

  it("流媒体的同名 ID 不会跨服务器命中", () => {
    const task: DownloadTask = {
      taskId: "server-a",
      status: "done",
      qualityLevel: "hq",
      received: 1,
      total: 1,
      createdAt: 1,
      filePath: "a.flac",
      track: {
        source: "streaming",
        id: "1",
        serverId: "a",
        originalId: "remote",
        title: "test",
        artists: [],
        duration: 1000,
      },
    };
    upsert(task);
    upsert({
      ...task,
      taskId: "server-b",
      filePath: "b.flac",
      track: { ...task.track, serverId: "b" },
    });
    expect(listCompletedPaths(task.track)).toEqual(["a.flac"]);
    expect(listCompletedPaths({ ...task.track, originalId: "other" })).toEqual([]);
  });

  it("qualitySelection 随任务行落库并原样读回；缺省为 undefined", () => {
    const task: DownloadTask = {
      taskId: "sel",
      status: "done",
      qualityLevel: "sky",
      qualitySelection: "qqmusic:qq-premium-2.0",
      received: 1,
      total: 1,
      createdAt: 1,
      filePath: "sel.flac",
      track: { source: "qqmusic", id: "1", title: "test", artists: [], duration: 1000 },
    };
    upsert(task);
    upsert({ ...task, taskId: "plain", qualitySelection: undefined });
    expect(findById("sel")?.qualitySelection).toBe("qqmusic:qq-premium-2.0");
    expect(findById("plain")?.qualitySelection).toBeUndefined();
  });

  it("升级参数三字段随任务行落库并原样读回；失败任务保留，缺省为 undefined", () => {
    const task: DownloadTask = {
      taskId: "upg",
      status: "failed",
      qualityLevel: "jymaster",
      qualitySelection: "kugou:kugou-master",
      received: 0,
      total: 0,
      createdAt: 1,
      finishedAt: 2,
      errorCode: "DOWNLOAD_QUALITY_NOT_MET",
      targetDir: "C:\\music\\orig",
      replaceSourcePath: "C:\\music\\orig\\a.flac",
      minLevel: "hi-res",
      track: { source: "kugou", id: "7", title: "test", artists: [], duration: 1000 },
    };
    upsert(task);
    upsert({
      ...task,
      taskId: "plain-no-upgrade",
      targetDir: undefined,
      replaceSourcePath: undefined,
      minLevel: undefined,
    });
    // 失败任务同样保留参数：重试可继续原位升级
    const hit = findById("upg");
    expect(hit?.status).toBe("failed");
    expect(hit?.targetDir).toBe("C:\\music\\orig");
    expect(hit?.replaceSourcePath).toBe("C:\\music\\orig\\a.flac");
    expect(hit?.minLevel).toBe("hi-res");
    // 无升级参数的普通任务读回 undefined，不补猜
    expect(findById("plain-no-upgrade")?.targetDir).toBeUndefined();
    expect(findById("plain-no-upgrade")?.replaceSourcePath).toBeUndefined();
    expect(findById("plain-no-upgrade")?.minLevel).toBeUndefined();
    expect(listAll().find((t) => t.taskId === "upg")?.replaceSourcePath).toBe(
      "C:\\music\\orig\\a.flac",
    );
  });

  it("未知 minLevel 值按严格校验降为 undefined，不污染下游档位比较", () => {
    state
      .db!.prepare(
        "INSERT INTO download_tasks (task_id, track_json, quality_level, status, received, total, created_at, min_level) VALUES ('weird', '{}', 'hq', 'done', 0, 0, 1, 'weird-tier')",
      )
      .run();
    expect(findById("weird")?.minLevel).toBeUndefined();
  });

  it("重启模拟：关闭后重开同一文件库仍读回完整升级参数", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "splayer-db-reopen-"));
    const dbPath = path.join(dir, "library.db");
    const task: DownloadTask = {
      taskId: "reopen",
      status: "failed",
      qualityLevel: "jymaster",
      qualitySelection: "kugou:kugou-master",
      received: 0,
      total: 0,
      createdAt: 1,
      targetDir: dir,
      replaceSourcePath: path.join(dir, "a.flac"),
      minLevel: "hi-res",
      track: { source: "kugou", id: "7", title: "test", artists: [], duration: 1000 },
    };
    state.db = new DatabaseSync(dbPath);
    state.db.exec(`CREATE TABLE download_tasks (
      task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
      quality_selection TEXT, target_dir TEXT, replace_source_path TEXT, min_level TEXT,
      status TEXT NOT NULL, received INTEGER, total INTEGER, file_path TEXT,
      error_code TEXT, tag_warning INTEGER, probed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER, finished_at INTEGER
    )`);
    upsert(task);
    state.db.close();
    // 模拟应用重启：重新打开同一文件库后三字段与选择仍完整
    state.db = new DatabaseSync(dbPath);
    const hit = findById("reopen");
    expect(hit?.targetDir).toBe(dir);
    expect(hit?.replaceSourcePath).toBe(path.join(dir, "a.flac"));
    expect(hit?.minLevel).toBe("hi-res");
    expect(hit?.qualitySelection).toBe("kugou:kugou-master");
    expect(listAll().map((t) => t.taskId)).toContain("reopen");
    state.db.close();
    state.db = null;
    await fsp.rm(dir, { recursive: true, force: true });
  });
});
