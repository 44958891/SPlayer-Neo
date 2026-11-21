import type Database from "better-sqlite3";

/** 当前 schema 版本 */
const SCHEMA_VERSION = 8;

type TableInfoRow = { name: string };

/** 判断表是否存在指定列 */
const hasColumn = (d: Database.Database, table: string, column: string): boolean => {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((r) => r.name === column);
};

/** 执行数据库迁移 */
export const migrate = (d: Database.Database): void => {
  const version = d.pragma("user_version", { simple: true }) as number;
  let v = version;

  // v1 → v2: 添加 file_mtime / file_ctime 列
  if (v < 2) {
    if (!hasColumn(d, "tracks", "file_mtime")) {
      d.exec("ALTER TABLE tracks ADD COLUMN file_mtime INTEGER");
    }
    if (!hasColumn(d, "tracks", "file_ctime")) {
      d.exec("ALTER TABLE tracks ADD COLUMN file_ctime INTEGER");
    }
    v = 2;
  }

  // v2 → v3: 添加 track 列
  if (v < 3) {
    if (!hasColumn(d, "tracks", "track")) {
      d.exec("ALTER TABLE tracks ADD COLUMN track INTEGER");
    }
    v = 3;
  }

  // v3 → v4: 添加 CUE 分轨列
  if (v < 4) {
    if (!hasColumn(d, "tracks", "cue_path")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_path TEXT");
    }
    if (!hasColumn(d, "tracks", "cue_audio_path")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_audio_path TEXT");
    }
    if (!hasColumn(d, "tracks", "cue_start_ms")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_start_ms INTEGER");
    }
    if (!hasColumn(d, "tracks", "cue_end_ms")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_end_ms INTEGER");
    }
    v = 4;
  }

  // v4 → v5: 下载任务记录是否已回填实际音质，避免每次启动重复探测全部历史文件
  if (v < 5) {
    if (!hasColumn(d, "download_tasks", "probed")) {
      d.exec("ALTER TABLE download_tasks ADD COLUMN probed INTEGER NOT NULL DEFAULT 0");
    }
    v = 5;
  }

  // v5 → v6: 歌曲缓存随存解析来源的音质依据；旧记录留空按未知来源处理
  if (v < 6) {
    if (!hasColumn(d, "song_cache", "quality_provenance")) {
      d.exec("ALTER TABLE song_cache ADD COLUMN quality_provenance TEXT");
    }
    v = 6;
  }

  // v6 → v7: 下载任务随存平台具体音质选择，区分同通用等级下的不同品牌档位
  if (v < 7) {
    if (!hasColumn(d, "download_tasks", "quality_selection")) {
      d.exec("ALTER TABLE download_tasks ADD COLUMN quality_selection TEXT");
    }
    v = 7;
  }

  // v7 → v8: 下载任务持久化升级参数（落地目录/待替换原文件/显式物理下限），
  // 重启后失败任务重试仍可继续原位升级；旧行为 NULL 照常兼容
  if (v < 8) {
    if (!hasColumn(d, "download_tasks", "target_dir")) {
      d.exec("ALTER TABLE download_tasks ADD COLUMN target_dir TEXT");
    }
    if (!hasColumn(d, "download_tasks", "replace_source_path")) {
      d.exec("ALTER TABLE download_tasks ADD COLUMN replace_source_path TEXT");
    }
    if (!hasColumn(d, "download_tasks", "min_level")) {
      d.exec("ALTER TABLE download_tasks ADD COLUMN min_level TEXT");
    }
    v = 8;
  }

  // 版本无关部分
  // 补 lyric_match_cache.extra 列
  if (!hasColumn(d, "lyric_match_cache", "extra")) {
    d.exec("ALTER TABLE lyric_match_cache ADD COLUMN extra TEXT");
  }

  if (v < SCHEMA_VERSION) v = SCHEMA_VERSION;
  if (v !== version) {
    d.pragma(`user_version = ${v}`);
  }
};
