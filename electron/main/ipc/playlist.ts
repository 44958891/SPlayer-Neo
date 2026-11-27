import { ipcMain } from "electron";
import type {
  LegacyPlaylistRecord,
  PlaylistCreateInput,
  PlaylistFavoriteInput,
  PlaylistUpdateInput,
} from "@shared/types/playlist";
import {
  addPlaylistTrackObjects,
  addPlaylistTracks,
  clearPlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  getPlaylists,
  importLegacyPlaylists,
  removePlaylistTracks,
  updatePlaylist,
} from "@main/database/playlists";
import {
  addPlaylistFavorite,
  listPlaylistFavorites,
  removePlaylistFavorite,
} from "@main/database/playlistFavorites";
/** 注册统一歌单 IPC */
export const registerPlaylistIpc = (): void => {
  ipcMain.handle("playlist:list", getPlaylists);
  ipcMain.handle("playlist:get", (_event, id: string) => getPlaylist(id));
  ipcMain.handle("playlist:create", (_event, input: PlaylistCreateInput) => createPlaylist(input));
  ipcMain.handle("playlist:update", (_event, id: string, input: PlaylistUpdateInput) =>
    updatePlaylist(id, input),
  );
  ipcMain.handle("playlist:remove", (_event, id: string) => deletePlaylist(id));
  ipcMain.handle("playlist:addTracks", (_event, id: string, trackIds: string[]) =>
    addPlaylistTracks(id, trackIds),
  );
  ipcMain.handle("playlist:addTrackObjects", (_event, id: string, tracks: unknown[]) =>
    addPlaylistTrackObjects(id, tracks as Parameters<typeof addPlaylistTrackObjects>[1]),
  );
  ipcMain.handle("playlist:removeTracks", (_event, id: string, trackIds: string[]) =>
    removePlaylistTracks(id, trackIds),
  );
  ipcMain.handle("playlist:importLegacy", (_event, records: LegacyPlaylistRecord[]) =>
    importLegacyPlaylists(records),
  );
  ipcMain.handle("playlist:clear", clearPlaylists);
  ipcMain.handle("playlist:listFavorites", () => listPlaylistFavorites());
  ipcMain.handle("playlist:addFavorite", (_event, input: PlaylistFavoriteInput) =>
    addPlaylistFavorite(input),
  );
  ipcMain.handle("playlist:removeFavorite", (_event, source: string, originId: string) =>
    removePlaylistFavorite(source, originId),
  );
};
