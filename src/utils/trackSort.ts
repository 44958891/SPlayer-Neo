import type { Track } from "@shared/types/player";
import type { SortField, SortOrder } from "@/types/list";

/** 排序器：默认 base 敏感度（忽略大小写），数字按自然序 */
const textCollator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

/**
 * 按当前列表排序规则排列曲目
 *
 * 列表页的「播放全部」必须走这里，否则队列顺序是曲库原始顺序、
 * 与用户看到的排序（标题/歌手/时长…）不一致。
 * 排序规则与 SongList 的列排序保持一致（含同值时的标题、id 兜底）。
 *
 * @param tracks - 原始曲目列表
 * @param field - 排序字段，none 表示保持原顺序
 * @param order - 排序方向
 * @returns 新数组，不修改入参
 */
export const sortTracks = (
  tracks: readonly Track[],
  field: SortField,
  order: SortOrder,
): Track[] => {
  if (field === "none") return [...tracks];
  const direction = order === "asc" ? 1 : -1;
  const artistText = (track: Track): string => track.artists.map((a) => a.name).join(" / ");
  const albumText = (track: Track): string => track.album?.name ?? "";
  const pathText = (track: Track): string => track.path ?? "";

  const compare = (a: Track, b: Track): number => {
    let value = 0;
    if (field === "title") value = textCollator.compare(a.title, b.title);
    else if (field === "artist") value = textCollator.compare(artistText(a), artistText(b));
    else if (field === "album") value = textCollator.compare(albumText(a), albumText(b));
    else if (field === "path") value = textCollator.compare(pathText(a), pathText(b));
    else if (field === "duration") value = a.duration - b.duration;
    else if (field === "size") value = (a.fileSize ?? 0) - (b.fileSize ?? 0);
    else if (field === "mtime") value = (a.mtime ?? 0) - (b.mtime ?? 0);
    else if (field === "ctime") value = (a.ctime ?? 0) - (b.ctime ?? 0);
    else value = (a.track ?? 0) - (b.track ?? 0);
    if (value !== 0) return value * direction;
    const fallback = textCollator.compare(a.title, b.title);
    if (fallback !== 0) return fallback;
    return textCollator.compare(a.id, b.id);
  };

  return [...tracks].sort(compare);
};
