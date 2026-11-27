/**
 * 咪咕模块注册表
 */

import { search } from "./search";
import { album, albumSongs } from "./album";
import { playlist, playlistDiscover, playlistSongs } from "./playlist";

export const modules: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  search: (params) => search(params as Parameters<typeof search>[0]),
  album: (params) => album(params as Parameters<typeof album>[0]),
  album_songs: (params) => albumSongs(params as Parameters<typeof albumSongs>[0]),
  playlist: (params) => playlist(params as Parameters<typeof playlist>[0]),
  playlist_songs: (params) => playlistSongs(params as Parameters<typeof playlistSongs>[0]),
  playlist_discover: (params) => playlistDiscover(params as Parameters<typeof playlistDiscover>[0]),
};
