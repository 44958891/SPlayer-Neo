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

describe("数据库迁移 v6 → v7", () => {
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
    expect(db.pragma("user_version", { simple: true })).toBe(7);
  });

  it("迁移可重复执行（幂等）", () => {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(7);
  });
});
