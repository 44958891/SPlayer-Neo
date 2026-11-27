import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PLATFORMS, type Platform } from "@shared/types/platform";
import type { PlaylistFavorite, PlaylistFavoriteInput } from "@shared/types/playlist";

import { usePlaylistFavoritesStore } from "./playlistFavorites";

const favoriteApi = {
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
};

/** 构造收藏记录 */
const record = (source: Platform, originId: string): PlaylistFavorite => ({
  source,
  originId,
  title: `歌单-${originId}`,
  createTime: 1000,
});

/** 构造收藏输入 */
const input = (source: Platform, originId: string): PlaylistFavoriteInput => ({
  source,
  originId,
  title: `歌单-${originId}`,
});

/** 构造手动 resolve 的 Promise */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/** 等待若干微任务，让进入 await 前的同步段先执行 */
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

describe("playlistFavorites store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { playlist: { ...favoriteApi } },
    });
    favoriteApi.listFavorites.mockReset().mockResolvedValue([]);
    favoriteApi.addFavorite.mockReset();
    favoriteApi.removeFavorite.mockReset().mockResolvedValue(undefined);
  });

  it("并发 load 复用同一请求且成功后填充列表", async () => {
    favoriteApi.listFavorites.mockResolvedValue([record("netease", "a1")]);
    const store = usePlaylistFavoritesStore();
    await Promise.all([store.load(), store.load(), store.load()]);
    expect(favoriteApi.listFavorites).toHaveBeenCalledTimes(1);
    expect(store.initialized).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.favorites.map((item) => item.originId)).toEqual(["a1"]);
  });

  it("load 失败抛出且保持未初始化可重试", async () => {
    favoriteApi.listFavorites.mockRejectedValueOnce(new Error("ipc down"));
    const store = usePlaylistFavoritesStore();
    await expect(store.load()).rejects.toThrow("ipc down");
    expect(store.initialized).toBe(false);
    favoriteApi.listFavorites.mockResolvedValue([]);
    await store.load();
    expect(store.initialized).toBe(true);
    expect(store.favorites).toEqual([]);
  });

  it("add 写成功后才更新列表", async () => {
    const gate = deferred<PlaylistFavorite>();
    favoriteApi.addFavorite.mockReturnValue(gate.promise);
    const store = usePlaylistFavoritesStore();
    await store.load();
    const pending = store.add(input("kuwo", "b1"));
    await flushMicrotasks();
    expect(favoriteApi.addFavorite).toHaveBeenCalledTimes(1);
    expect(store.favorites).toEqual([]);
    gate.resolve(record("kuwo", "b1"));
    await pending;
    expect(store.favorites.map((item) => item.originId)).toEqual(["b1"]);
  });

  it("add 失败抛出且保持原列表", async () => {
    favoriteApi.listFavorites.mockResolvedValue([record("netease", "a1")]);
    favoriteApi.addFavorite.mockRejectedValue(new Error("write failed"));
    const store = usePlaylistFavoritesStore();
    await store.load();
    await expect(store.add(input("qqmusic", "x"))).rejects.toThrow("write failed");
    expect(store.favorites.map((item) => item.originId)).toEqual(["a1"]);
    expect(store.isFavorite("qqmusic", "x")).toBe(false);
  });

  it("未初始化时 add 先等待 load，不丢磁盘已有收藏", async () => {
    const gate = deferred<PlaylistFavorite[]>();
    favoriteApi.listFavorites.mockReturnValue(gate.promise);
    favoriteApi.addFavorite.mockResolvedValue(record("migu", "b1"));
    const store = usePlaylistFavoritesStore();
    const pendingAdd = store.add(input("migu", "b1"));
    await flushMicrotasks();
    // load 未完成前不发起写入
    expect(favoriteApi.addFavorite).not.toHaveBeenCalled();
    gate.resolve([record("netease", "a1")]);
    await pendingAdd;
    expect(store.favorites.map((item) => item.originId)).toEqual(["b1", "a1"]);
  });

  it("load 在途写入完成后，过期快照不回滚新变更", async () => {
    favoriteApi.listFavorites.mockResolvedValueOnce([record("netease", "a1")]);
    const writeGate = deferred<PlaylistFavorite>();
    favoriteApi.addFavorite.mockReturnValue(writeGate.promise);
    const loadGate = deferred<PlaylistFavorite[]>();
    const store = usePlaylistFavoritesStore();
    await store.load();
    favoriteApi.listFavorites.mockReturnValue(loadGate.promise);
    const pendingLoad = store.load();
    const pendingAdd = store.add(input("kuwo", "b1"));
    await flushMicrotasks();
    writeGate.resolve(record("kuwo", "b1"));
    await pendingAdd;
    // 过期快照不含新写入
    loadGate.resolve([record("netease", "a1")]);
    await pendingLoad;
    expect(store.favorites.map((item) => item.originId)).toEqual(["b1", "a1"]);
  });

  it("已收藏时 add 去重不发请求", async () => {
    favoriteApi.listFavorites.mockResolvedValue([record("netease", "a1")]);
    const store = usePlaylistFavoritesStore();
    await store.load();
    const result = await store.add(input("netease", "a1"));
    expect(result).toBeNull();
    expect(favoriteApi.addFavorite).not.toHaveBeenCalled();
    expect(store.favorites).toHaveLength(1);
  });

  it("并发重复 add 仅一次请求且列表唯一", async () => {
    favoriteApi.addFavorite.mockResolvedValue(record("kuwo", "same"));
    const store = usePlaylistFavoritesStore();
    await store.load();
    await Promise.all([store.add(input("kuwo", "same")), store.add(input("kuwo", "same"))]);
    expect(favoriteApi.addFavorite).toHaveBeenCalledTimes(1);
    expect(store.favorites).toHaveLength(1);
  });

  it("remove 成功移除；不存在时静默不发请求", async () => {
    favoriteApi.listFavorites.mockResolvedValue([record("netease", "a1")]);
    const store = usePlaylistFavoritesStore();
    await store.load();
    await store.remove("netease", "a1");
    expect(favoriteApi.removeFavorite).toHaveBeenCalledWith("netease", "a1");
    expect(store.favorites).toEqual([]);
    favoriteApi.removeFavorite.mockClear();
    await store.remove("netease", "ghost");
    expect(favoriteApi.removeFavorite).not.toHaveBeenCalled();
  });

  it("remove 失败抛出且保持原列表", async () => {
    favoriteApi.listFavorites.mockResolvedValue([record("netease", "a1")]);
    favoriteApi.removeFavorite.mockRejectedValue(new Error("write failed"));
    const store = usePlaylistFavoritesStore();
    await store.load();
    await expect(store.remove("netease", "a1")).rejects.toThrow("write failed");
    expect(store.favorites.map((item) => item.originId)).toEqual(["a1"]);
  });

  it("五平台同 id 收藏互不影响且不依赖登录态", async () => {
    favoriteApi.addFavorite.mockImplementation(async (value: PlaylistFavoriteInput) =>
      record(value.source, value.originId),
    );
    const store = usePlaylistFavoritesStore();
    await store.load();
    for (const source of ALL_PLATFORMS) await store.add(input(source, "shared"));
    expect(store.favorites).toHaveLength(5);
    for (const source of ALL_PLATFORMS) expect(store.isFavorite(source, "shared")).toBe(true);
    expect(store.isFavorite("kuwo", "other")).toBe(false);
    await store.remove("kuwo", "shared");
    expect(store.isFavorite("kuwo", "shared")).toBe(false);
    expect(store.isFavorite("netease", "shared")).toBe(true);
  });
});
