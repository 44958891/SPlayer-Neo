// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadTask } from "@shared/types/download";
import type { QualityProvenance } from "@shared/types/quality";
import type { UpsertTrack } from "./queries";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import { getAllTracks, getTracksByIds, upsertTracks } from "./queries";
import { upsert as upsertTask } from "./downloads";
import { resolveQualityBadge } from "@shared/utils/qualityProvenance";

/** 已扫描库行的固定文件印章 */
const STAMP = { fileSize: 4096, mtime: 1700000000000, ctime: 1690000000000 };

/** 插入一条已扫描的本地库行 */
const insertScanned = (over: Partial<UpsertTrack> = {}): UpsertTrack => ({
  id: "local-1",
  path: "C:\\music\\a.flac",
  title: "song",
  artists: [{ id: "ar", name: "artist" }],
  duration: 200000,
  codec: "flac",
  sampleRate: 44100,
  bitRate: 900000,
  channels: 2,
  bitsPerSample: 16,
  ...STAMP,
  ...over,
});

/** 插入一条已完成下载任务，track_json 随存 provenance 与印章 */
const insertDoneTask = (
  filePath: string,
  provenance: QualityProvenance | undefined,
  opts: { finishedAt?: number; stamp?: { fileSize?: number; mtime?: number } } = {},
): void => {
  const task: DownloadTask = {
    taskId: `task-${filePath}-${opts.finishedAt ?? 1}`,
    status: "done",
    qualityLevel: "lossless",
    received: 1,
    total: 1,
    createdAt: 1,
    finishedAt: opts.finishedAt ?? 1,
    filePath,
    track: {
      source: "netease",
      id: "1",
      title: "dl",
      artists: [],
      duration: 1000,
      qualityProvenance: provenance,
      // 显式传 stamp: {} 表示老记录没有印章字段
      fileSize: opts.stamp ? opts.stamp.fileSize : STAMP.fileSize,
      mtime: opts.stamp ? opts.stamp.mtime : STAMP.mtime,
    },
  };
  upsertTask(task);
};

const brand = (pluginId: string): QualityProvenance => ({
  provider: "plugin",
  platform: "netease",
  pluginId,
  evidence: "response",
  level: "lossless",
});

describe("库查询按文件印章关联下载 provenance", () => {
  beforeEach(() => {
    state.db = new Database(":memory:");
    state.db.exec(`
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, cue_path TEXT, cue_audio_path TEXT,
        cue_start_ms INTEGER, cue_end_ms INTEGER, title TEXT NOT NULL, track INTEGER,
        artists TEXT NOT NULL DEFAULT '[]', album TEXT, duration INTEGER NOT NULL, cover TEXT,
        codec TEXT, sample_rate INTEGER, bit_rate INTEGER, channels INTEGER,
        bits_per_sample INTEGER, file_size INTEGER NOT NULL, file_mtime INTEGER,
        file_ctime INTEGER, scanned_at INTEGER NOT NULL
      );
      CREATE TABLE download_tasks (
        task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
        quality_selection TEXT,
        status TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
        file_path TEXT, error_code TEXT, tag_warning INTEGER NOT NULL DEFAULT 0,
        probed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
      );
    `);
  });
  afterEach(() => state.db?.close());

  it("路径与印章一致的已完成下载给库行带上 validated provenance", () => {
    upsertTracks([insertScanned()]);
    insertDoneTask("C:\\music\\a.flac", brand("p1"));
    const [track] = getAllTracks();
    expect(track.qualityProvenance).toEqual(brand("p1"));
    expect(getTracksByIds(["local-1"])[0]?.qualityProvenance).toEqual(brand("p1"));
  });

  it("同一本地库的网易 Master、QQ 臻品和未知 Master 各自保存显示，重读不串标", () => {
    upsertTracks([
      insertScanned({
        id: "ncm",
        path: "C:\\music\\netease.flac",
        sampleRate: 192000,
        bitsPerSample: 24,
      }),
      insertScanned({ id: "qq", path: "C:\\music\\qq.flac", sampleRate: 96000, bitsPerSample: 24 }),
      insertScanned({
        id: "unknown",
        path: "C:\\music\\unknown.flac",
        sampleRate: 192000,
        bitsPerSample: 24,
      }),
    ]);
    insertDoneTask("C:\\music\\netease.flac", {
      provider: "official",
      platform: "netease",
      nativeTier: "jymaster",
      evidence: "response",
      level: "jymaster",
    });
    insertDoneTask("C:\\music\\qq.flac", {
      provider: "plugin",
      platform: "qqmusic",
      nativeTier: "qq-premium-2.0",
      evidence: "plugin",
      level: "sky",
      pluginId: "qq-plugin",
    });
    for (let read = 0; read < 2; read++) {
      const tracks = Object.fromEntries(getAllTracks().map((track) => [track.id, track]));
      const ncm = resolveQualityBadge(tracks.ncm.quality, tracks.ncm.qualityProvenance);
      const qq = resolveQualityBadge(tracks.qq.quality, tracks.qq.qualityProvenance);
      const unknown = resolveQualityBadge(tracks.unknown.quality, tracks.unknown.qualityProvenance);
      expect(ncm).toMatchObject({ platform: "netease", tier: "netease-master" });
      expect(qq).toMatchObject({ platform: "qqmusic", tier: "qq-premium" });
      expect(unknown).toMatchObject({ level: "jymaster", platform: undefined, tier: undefined });
      expect(tracks.qq.source).toBe("local");
    }
  });

  it("文件被替换（重扫 size/mtime 变化）后不再继承品牌依据", () => {
    upsertTracks([insertScanned()]);
    insertDoneTask("C:\\music\\a.flac", brand("p1"));
    // 用户替换了文件，重扫后印章变化
    upsertTracks([insertScanned({ fileSize: 8192 })]);
    expect(getAllTracks()[0]?.qualityProvenance).toBeUndefined();
  });

  it("旧下载记录没有文件印章时不给库行品牌", () => {
    upsertTracks([insertScanned()]);
    insertDoneTask("C:\\music\\a.flac", brand("p1"), { stamp: {} });
    expect(getAllTracks()[0]?.qualityProvenance).toBeUndefined();
  });

  it("CUE 分轨行不继承整文件品牌依据，容器行正常关联", () => {
    upsertTracks([
      // 容器整轨：cue_path 为空，是真实下载文件
      insertScanned({ id: "container", path: "C:\\music\\full.flac" }),
      // 分轨：cue_path 非空，path 为虚拟路径
      insertScanned({
        id: "segment",
        path: "C:\\music\\full.flac||I. Allegro",
        cuePath: "C:\\music\\full.cue",
        cueAudioPath: "C:\\music\\full.flac",
        cueStartMs: 0,
        cueEndMs: 1000,
      }),
    ]);
    insertDoneTask("C:\\music\\full.flac", brand("p1"));
    const tracks = Object.fromEntries(getAllTracks().map((t) => [t.id, t]));
    expect(tracks.container?.qualityProvenance).toEqual(brand("p1"));
    expect(tracks.segment?.qualityProvenance).toBeUndefined();
  });

  it("同路径多条历史 done 记录取最新一条，且不产生重复行", () => {
    upsertTracks([insertScanned()]);
    insertDoneTask("C:\\music\\a.flac", brand("old"), { finishedAt: 1 });
    insertDoneTask("C:\\music\\a.flac", brand("new"), { finishedAt: 2 });
    const tracks = getAllTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.qualityProvenance).toEqual(brand("new"));
  });

  it("最新记录印章不符时直接放弃，不回退匹配旧记录的巧合印章", () => {
    upsertTracks([insertScanned()]);
    // 旧记录的印章恰好等于当前库行
    insertDoneTask("C:\\music\\a.flac", brand("old"), { finishedAt: 1 });
    // 更新的下载已替换该路径文件（库行尚未重扫，size/mtime 不同）
    insertDoneTask("C:\\music\\a.flac", brand("new"), {
      finishedAt: 2,
      stamp: { fileSize: 999999, mtime: 1111 },
    });
    // 只认最新记录：印章不符 → 不带品牌，绝不用旧记录的巧合匹配给新文件贴旧品牌
    expect(getAllTracks()[0]?.qualityProvenance).toBeUndefined();
  });

  it("track_json 里的损坏 provenance 不透传", () => {
    upsertTracks([insertScanned()]);
    insertDoneTask("C:\\music\\a.flac", undefined);
    state
      .db!.prepare(
        "UPDATE download_tasks SET track_json = json_set(track_json, '$.qualityProvenance', json('{\"provider\":\"evil\"}')) WHERE file_path = ?",
      )
      .run("C:\\music\\a.flac");
    expect(getAllTracks()[0]?.qualityProvenance).toBeUndefined();
  });
});
