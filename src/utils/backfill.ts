/**
 * 本地音乐封面/歌词补全的纯函数工具
 *
 * 判定"缺什么"、组装只补缺失项的写入请求，独立成模块便于单测。
 */

import type { Track } from "@shared/types/player";
import type { TagEditRequest } from "@shared/types/tagEditor";

/** 待补字段 */
export interface BackfillNeeds {
  cover: boolean;
  lyric: boolean;
}

/**
 * 缺项判定所需的标签信息
 * 主进程批量读取只回这两个字段（内嵌歌词正文不必回传），单曲读取时也能直接映射
 */
export interface BackfillTagInfo {
  hasCover?: boolean;
  /** 内嵌歌词（仅用于判定是否为空；批量读取时由长度替代） */
  lyrics?: string;
  /** 内嵌歌词长度（批量读取回传，优先于 lyrics） */
  lyricLength?: number;
}

/**
 * 依据文件内嵌标签判定缺哪些字段
 * @param tags - 标签信息；读取失败传 null（此时不认为缺任何字段，避免误判导致无谓覆盖）
 */
export const pickBackfillNeeds = (tags: BackfillTagInfo | null | undefined): BackfillNeeds => {
  if (!tags) return { cover: false, lyric: false };
  const lyricLength =
    typeof tags.lyricLength === "number" ? tags.lyricLength : (tags.lyrics ?? "").trim().length;
  return { cover: !tags.hasCover, lyric: lyricLength === 0 };
};

/** 是否有任何待补字段 */
export const hasAnyNeed = (needs: BackfillNeeds): boolean => needs.cover || needs.lyric;

/** 待补字段的稳定短标识（用于日志与去重） */
export const needsKey = (needs: BackfillNeeds): string =>
  `${needs.cover ? "c" : ""}${needs.lyric ? "l" : ""}`;

/** 在线匹配到的可写入内容 */
export interface BackfillFound {
  /** 封面图 URL（http/https） */
  coverUrl?: string;
  /** 歌词文本（已序列化为 LRC） */
  lyricText?: string;
}

/**
 * 组装写入请求：只写本地确实缺失、且在线确实拿到的字段
 *
 * 已有封面/歌词的字段一律不传（引擎按 undefined = 不修改处理），
 * 保证补全动作不会覆盖用户已有的标签内容。
 * @param track - 本地曲目
 * @param needs - 该曲目缺哪些字段
 * @param found - 在线匹配到的封面 / 歌词
 * @returns 可直接交给 writeTags 的请求；没有可写内容时返回 null
 */
export const buildBackfillEdit = (
  track: Track,
  needs: BackfillNeeds,
  found: BackfillFound,
): TagEditRequest | null => {
  if (!track.path) return null;
  const edit: TagEditRequest = { path: track.path };
  if (needs.cover && found.coverUrl && /^https?:\/\//i.test(found.coverUrl)) {
    edit.coverUrl = found.coverUrl;
  }
  if (needs.lyric && found.lyricText && found.lyricText.trim()) {
    edit.lyrics = found.lyricText;
  }
  const writable = edit.coverUrl !== undefined || edit.lyrics !== undefined;
  return writable ? edit : null;
};

/** 补全结果统计 */
export interface BackfillSummary {
  total: number;
  /** 缺封面 */
  needCover: number;
  /** 缺歌词 */
  needLyric: number;
  /** 匹配到可写内容 */
  matched: number;
  /** 无匹配 */
  unmatched: number;
  /** 已写入 */
  written: number;
  /** 写入失败 */
  failed: number;
}

/** 空统计 */
export const emptySummary = (): BackfillSummary => ({
  total: 0,
  needCover: 0,
  needLyric: 0,
  matched: 0,
  unmatched: 0,
  written: 0,
  failed: 0,
});
