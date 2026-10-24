/**
 * 酷我（Kuwo）API 常量与工具
 *
 * 搜索/详情走 search.kuwo.cn 的 r.s 通道（老 web 接口，返回单引号伪 JSON），
 * 播放地址走 antiserver（无损常被拒，实际优先由插件 kw 通道解析）。
 */

/** 搜索与详情接口基址 */
export const KW_SEARCH_URL = "http://search.kuwo.cn/r.s";

/** 播放地址接口（convert_url） */
export const KW_ANTI_URL = "http://antiserver.kuwo.cn/anti.s";

/** 歌单详情接口 */
export const KW_PLAYLIST_URL = "http://nplserver.kuwo.cn/pl.svc";

/** 歌词接口 */
export const KW_LYRIC_URL = "http://m.kuwo.cn/newh5/singles/songinfoandlrc";

/** 账号信息接口（登录态查询）；wapi 与主站同为官方 API 网关 */
export const KW_USER_INFO_URL = "https://www.kuwo.cn/api/www/user/info";

/** 歌曲封面 CDN 模板（web_albumpic_short 相对路径） */
export const KW_COVER_BASE = "https://img1.kuwo.cn/star/albumcover";

/** 歌手头像 CDN 模板 */
export const KW_ARTIST_PIC_BASE = "https://img3.kuwo.cn/star/starheads";

/** 请求伪装头（歌词与详情接口对 Referer 敏感） */
export const KW_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.kuwo.cn/",
};

/** HTML 实体反转义表 */
const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#039;": "'",
  "&apos": "'",
};

/** HTML 实体反转义（含双重转义残留的 \u0026） */
export const decodeKwName = (name: string | undefined | null): string => {
  if (!name) return "";
  let out = name.replace(/\u0026/gi, "&");
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    out = out.split(entity).join(char);
  }
  return out.trim();
};

/**
 * 解析酷我伪 JSON（key/value 均用单引号）
 *
 * 酷我值内出现的单引号会被自身转义为 HTML 实体，因此全局替换单引号是安全的；
 * 标准 JSON 响应直接 parse。
 * @param text - 原始响应文本
 */
export const parseKwJson = <T = Record<string, unknown>>(text: string): T => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty kw response");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("invalid kw response");
    const normalized = trimmed.slice(start, end + 1).replace(/'/g, '"');
    return JSON.parse(normalized) as T;
  }
};

/** 歌曲音质描述（由 FORMATS 字段推导） */
export interface KwQuality {
  codec: string;
  sampleRate: number;
  bitsPerSample: number;
  bitRate: number;
}

/**
 * 解析 FORMATS 字段得到可用最高音质
 * @param formats - 形如 `AAC48|ALFLAC|MP3128|MP3H`
 */
export const parseKwQuality = (formats: string | undefined | null): KwQuality | undefined => {
  if (!formats) return undefined;
  const set = new Set(formats.split("|").map((item) => item.trim().toUpperCase()));
  if (set.has("ALFLAC")) {
    return { codec: "flac", sampleRate: 44100, bitsPerSample: 16, bitRate: 0 };
  }
  if (set.has("MP3H") || set.has("MP3192")) {
    return { codec: "mp3", sampleRate: 44100, bitsPerSample: 16, bitRate: 320000 };
  }
  if (set.has("MP3128") || set.has("OGG192")) {
    return { codec: "mp3", sampleRate: 44100, bitsPerSample: 16, bitRate: 128000 };
  }
  if (set.has("WMA128") || set.has("AAC48")) {
    return { codec: "aac", sampleRate: 44100, bitsPerSample: 16, bitRate: 48000 };
  }
  return undefined;
};

/**
 * 从 MUSICRID 提取纯数字 id
 * @param rid - 形如 `MUSIC_51685512`
 */
export const kwIdFromRid = (rid: string | undefined | null): string => {
  if (!rid) return "";
  return String(rid)
    .replace(/^MUSIC_/i, "")
    .trim();
};

/**
 * 拼接封面地址
 * @param shortPath - web_albumpic_short 相对路径
 * @param size - 目标边长（120 / 240 / 300 / 500）
 */
export const fillKwCover = (
  shortPath: string | undefined | null,
  size: number = 300,
): string | undefined => {
  if (!shortPath) return undefined;
  const path = shortPath.replace(/^\d+\//, "");
  return `${KW_COVER_BASE}/${size}/${path}`;
};

/**
 * 拼接歌手头像地址
 * @param shortPath - PICPATH 相对路径
 */
export const fillKwArtistPic = (shortPath: string | undefined | null): string | undefined => {
  if (!shortPath) return undefined;
  const path = shortPath.replace(/^\d+\//, "");
  return `${KW_ARTIST_PIC_BASE}/240/${path}`;
};
