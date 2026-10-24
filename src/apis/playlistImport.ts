/**
 * 歌单链接导入：解析各平台分享链接 / 纯 ID，拉取元数据与全部曲目
 *
 * 支持：网易云（含 163cn.tv 短链）、QQ音乐、酷狗（specialid）、酷我；咪咕歌单接口已下线，仅支持纯 ID 时报错
 */

import type { Playlist, Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import * as netease from "./playlist/netease";
import * as qqmusic from "./playlist/qqmusic";
import * as kugou from "./playlist/kugou";
import * as kuwo from "./playlist/kuwo";

/** 解析结果：平台 + 歌单 ID */
export interface ParsedPlaylistLink {
  platform: Platform;
  id: string;
}

const NETEASE_PATTERNS = [
  /music\.163\.com\/(?:#\/)?playlist\?id=(\d+)/i,
  /music\.163\.com\/playlist\/(\d+)/i,
];
const QQ_PATTERNS = [
  /y\.qq\.com\/n\/ryqq\/playlist\/([0-9A-Za-z]+)/i,
  /i\.y\.qq\.com\/[^]*?[?&]id=(\d+)/i,
];
const KUGOU_PATTERNS = [/kugou\.com\/(?:yy\/special\/single|special)\/(\d+)/i];
const KUWO_PATTERNS = [/kuwo\.cn\/(?:m\.kuwo\.cn\/newh5app\/)?playlist_detail\/(\d+)/i];

const matchFirst = (patterns: RegExp[], input: string): string | null => {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

/** 短链域名：需要主进程跟随重定向后再解析 */
const isShortLink = (input: string): boolean => /^https?:\/\/(?:www\.)?163cn\.tv\//i.test(input);

/**
 * 解析歌单链接 / 纯 ID
 * @param input 用户粘贴的链接或纯 ID
 * @param fallbackPlatform 纯 ID 时使用的平台
 */
export const parsePlaylistLink = (
  input: string,
  fallbackPlatform: Platform,
): ParsedPlaylistLink | null => {
  const text = input.trim();
  if (!text) return null;
  for (const [patterns, platform] of [
    [NETEASE_PATTERNS, "netease"],
    [QQ_PATTERNS, "qqmusic"],
    [KUGOU_PATTERNS, "kugou"],
    [KUWO_PATTERNS, "kuwo"],
  ] as const) {
    const id = matchFirst([...patterns], text);
    if (id) return { platform, id };
  }
  // 纯数字 / 纯字母数字 ID：按指定平台
  if (/^[0-9A-Za-z]{4,32}$/.test(text)) return { platform: fallbackPlatform, id: text };
  return null;
};

/** 拉取单个歌单（已解析） */
export const fetchRemotePlaylist = async (
  parsed: ParsedPlaylistLink,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const { platform, id } = parsed;
  if (platform === "netease") {
    let playlist: Playlist | null = null;
    const tracks: Track[] = [];
    await netease.fetchPlaylist(id, {
      onMeta: (value) => {
        playlist = value;
      },
      onBatch: (batch) => tracks.push(...batch),
    });
    if (!playlist) throw new Error("歌单不存在或已私有");
    return { playlist, tracks };
  }
  if (platform === "qqmusic") return qqmusic.fetchQQMusicPlaylist(id, "导入的歌单");
  if (platform === "kugou") return kugou.fetchKugouPlaylist(id, "导入的歌单");
  if (platform === "kuwo") return kuwo.fetchKuwoPlaylist(id, "导入的歌单");
  if (platform === "migu") throw new Error("咪咕歌单接口已下线，暂不支持导入");
  throw new Error(`平台不支持: ${platform}`);
};

/**
 * 解析可能包含短链的输入：短链先经主进程跟随重定向
 */
export const parseWithShortLink = async (
  input: string,
  fallbackPlatform: Platform,
): Promise<ParsedPlaylistLink | null> => {
  const text = input.trim();
  if (isShortLink(text)) {
    const res = await window.api.system.resolveRedirect(text);
    if (!res.success || !res.url) throw new Error(res.error || "短链解析失败");
    return parsePlaylistLink(res.url, fallbackPlatform);
  }
  return parsePlaylistLink(text, fallbackPlatform);
};
