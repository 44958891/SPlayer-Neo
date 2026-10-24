import type { Track } from "@shared/types/player";
import { normalizeBase, normalizeTitle } from "./qualityUpgrade";

/**
 * 在线曲目「本地已有」判定
 *
 * 在线歌单/搜索结果里标出本地音乐库中已有的同一首歌，避免重复下载或重复入库。
 * 判定口径与音质升级的匹配规则一致：标题（忽略大小写/空白/括号）+ 歌手重合 + 时长 ±5s，
 * 只是这里做的是「存在性」判断，不做版本词过滤（本地存的就是 Live 版也算已有）。
 */

/** 时长窗口（毫秒） */
const DURATION_WINDOW_MS = 5_000;

/** 本地曲目索引：按归一化标题分桶，避免每行都全表扫描 */
export interface LocalMatchIndex {
  buckets: Map<string, Track[]>;
}

/** 拆分并归一化艺术家名 */
const artistTokens = (artists: { name: string }[] | undefined): string[] =>
  (artists ?? [])
    .flatMap((artist) => String(artist?.name ?? "").split(/[/、,&＋+]|\s+&\s+/))
    .map((name) => normalizeBase(name))
    .filter(Boolean);

/**
 * 构建本地曲目索引
 * @param tracks - 本地音乐库曲目
 */
export const buildLocalMatchIndex = (tracks: readonly Track[]): LocalMatchIndex => {
  const buckets = new Map<string, Track[]>();
  for (const track of tracks) {
    if (!track?.title) continue;
    const key = normalizeTitle(track.title);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(track);
    else buckets.set(key, [track]);
  }
  return { buckets };
};

/**
 * 判断在线曲目是否已存在于本地库
 * @param index - 本地索引
 * @param online - 在线曲目
 * @returns 命中的本地曲目，未命中返回 null
 */
export const findLocalMatch = (index: LocalMatchIndex, online: Track): Track | null => {
  if (!online?.title) return null;
  const key = normalizeTitle(online.title);
  const bucket = index.buckets.get(key);
  if (!bucket?.length) return null;
  const onlineArtists = artistTokens(online.artists);
  for (const local of bucket) {
    // 时长：双方都有值时必须在窗口内
    if (online.duration > 0 && local.duration > 0) {
      if (Math.abs(online.duration - local.duration) > DURATION_WINDOW_MS) continue;
    }
    const localArtists = artistTokens(local.artists);
    // 歌手：任一方缺失时按标题 + 时长放行；都有值时要求有交集
    if (onlineArtists.length > 0 && localArtists.length > 0) {
      const hit = onlineArtists.some((name) => localArtists.includes(name));
      if (!hit) continue;
    }
    return local;
  }
  return null;
};
