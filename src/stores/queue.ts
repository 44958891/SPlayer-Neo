import localforage from "localforage";
import type { PlaybackContext, PlaybackQueueItem, Track } from "@shared/types/player";

/** 持久化存储实例 */
const db = localforage.createInstance({ name: "splayer", storeName: "queue" });

type PersistedQueueItem = Track | PlaybackQueueItem;

/** 兼容旧版本直接持久化的 Track 队列 */
const restoreQueueItem = (value: PersistedQueueItem): PlaybackQueueItem => {
  if (typeof value.track === "object" && value.track !== null) return value as PlaybackQueueItem;
  return { track: value as Track };
};

const createQueueItem = (track: Track, context?: PlaybackContext): PlaybackQueueItem =>
  context ? { track, context } : { track };

/** 当前播放队列项 */
export const queueEntries = shallowRef<PlaybackQueueItem[]>([]);

/** 供界面和音源预载消费的纯曲目列表 */
export const queue = computed<Track[]>(() => queueEntries.value.map((item) => item.track));

/** 队列中的歌曲总数 */
export const queueLength = computed(() => queue.value.length);

/** 保存当前播放列表数据 */
const save = (): void => {
  db.setItem("playList", toRaw(queueEntries.value)).catch(console.error);
};

/** 恢复播放列表数据 */
export const restoreQueue = async (): Promise<void> => {
  try {
    const list = await db.getItem<PersistedQueueItem[]>("playList");
    if (!list?.length) return;
    queueEntries.value = list.map(restoreQueueItem);
  } catch (e) {
    console.error("[queue] 恢复持久化数据失败:", e);
  }
};

/**
 * 替换整个队列
 * @param items - 新的歌曲列表
 * @param context - 队列中曲目共用的播放来源上下文
 */
export const setQueue = (items: readonly Track[], context?: PlaybackContext): void => {
  queueEntries.value = items.map((track) => createQueueItem(track, context));
  save();
};

/**
 * 在指定位置插入一首歌
 * @param item - 要插入的歌曲
 * @param index - 插入位置（该位置原有元素后移）
 * @param context - 播放来源上下文
 */
export const insertToQueue = (item: Track, index: number, context?: PlaybackContext): void => {
  const entry = createQueueItem(item, context);
  const safeIndex = Math.max(0, Math.min(index, queueEntries.value.length));
  const next = [...queueEntries.value];
  next.splice(safeIndex, 0, entry);
  queueEntries.value = next;
  save();
};

/**
 * 在指定位置批量插入曲目，一次性切片与持久化（避免逐首插入的 O(n²) 与多次落盘）
 * @param items - 要插入的歌曲
 * @param index - 插入位置（该位置原有元素后移）
 * @param context - 播放来源上下文
 */
export const insertManyToQueue = (
  items: Track[],
  index: number,
  context?: PlaybackContext,
): void => {
  if (items.length === 0) return;
  const entries = items.map((track) => createQueueItem(track, context));
  const list = queueEntries.value;
  const safeIndex = Math.max(0, Math.min(index, list.length));
  queueEntries.value = [...list.slice(0, safeIndex), ...entries, ...list.slice(safeIndex)];
  save();
};

/**
 * 按 id 替换队列中的曲目数据（标签编辑后同步显示）
 * @param updates - 更新后的 Track 列表
 */
export const updateQueueTracks = (updates: readonly Track[]): void => {
  if (updates.length === 0) return;
  const byId = new Map(updates.map((item) => [item.id, item]));
  const touched = queueEntries.value.some((item) => byId.has(item.track.id));
  if (!touched) return;
  queueEntries.value = queueEntries.value.map((item) => ({
    ...item,
    track: byId.get(item.track.id) ?? item.track,
  }));
  save();
};

/**
 * 更新队列项的曲目和播放上下文
 * @param index - 队列索引
 * @param track - 曲目
 * @param context - 播放来源上下文
 */
export const updateQueueItem = (index: number, track: Track, context?: PlaybackContext): void => {
  if (index < 0 || index >= queueEntries.value.length) return;
  const replacement = createQueueItem(track, context);
  const next = [...queueEntries.value];
  next[index] = replacement;
  queueEntries.value = next;
  save();
};

/**
 * 移除指定服务器的全部流媒体歌曲
 * @param serverId - 服务器 ID
 */
export const removeServerTracks = (serverId: string): void => {
  const belongsToServer = (track: Track): boolean =>
    track.source === "streaming" && track.serverId === serverId;
  const next = queueEntries.value.filter((item) => !belongsToServer(item.track));
  if (next.length === queueEntries.value.length) return;
  queueEntries.value = next;
  save();
};

/**
 * 移除指定位置的歌曲
 * @param index - 要移除的位置，越界时静默忽略
 */
export const removeFromQueue = (index: number): void => {
  if (index < 0 || index >= queueEntries.value.length) return;
  const next = [...queueEntries.value];
  next.splice(index, 1);
  queueEntries.value = next;
  save();
};

/**
 * 将歌曲从一个位置移动到另一个位置
 * @param fromIndex - 原位置
 * @param toIndex - 目标位置
 */
export const moveInQueue = (fromIndex: number, toIndex: number): void => {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= queueEntries.value.length) return;
  if (toIndex < 0 || toIndex >= queueEntries.value.length) return;
  const next = [...queueEntries.value];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  queueEntries.value = next;
  save();
};

/**
 * 清空队列
 */
export const clearQueue = (): void => {
  queueEntries.value = [];
  save();
};

/**
 * 根据索引获取 Track
 * @param index - 队列索引
 * @returns 对应的 Track，越界时返回 null
 */
export const getTrack = (index: number): Track | null => {
  return getQueueItem(index)?.track ?? null;
};

/**
 * 根据索引获取队列项
 * @param index - 队列索引
 * @returns 队列项，越界时返回 null
 */
export const getQueueItem = (index: number): PlaybackQueueItem | null => {
  return index >= 0 && index < queueEntries.value.length ? queueEntries.value[index] : null;
};

/**
 * 根据 ID 查找 Track 在队列中的索引
 * @param trackId - 歌曲 ID
 * @returns 索引位置，未找到返回 -1
 */
export const findTrackIndex = (trackId: string): number => {
  return queueEntries.value.findIndex((item) => item.track.id === trackId);
};
