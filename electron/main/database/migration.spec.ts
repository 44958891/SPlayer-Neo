// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "./migration";

/** v6 形态的 download_tasks（无 quality_selection 列） */
const V6_TABLE = `
  CREATE TABLE download_tasks (
    task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
    status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
    file_path TEXT, error_code TEXT, tag_warning INTEGER NOT NULL DEFAULT 0,
    probed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
  );
  CREATE TABLE song_cache (
    cache_key TEXT PRIMARY KEY, source TEXT NOT NULL, filename TEXT NOT NULL,
    size INTEGER NOT NULL, mime TEXT, cached_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
  );
  CREATE TABLE lyric_match_cache (
    fingerprint TEXT NOT NULL, platform TEXT NOT NULL, matched_at INTEGER NOT NULL,
    PRIMARY KEY (fingerprint, platform)
  );
`;

describe("数据库迁移 v6 → v9", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(V6_TABLE);
    db.pragma("user_version = 6");
  });

  afterEach(() => db.close());

  it("补 download_tasks.quality_selection 列并推进版本号", () => {
    migrate(db);
    const cols = (db.prepare("PRAGMA table_info(download_tasks)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("quality_selection");
    expect(db.pragma("user_version", { simple: true })).toBe(9);
  });

  it("迁移可重复执行（幂等）", () => {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(9);
  });

  it("v8 迁移补齐升级参数三列且旧数据保留", () => {
    db.exec(
      "INSERT INTO download_tasks (task_id, track_json, quality_level, status, received, total, created_at) VALUES ('old', '{}', 'hq', 'failed', 0, 0, 1)",
    );
    migrate(db);
    const cols = (db.prepare("PRAGMA table_info(download_tasks)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(
      expect.arrayContaining(["target_dir", "replace_source_path", "min_level"]),
    );
    const row = db
      .prepare(
        "SELECT target_dir, replace_source_path, min_level FROM download_tasks WHERE task_id = 'old'",
      )
      .get() as {
      target_dir: string | null;
      replace_source_path: string | null;
      min_level: string | null;
    };
    expect(row).toEqual({ target_dir: null, replace_source_path: null, min_level: null });
  });
});

describe("数据库迁移 v7 → v9", () => {
  /** v7 形态的最小表集：download_tasks 已含 quality_selection，无升级参数三列 */
  const V7_TABLE = `
    CREATE TABLE download_tasks (
      task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
      quality_selection TEXT, status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, file_path TEXT, error_code TEXT,
      tag_warning INTEGER NOT NULL DEFAULT 0, probed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, finished_at INTEGER
    );
    CREATE TABLE lyric_match_cache (
      fingerprint TEXT NOT NULL, platform TEXT NOT NULL, matched_at INTEGER NOT NULL,
      PRIMARY KEY (fingerprint, platform)
    );
  `;

  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(V7_TABLE);
    db.pragma("user_version = 7");
  });

  afterEach(() => db.close());

  it("补升级参数三列直升 v9，v7 已有数据原样保留", () => {
    db.exec(
      "INSERT INTO download_tasks (task_id, track_json, quality_level, quality_selection, status, received, total, created_at) VALUES ('t7', '{}', 'jymaster', 'kugou:kugou-master', 'failed', 0, 0, 1)",
    );
    migrate(db);
    const cols = (db.prepare("PRAGMA table_info(download_tasks)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(
      expect.arrayContaining(["target_dir", "replace_source_path", "min_level"]),
    );
    expect(db.pragma("user_version", { simple: true })).toBe(9);
    const row = db
      .prepare("SELECT quality_selection, target_dir FROM download_tasks WHERE task_id = 't7'")
      .get() as { quality_selection: string; target_dir: string | null };
    expect(row.quality_selection).toBe("kugou:kugou-master");
    expect(row.target_dir).toBeNull();
  });
});

describe("数据库迁移 v8 → v9", () => {
  /** v8 形态的最小表集：含升级参数三列，另带旧歌单数据验证保表 */
  const V8_TABLE = `
    CREATE TABLE download_tasks (
      task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
      quality_selection TEXT, target_dir TEXT, replace_source_path TEXT, min_level TEXT,
      status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
      file_path TEXT, error_code TEXT, tag_warning INTEGER NOT NULL DEFAULT 0,
      probed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
    );
    CREATE TABLE lyric_match_cache (
      fingerprint TEXT NOT NULL, platform TEXT NOT NULL, extra TEXT,
      matched_at INTEGER NOT NULL, PRIMARY KEY (fingerprint, platform)
    );
    CREATE TABLE playlists (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
      cover TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `;

  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(V8_TABLE);
    db.pragma("user_version = 8");
    db.exec(
      "INSERT INTO playlists (id, type, title, description, cover, created_at, updated_at) VALUES ('pl_old', 'local', '旧歌单', NULL, NULL, 1, 1)",
    );
    db.exec(
      "INSERT INTO download_tasks (task_id, track_json, quality_level, quality_selection, status, received, total, created_at) VALUES ('t8', '{}', 'hq', NULL, 'done', 1, 1, 1)",
    );
  });

  afterEach(() => db.close());

  it("新建 playlist_favorites 表和索引并直升 v9，旧表旧数据原样保留", () => {
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(9);
    const tableRow = db
      .prepare(
        "SELECT type FROM sqlite_master WHERE type = 'table' AND name = 'playlist_favorites'",
      )
      .get() as { type: string } | undefined;
    const indexRow = db
      .prepare(
        "SELECT type FROM sqlite_master WHERE type = 'index' AND name = 'idx_playlist_favorites_created'",
      )
      .get() as { type: string } | undefined;
    expect(tableRow?.type).toBe("table");
    expect(indexRow?.type).toBe("index");
    const oldPlaylist = db.prepare("SELECT id, title FROM playlists WHERE id = 'pl_old'").get() as
      { id: string; title: string } | undefined;
    expect(oldPlaylist).toEqual({ id: "pl_old", title: "旧歌单" });
    const oldTask = db
      .prepare("SELECT quality_selection, min_level FROM download_tasks WHERE task_id = 't8'")
      .get() as { quality_selection: string | null; min_level: string | null };
    expect(oldTask).toEqual({ quality_selection: null, min_level: null });
    // 新表可按复合键正常写入
    db.exec(
      "INSERT INTO playlist_favorites (source, origin_id, title, cover, created_at) VALUES ('netease', '1', '新收藏', NULL, 1)",
    );
    const row = db
      .prepare("SELECT source, origin_id FROM playlist_favorites WHERE source = 'netease'")
      .get() as { source: string; origin_id: string };
    expect(row).toEqual({ source: "netease", origin_id: "1" });
  });

  it("迁移可重复执行（幂等）", () => {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(9);
  });
});
