/**
 * 咪咕歌词匹配
 *
 * 咪咕没有可用的「按 id 取歌词」接口：歌词地址（lyricUrl）只随搜索结果一起下发，
 * 且该地址是静态 OSS 文件（UTF-8 LRC）。因此：
 *  - getByPlatformId 无解，返回 null
 *  - getByQuery 走 search_all 拿候选，挑最佳后直接抓 lyricUrl
 *
 * 宿主侧对 migu 的歌词请求因此统一走 query 路径（见 services/lyric/request.ts）。
 */

import { callMigu } from "@main/apis/migu";
import { pickBestCandidate, buildLyricSearchKeyword, type LyricCandidate } from "./utils";
import { setCachedLyric } from "@main/database/lyricCache";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import type { MgSearchResponse, MgSong } from "@shared/utils/migu/config";
import { mgCover, mgDuration, mgIsVip } from "@shared/utils/migu/config";

/** 抓取 OSS 上的 LRC 文本 */
const fetchLyricUrl = async (lyricUrl: string): Promise<string | null> => {
  try {
    const res = await fetch(lyricUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) return null;
    // 歌词文件为 UTF-8 LRC（实测），不做转码
    const text = await res.text();
    return text.trim() ? text : null;
  } catch (err) {
    coreLog.warn("[lyric:migu] fetch lyricUrl failed:", err);
    return null;
  }
};

/** 把 lyricUrl 结果包装成统一结构 */
const toResult = (content: string): LyricMatchResult => ({
  platform: "migu",
  format: "lrc",
  content,
  translation: undefined,
  translationFormat: undefined,
  romaji: undefined,
  romajiFormat: undefined,
});

/**
 * 按 id 取歌词：咪咕无此能力（需要搜索或 lyricUrl），返回 null
 * @param _id - 咪咕歌曲 id（未使用）
 */
export const getByPlatformId = async (_id: string): Promise<LyricMatchResult | null> => null;

/** 按 Track 元数据搜索：search → 挑最佳 → 抓 lyricUrl */
export const getByQuery = async (track: Track): Promise<LyricMatchResult | null> => {
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, "migu");
  if (cached) {
    // 缓存存的是 lyricUrl（而非 id），直接复用可省一次搜索
    const content = await fetchLyricUrl(cached.platformId);
    if (content) return toResult(content);
  }

  const keyword = buildLyricSearchKeyword(track);
  if (!keyword) return null;

  const candidates: LyricCandidate<MgSong>[] = [];
  try {
    const body = await callMigu<MgSearchResponse>("search", {
      keywords: keyword,
      type: "song",
      limit: 25,
    });
    for (const song of body.songResultData?.result ?? []) {
      if (!song.lyricUrl) continue;
      const cover = mgCover(song.imgItems, "02");
      candidates.push({
        name: song.name,
        artist: (song.singers ?? []).map((artist) => artist.name).join("/"),
        album: song.albums?.[0]?.name,
        duration: mgDuration(song),
        extra: song,
      });
      coreLog.info(
        `[lyric:migu] candidate "${song.name}" ${mgIsVip(song) ? "vip" : "free"} cover=${cover ? "yes" : "no"}`,
      );
    }
  } catch (err) {
    coreLog.warn(`[lyric:migu] search("${keyword}") failed:`, err);
    return null;
  }

  const best = pickBestCandidate(candidates, track);
  coreLog.info(
    `[lyric:migu] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  const lyricUrl = best?.extra.lyricUrl;
  if (!best || !lyricUrl) return null;
  const content = await fetchLyricUrl(lyricUrl);
  if (!content) return null;
  setMatchedId(fingerprint, "migu", lyricUrl);
  setCachedLyric("migu", lyricUrl, toResult(content));
  return toResult(content);
};
