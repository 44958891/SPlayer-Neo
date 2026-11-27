import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import type { PlaylistFavorite, PlaylistFavoriteInput } from "@shared/types/playlist";
import { getDb } from "./index";

interface PlaylistFavoriteRow {
  source: string;
  origin_id: string;
  title: string;
  cover: string | null;
  created_at: number;
}

/** 原平台歌单 ID 长度上限 */
const MAX_ORIGIN_ID_LENGTH = 128;
/** 歌单标题长度上限 */
const MAX_TITLE_LENGTH = 200;
/** 封面 URL 长度上限 */
const MAX_COVER_LENGTH = 2048;

/**
 * 校验封面 URL，错误信息不携带原始值
 * @param cover - renderer 传入的封面，空串或纯空白视为未提供
 * @returns 可落库的封面 URL，未提供时返回 null
 */
const normalizeCover = (cover: string | undefined): string | null => {
  if (cover === undefined) return null;
  if (typeof cover !== "string") throw new Error("歌单封面无效");
  const trimmed = cover.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_COVER_LENGTH) throw new Error("歌单封面无效");
  let protocol = "";
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    // 非法 URL 一律拒绝
  }
  if (protocol !== "http:" && protocol !== "https:") throw new Error("歌单封面无效");
  return trimmed;
};

/**
 * 校验并规整收藏输入，错误信息不携带原始值
 * @param input - renderer 传入的收藏信息
 * @returns 规整后的收藏字段
 */
const normalizeFavoriteInput = (
  input: PlaylistFavoriteInput,
): { source: Platform; originId: string; title: string; cover: string | null } => {
  if (!input || typeof input !== "object") throw new Error("收藏参数无效");
  if (!isPlatform(input.source)) throw new Error("收藏来源平台无效");
  const originId = typeof input.originId === "string" ? input.originId.trim() : "";
  if (!originId || originId.length > MAX_ORIGIN_ID_LENGTH) throw new Error("歌单 ID 无效");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > MAX_TITLE_LENGTH) throw new Error("歌单标题无效");
  return { source: input.source, originId, title, cover: normalizeCover(input.cover) };
};

/**
 * 转换数据库收藏行
 * @param row - 数据库查询结果
 * @returns renderer 可用的收藏记录
 */
const toFavorite = (row: PlaylistFavoriteRow): PlaylistFavorite => ({
  source: row.source as Platform,
  originId: row.origin_id,
  title: row.title,
  cover: row.cover ?? undefined,
  createTime: row.created_at,
});

/**
 * 获取全部在线歌单收藏，按收藏时间倒序，同时间按复合键排序保证确定性
 * @returns 收藏列表
 */
export const listPlaylistFavorites = (): PlaylistFavorite[] => {
  const rows = getDb()
    .prepare(
      `SELECT source, origin_id, title, cover, created_at
       FROM playlist_favorites
       ORDER BY created_at DESC, source, origin_id`,
    )
    .all() as PlaylistFavoriteRow[];
  return rows.map(toFavorite);
};

/**
 * 收藏在线歌单，复合键 source + origin_id upsert：
 * 重复收藏只刷新标题与封面，保留原收藏时间
 * @param input - 收藏信息
 * @returns 收藏后的记录
 */
export const addPlaylistFavorite = (input: PlaylistFavoriteInput): PlaylistFavorite => {
  const { source, originId, title, cover } = normalizeFavoriteInput(input);
  const database = getDb();
  database
    .prepare(
      `INSERT INTO playlist_favorites (source, origin_id, title, cover, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source, origin_id)
       DO UPDATE SET title = excluded.title, cover = excluded.cover`,
    )
    .run(source, originId, title, cover, Date.now());
  const row = database
    .prepare(
      `SELECT source, origin_id, title, cover, created_at
       FROM playlist_favorites
       WHERE source = ? AND origin_id = ?`,
    )
    .get(source, originId) as PlaylistFavoriteRow;
  return toFavorite(row);
};

/**
 * 取消收藏在线歌单，仅按 source + originId 复合键删除，不影响其他收藏
 * @param source - 原平台，IPC 入口为外部输入，经 isPlatform 收窄
 * @param originId - 原平台歌单 ID
 */
export const removePlaylistFavorite = (source: string, originId: string): void => {
  if (!isPlatform(source)) throw new Error("收藏来源平台无效");
  const id = typeof originId === "string" ? originId.trim() : "";
  if (!id || id.length > MAX_ORIGIN_ID_LENGTH) throw new Error("歌单 ID 无效");
  getDb()
    .prepare("DELETE FROM playlist_favorites WHERE source = ? AND origin_id = ?")
    .run(source, id);
};
