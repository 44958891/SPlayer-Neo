import { validateQualityProvenance } from "@shared/utils/qualityProvenance";
import { QUALITY_ORDER } from "@shared/utils/quality";
import type { ResolvedAudioFile } from "@shared/types/quality";
import type { DownloadTask, DownloadTrackIdentity } from "@shared/types/download";
import type { Track } from "@shared/types/player";
import { getDb } from "./index";

/** sqlite 原始行 */
interface RawRow {
  task_id: string;
  track_json: string;
  quality_level: string;
  quality_selection: string | null;
  status: string;
  received: number;
  total: number;
  file_path: string | null;
  error_code: string | null;
  tag_warning: number;
  probed: number;
  created_at: number;
  finished_at: number | null;
  target_dir: string | null;
  replace_source_path: string | null;
  min_level: string | null;
}

/** sqlite 行 → 业务 DownloadTask */
const toTask = (raw: RawRow): DownloadTask => {
  // 升级参数旧行为 NULL → undefined，不猜测原路径；min_level 严格按档位枚举校验，未知值丢弃
  const minLevel =
    raw.min_level != null &&
    QUALITY_ORDER.includes(raw.min_level as NonNullable<DownloadTask["minLevel"]>)
      ? (raw.min_level as NonNullable<DownloadTask["minLevel"]>)
      : undefined;
  return {
    taskId: raw.task_id,
    track: JSON.parse(raw.track_json) as Track,
    qualityLevel: raw.quality_level as DownloadTask["qualityLevel"],
    qualitySelection: raw.quality_selection ?? undefined,
    status: raw.status as DownloadTask["status"],
    received: raw.received,
    total: raw.total,
    filePath: raw.file_path ?? undefined,
    errorCode: raw.error_code ?? undefined,
    tagWarning: raw.tag_warning === 1,
    probed: raw.probed === 1,
    createdAt: raw.created_at,
    finishedAt: raw.finished_at ?? undefined,
    targetDir: raw.target_dir ?? undefined,
    replaceSourcePath: raw.replace_source_path ?? undefined,
    minLevel,
  };
};

/** 写入或覆盖一条任务 */
export const upsert = (task: DownloadTask): void => {
  getDb()
    .prepare(
      `INSERT INTO download_tasks
         (task_id, track_json, quality_level, quality_selection, status, received, total, file_path, error_code, tag_warning, probed, created_at, finished_at, target_dir, replace_source_path, min_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         track_json = excluded.track_json,
         quality_level = excluded.quality_level,
         quality_selection = excluded.quality_selection,
         status = excluded.status,
         received = excluded.received,
         total = excluded.total,
         file_path = excluded.file_path,
         error_code = excluded.error_code,
         tag_warning = excluded.tag_warning,
         probed = excluded.probed,
         finished_at = excluded.finished_at,
         target_dir = excluded.target_dir,
         replace_source_path = excluded.replace_source_path,
         min_level = excluded.min_level`,
    )
    .run(
      task.taskId,
      JSON.stringify(task.track),
      task.qualityLevel,
      task.qualitySelection ?? null,
      task.status,
      task.received,
      task.total,
      task.filePath ?? null,
      task.errorCode ?? null,
      task.tagWarning ? 1 : 0,
      task.probed ? 1 : 0,
      task.createdAt,
      task.finishedAt ?? null,
      task.targetDir ?? null,
      task.replaceSourcePath ?? null,
      task.minLevel ?? null,
    );
};

/** 按 id 查 */
export const findById = (taskId: string): DownloadTask | null => {
  const raw = getDb().prepare("SELECT * FROM download_tasks WHERE task_id = ?").get(taskId) as
    RawRow | undefined;
  return raw ? toTask(raw) : null;
};

/** 列出全部任务，最新在前 */
export const listAll = (): DownloadTask[] => {
  const rows = getDb()
    .prepare("SELECT * FROM download_tasks ORDER BY created_at DESC")
    .all() as RawRow[];
  return rows.map(toTask);
};

/** 已完成任务随文件保存的音质信息（文件身份印章 + 来源依据） */
export interface CompletedFileRecord extends ResolvedAudioFile {
  /** 落盘时记录的文件大小，用于识别文件是否被替换 */
  fileSize?: number;
  /** 落盘时记录的修改时间（Unix ms），用于识别文件是否被替换 */
  mtime?: number;
}

/**
 * 从 track_json 解析已完成记录的音质信息
 * provenance 经跨库 JSON 解码，统一走 validateQualityProvenance 剔除非法数据
 * @param trackJson - 任务行保存的 track JSON
 * @param filePath - 已完成文件路径
 * @returns 音质信息；解析失败返回仅含路径的记录
 */
const toFileRecord = (trackJson: string, filePath: string): CompletedFileRecord => {
  const track = JSON.parse(trackJson) as Track;
  return {
    path: filePath,
    quality: track.quality,
    qualityProvenance: validateQualityProvenance(track.qualityProvenance),
    fileSize: track.fileSize,
    mtime: track.mtime,
  };
};

/**
 * 按精确路径查询已完成记录的音质信息（单行查询，不做逐行扫描）
 * @param filePath - 音频文件绝对路径
 * @returns 随存的音质信息；无对应已完成任务返回 null
 */
export const findCompletedByPath = (filePath: string): CompletedFileRecord | null => {
  const raw = getDb()
    .prepare(
      `SELECT track_json, file_path FROM download_tasks
       WHERE status = 'done' AND file_path = ?
       ORDER BY finished_at DESC, created_at DESC, task_id DESC
       LIMIT 1`,
    )
    .get(filePath) as { track_json: string; file_path: string } | undefined;
  return raw ? toFileRecord(raw.track_json, raw.file_path) : null;
};

/**
 * 精确查询歌曲的已完成文件路径
 * @param track - 歌曲身份，流媒体需匹配服务器和原始 ID
 * @returns 按完成时间倒序排列的候选文件路径
 */
export const listCompletedPaths = (track: DownloadTrackIdentity): string[] => {
  const rows = getDb()
    .prepare(
      `SELECT file_path FROM download_tasks
       WHERE status = 'done' AND file_path IS NOT NULL
         AND json_extract(track_json, '$.source') = ?
         AND json_extract(track_json, '$.id') = ?
         AND (? != 'streaming' OR (
           json_extract(track_json, '$.serverId') = ?
           AND json_extract(track_json, '$.originalId') = ?
         ))
       ORDER BY finished_at DESC, created_at DESC, task_id DESC`,
    )
    .all(
      track.source,
      track.id,
      track.source,
      track.serverId ?? null,
      track.originalId ?? null,
    ) as {
    file_path: string;
  }[];
  return rows.map((row) => row.file_path);
};

/**
 * 精确查询歌曲的已完成文件及随存音质信息（lookupInfo 用，候选量极小不做批量优化）
 * @param track - 歌曲身份，流媒体需匹配服务器和原始 ID
 * @returns 按完成时间倒序排列的候选记录
 */
export const listCompletedRecords = (track: DownloadTrackIdentity): CompletedFileRecord[] => {
  const rows = getDb()
    .prepare(
      `SELECT track_json, file_path FROM download_tasks
       WHERE status = 'done' AND file_path IS NOT NULL
         AND json_extract(track_json, '$.source') = ?
         AND json_extract(track_json, '$.id') = ?
         AND (? != 'streaming' OR (
           json_extract(track_json, '$.serverId') = ?
           AND json_extract(track_json, '$.originalId') = ?
         ))
       ORDER BY finished_at DESC, created_at DESC, task_id DESC`,
    )
    .all(
      track.source,
      track.id,
      track.source,
      track.serverId ?? null,
      track.originalId ?? null,
    ) as { track_json: string; file_path: string }[];
  return rows.map((row) => toFileRecord(row.track_json, row.file_path));
};

/** 列出指定音质的已完成任务（用于重复下载去重） */
export const listCompletedByQuality = (quality: string): DownloadTask[] => {
  const rows = getDb()
    .prepare("SELECT * FROM download_tasks WHERE status = 'done' AND quality_level = ?")
    .all(quality) as RawRow[];
  return rows.map(toTask);
};

/** 删除一条 */
export const remove = (taskId: string): void => {
  getDb().prepare("DELETE FROM download_tasks WHERE task_id = ?").run(taskId);
};

/** 删除全部已结束（非进行中）任务 */
export const clearFinished = (): void => {
  getDb().prepare("DELETE FROM download_tasks WHERE status NOT IN ('queued','downloading')").run();
};

/** 启动时把残留的进行中任务重置为中断 */
export const markInterrupted = (): void => {
  getDb()
    .prepare(
      "UPDATE download_tasks SET status = 'interrupted' WHERE status IN ('queued','downloading')",
    )
    .run();
};
