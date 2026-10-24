/**
 * 咪咕音乐 API 常量（主进程）
 *
 * 字段形状与归一化工具在 shared/utils/migu/config.ts，主/渲染两侧共用同一份。
 */

export type {
  MgImgItem,
  MgSong,
  MgAlbumItem,
  MgSingerItem,
  MgSearchResponse,
} from "@shared/utils/migu/config";
export {
  mgCover,
  mgDuration,
  mgQuality,
  mgIsVip,
  buildSearchSwitch,
} from "@shared/utils/migu/config";

/** 搜索接口基址 */
export const MG_SEARCH_URL = "https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do";

/** 请求伪装头（该网关对 UA 敏感，非浏览器 UA 直接拒绝） */
export const MG_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://music.migu.cn/",
};
