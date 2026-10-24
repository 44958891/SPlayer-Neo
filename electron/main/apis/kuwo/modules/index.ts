/**
 * 酷我模块注册表
 */

import type { KWModule } from "../core/types";

import search from "./search";
import songUrl from "./song_url";
import { album, artist, cover, playlist, userInfo } from "./collections";

export const modules: Record<string, KWModule> = {
  search,
  album,
  artist,
  playlist,
  cover,
  user_info: userInfo,
  song_url: songUrl,
};
