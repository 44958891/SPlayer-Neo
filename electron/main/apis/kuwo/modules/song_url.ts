/**
 * 酷我播放地址模块
 *
 * 走 antiserver 的 convert_url（mp3/aac 可用；flac 常被拒 → 调用方应优先插件 kw 通道）。
 * 返回 `{ code, url, level }`；url 为空表示不可用。
 */

import type { PluginQuality } from "@shared/types/plugin";
import { KW_ANTI_URL, KW_HEADERS } from "../core/config";
import type { KWModule } from "../core/types";

/** 宿主档位 → antiserver 的 format/br 参数 */
const LEVEL_TO_KW_QUERY: Partial<Record<PluginQuality, string>> = {
  jymaster: "format=flac",
  sky: "format=flac",
  jyeffect: "format=flac",
  "hi-res": "format=flac",
  lossless: "format=flac",
  hq: "format=mp3&br=320kmp3",
  sq: "format=mp3&br=192kmp3",
  lq: "format=mp3&br=128kmp3",
};

/** antiserver 返回文本 → URL（拒答时是 `refuse request!`） */
const extractUrl = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
};

const songUrl: KWModule = async (params) => {
  const { id, level = "hq" } = params as { id?: string; level?: PluginQuality };
  if (!id) return { code: 400, message: "id required" };
  const query = LEVEL_TO_KW_QUERY[level] ?? LEVEL_TO_KW_QUERY.hq!;
  const url = `${KW_ANTI_URL}?type=convert_url&rid=MUSIC_${encodeURIComponent(id)}&response=url&${query}`;
  const res = await fetch(url, { headers: KW_HEADERS, signal: AbortSignal.timeout(10000) });
  if (res.status !== 200) return { code: res.status, message: `KW HTTP ${res.status}` };
  const resolved = extractUrl(await res.text());
  if (!resolved) return { code: 403, message: "kw url refused" };
  return { code: 200, url: resolved, level };
};

export default songUrl;
