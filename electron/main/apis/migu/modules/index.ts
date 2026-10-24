/**
 * 咪咕模块注册表
 */

import { search } from "./search";
import { album, albumSongs } from "./album";

export const modules: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  search: (params) => search(params as Parameters<typeof search>[0]),
  album: (params) => album(params as Parameters<typeof album>[0]),
  album_songs: (params) => albumSongs(params as Parameters<typeof albumSongs>[0]),
};
