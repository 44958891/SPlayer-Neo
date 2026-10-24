/**
 * Kuwo 歌词匹配
 *
 * 两个入口：
 *  - getByPlatformId(id) 按数字 id 直取
 *  - getByQuery(track)   search → pickBestCandidate → 单次请求拿歌词
 *
 * 返回只带原生格式文本（lrc + 翻译合并交由渲染端），不做解析。
 */

import { callKuwo } from "@main/apis/kuwo";
import type { KWSong } from "@main/apis/kuwo/core/types";
import { KW_HEADERS, KW_LYRIC_URL, decodeKwName } from "@main/apis/kuwo/core/config";
import { kuwoCookieHeader } from "@main/apis/kuwo/core/request";
import { getCachedLyric, setCachedLyric } from "@main/database/lyricCache";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { buildLyricSearchKeyword, pickBestCandidate, type LyricCandidate } from "./utils";

interface SongInfoLrcResp {
  status?: number;
  data?: {
    lrclist?: Array<{ lineLyric?: string; time?: string }> | null;
  } | null;
}

interface SearchResponse {
  code: number;
  total: number;
  songs?: KWSong[];
}

/**
 * 把酷我逐行结构转换为标准 LRC 文本
 * @param list - lrclist
 */
const toLrcText = (list: Array<{ lineLyric?: string; time?: string }>): string => {
  const lines: string[] = [];
  for (const item of list) {
    const text = decodeKwName(item.lineLyric ?? "");
    if (!text) continue;
    const seconds = Number(item.time ?? 0) || 0;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    const stamp = `${minutes.toString().padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
    lines.push(`[${stamp}]${text}`);
  }
  return lines.join("\n");
};

/**
 * 拉取指定歌曲歌词
 * @param id - 酷我数字 id
 */
const fetchLyric = async (id: string): Promise<LyricMatchResult | null> => {
  const cached = getCachedLyric("kuwo", id);
  if (cached) return cached;
  // 歌词端点在部分请求上返回 301（同参数重试或稍后可成功），重试 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `${KW_LYRIC_URL}?musicId=${encodeURIComponent(id)}&httpsStatus=1`;
      const cookie = kuwoCookieHeader();
      const res = await fetch(url, {
        headers: { ...KW_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status !== 200) continue;
      const body = JSON.parse(await res.text()) as SongInfoLrcResp;
      const list = body.data?.lrclist ?? [];
      if (!list.length) continue;
      const content = toLrcText(list);
      if (!content) continue;
      const result: LyricMatchResult = {
        platform: "kuwo",
        format: "lrc",
        content,
        translation: undefined,
        translationFormat: undefined,
        romaji: undefined,
        romajiFormat: undefined,
      };
      setCachedLyric("kuwo", id, result);
      return result;
    } catch (err) {
      coreLog.warn(`[lyric:kuwo] fetchLyric(${id}) attempt ${attempt + 1} failed:`, err);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
};

/** 按酷我数字 id 直取 */
export const getByPlatformId = (id: string): Promise<LyricMatchResult | null> => fetchLyric(id);

/** 按 Track 元数据模糊搜索：search → 挑最佳 → 单次请求歌词 */
export const getByQuery = async (track: Track): Promise<LyricMatchResult | null> => {
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, "kuwo");
  if (cached) return fetchLyric(cached.platformId);

  const keyword = buildLyricSearchKeyword(track);
  if (!keyword) return null;

  const candidates: LyricCandidate<{ id: string }>[] = [];
  try {
    const body = await callKuwo<SearchResponse>("search", { keywords: keyword, limit: 25 });
    if (body.code !== 200) return null;
    for (const song of body.songs ?? []) {
      candidates.push({
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        extra: { id: song.id },
      });
    }
  } catch (err) {
    coreLog.warn(`[lyric:kuwo] search("${keyword}") failed:`, err);
    return null;
  }

  const best = pickBestCandidate(candidates, track);
  coreLog.info(
    `[lyric:kuwo] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  if (!best) return null;
  setMatchedId(fingerprint, "kuwo", best.extra.id);
  return fetchLyric(best.extra.id);
};
