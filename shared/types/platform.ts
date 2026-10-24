/** 平台类型 */
export type Platform = "netease" | "qqmusic" | "kugou" | "kuwo" | "migu";

/** 平台简写 */
export const PLATFORM_SHORT_NAME: Record<Platform, string> = {
  netease: "NCM",
  qqmusic: "QM",
  kugou: "KG",
  kuwo: "KW",
  migu: "MG",
};

/** 平台完整名称（下拉、提示用） */
export const PLATFORM_NAME: Record<Platform, string> = {
  netease: "网易云音乐",
  qqmusic: "QQ音乐",
  kugou: "酷狗音乐",
  kuwo: "酷我音乐",
  migu: "咪咕音乐",
};

/** 全部平台 */
export const ALL_PLATFORMS: Platform[] = ["netease", "qqmusic", "kugou", "kuwo", "migu"];

const PLATFORM_SET = new Set<string>(ALL_PLATFORMS);

/** 判断给定 source 是否为在线平台（netease / qqmusic / kugou / kuwo / migu），同时类型收窄 */
export const isPlatform = (source: string | undefined): source is Platform =>
  source !== undefined && PLATFORM_SET.has(source);

/** 平台用户账号资料 */
export interface PlatformProfile {
  userId: string;
  nickname: string;
  avatarUrl: string;
  isVip: boolean;
  vipLevel?: number;
}
