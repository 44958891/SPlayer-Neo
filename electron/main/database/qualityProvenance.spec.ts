// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadTask } from "@shared/types/download";
import type { QualityProvenance } from "@shared/types/quality";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import { migrate } from "./migration";
import { findByKey, upsert as upsertCacheRow, type SongCacheRow } from "./songCache";
import {
  findCompletedByPath,
  listCompletedRecords,
  listCompletedPaths,
  upsert as upsertTask,
} from "./downloads";

/** 构造带合法印章与来源依据的下载任务 */
const provenanceTask = (over: Partial<DownloadTask> = {}): DownloadTask => ({
  taskId: "t1",
  status: "done",
  qualityLevel: "lossless",
  received: 1,
  total: 1,
  createdAt: 1,
  finishedAt: 1,
  filePath: "C:\\music\\a.flac",
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
      sourceKey: "wy",
      nativeTier: "jymaster",
      level: "jymaster",
      evidence: "response",
    },
    fileSize: 123,
    mtime: 456,
  },
  ...over,
});

describe("音质依据持久化", () => {
  beforeEach(() => {
    state.db = new Database(":memory:");
    state.db.exec(`
      CREATE TABLE lyric_match_cache (
        fingerprint TEXT NOT NULL, platform TEXT NOT NULL, platform_id TEXT NOT NULL,
        extra TEXT, matched_at INTEGER NOT NULL, PRIMARY KEY (fingerprint, platform)
      );
    `);
  });
  afterEach(() => state.db?.close());

  it("旧 v5 库迁移后 song_cache 追加 quality_provenance 列且旧数据保留", () => {
    const d = state.db!;
    d.exec(`
      CREATE TABLE song_cache (
        cache_key TEXT PRIMARY KEY, source TEXT NOT NULL, filename TEXT NOT NULL,
        size INTEGER NOT NULL, mime TEXT, cached_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
      );
      CREATE TABLE download_tasks (
        task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
        status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
        file_path TEXT, error_code TEXT, tag_warning INTEGER NOT NULL DEFAULT 0,
        probed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
      );
    `);
    d.prepare(
      "INSERT INTO song_cache (cache_key, source, filename, size, mime, cached_at, last_used_at) VALUES ('k1', 'netease', 'f.bin', 10, NULL, 1, 1)",
    ).run();
    d.pragma("user_version = 5");
    migrate(d);
    expect(d.pragma("user_version", { simple: true })).toBe(9);
    const cols = (d.prepare("PRAGMA table_info(song_cache)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("quality_provenance");
    const row = d.prepare("SELECT * FROM song_cache WHERE cache_key = 'k1'").get() as {
      quality_provenance: string | null;
    };
    expect(row.quality_provenance).toBeNull();
  });

  it("song_cache 写入读取 provenance 完成往返，旧记录与损坏 JSON 按未知来源处理", () => {
    const d = state.db!;
    d.exec(`
      CREATE TABLE song_cache (
        cache_key TEXT PRIMARY KEY, source TEXT NOT NULL, filename TEXT NOT NULL,
        size INTEGER NOT NULL, mime TEXT, cached_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL, quality_provenance TEXT
      );
    `);
    const provenance: QualityProvenance = {
      provider: "plugin",
      pluginId: "p1",
      sourceKey: "kg",
      nativeTier: "kugou-master",
      level: "jymaster",
      evidence: "plugin",
    };
    const row: SongCacheRow = {
      cacheKey: "k1",
      source: "kugou",
      filename: "f.bin",
      size: 10,
      mime: null,
      cachedAt: 1,
      lastUsedAt: 1,
      qualityProvenance: provenance,
    };
    upsertCacheRow(row);
    expect(findByKey("k1")?.qualityProvenance).toEqual(provenance);

    upsertCacheRow({ ...row, cacheKey: "k2", qualityProvenance: undefined });
    expect(findByKey("k2")?.qualityProvenance).toBeUndefined();

    // 旧版本直写数据库的非法/损坏数据
    d.prepare("UPDATE song_cache SET quality_provenance = '{oops' WHERE cache_key = 'k2'").run();
    expect(findByKey("k2")?.qualityProvenance).toBeUndefined();
    d.prepare(
      "UPDATE song_cache SET quality_provenance = '{\"provider\":\"evil\"}' WHERE cache_key = 'k2'",
    ).run();
    expect(findByKey("k2")?.qualityProvenance).toBeUndefined();
  });

  it("download_tasks 的 track_json 往返 provenance 与文件印章", () => {
    const d = state.db!;
    d.exec(`
      CREATE TABLE download_tasks (
        task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
        quality_selection TEXT, target_dir TEXT, replace_source_path TEXT, min_level TEXT,
        status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
        file_path TEXT, error_code TEXT, tag_warning INTEGER NOT NULL DEFAULT 0,
        probed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
      );
    `);
    const task = provenanceTask();
    upsertTask(task);
    const rec = findCompletedByPath(task.filePath!);
    expect(rec?.path).toBe(task.filePath);
    expect(rec?.qualityProvenance).toEqual(task.track.qualityProvenance);
    expect(rec?.quality?.codec).toBe("flac");
    expect(rec?.fileSize).toBe(123);
    expect(rec?.mtime).toBe(456);
    expect(listCompletedRecords(task.track)).toHaveLength(1);
    expect(listCompletedPaths(task.track)).toEqual([task.filePath]);
  });

  it("track_json 里非法 provenance 解析为空，流媒体记录不跨服务器命中", () => {
    const d = state.db!;
    d.exec(`
      CREATE TABLE download_tasks (
        task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
        quality_selection TEXT, target_dir TEXT, replace_source_path TEXT, min_level TEXT,
        status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
        file_path TEXT, error_code TEXT, tag_warning INTEGER NOT NULL DEFAULT 0,
        probed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
      );
    `);
    const base = provenanceTask({ taskId: "srv-a", filePath: "a.flac" });
    base.track = {
      ...base.track,
      source: "streaming",
      serverId: "s1",
      originalId: "r1",
      qualityProvenance: {
        provider: "evil",
        evidence: "nope",
        junk: 1,
      } as unknown as QualityProvenance,
    };
    upsertTask(base);
    const rec = findCompletedByPath("a.flac");
    // 非法枚举整体被剔除，不按脏数据透传
    expect(rec?.qualityProvenance).toBeUndefined();
    // 合法的官方 catalog 依据可以往返
    base.track = {
      ...base.track,
      qualityProvenance: { provider: "official", platform: "kugou", evidence: "catalog" },
    };
    upsertTask(base);
    expect(findCompletedByPath("a.flac")?.qualityProvenance?.evidence).toBe("catalog");
    expect(listCompletedRecords(base.track)).toHaveLength(1);
    expect(listCompletedRecords({ ...base.track, originalId: "other" })).toHaveLength(0);
  });
});
