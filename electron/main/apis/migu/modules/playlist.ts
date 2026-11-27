/**
 * 咪咕歌单模块
 *
 * 三条链路均为官方 v5 网页前端（music.migu.cn/v5）实际调用的接口：
 * - 发现：`pc/bmw/page-data/playlist-square-recommend` 歌单广场运营位，官方运营的
 *   动态真实歌单池（场景歌单/编辑推荐等区块），无需登录态
 * - 详情：`resource/playlist/v2.0`（标题/封面/创建者/曲目数）
 * - 曲目：`MIGUM3.0/resource/playlist/song/v2.0`，官方前端按 pageSize=50 翻页
 *
 * 搜索接口的歌单类目已下线（searchSwitch.playlist 返回空），发现只能走运营位池。
 */

import { mgRequest } from "../core/request";
import type {
  MgPlaylistCard,
  MgPlaylistDetailResponse,
  MgPlaylistSongsResponse,
  MgPlaylistSquareItem,
  MgSquareGroup,
  MgSquarePageResponse,
} from "@shared/utils/migu/config";

/** 歌单广场运营位接口 */
const MG_SQUARE_URL = "https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0";

/** 歌单详情接口 */
const MG_PLAYLIST_DETAIL_URL = "https://app.c.nf.migu.cn/resource/playlist/v2.0";

/** 歌单曲目接口 */
const MG_PLAYLIST_SONGS_URL = "https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0";

/** 歌单参数 */
export interface MgPlaylistParams {
  id?: string;
}

/** 歌单曲目参数 */
export interface MgPlaylistSongsParams {
  id?: string;
  /** 页码，从 1 开始 */
  page?: number;
  /** 每页条数，官方前端固定 50 */
  limit?: number;
}

/** 歌单发现参数 */
export interface MgPlaylistDiscoverParams {
  /** 页码，从 1 开始 */
  page?: number;
  /** 每页条数，缺省返回全部 */
  limit?: number;
  /** 按区块名筛选（场景歌单/编辑推荐等，子串匹配） */
  topic?: string;
}

/** 从歌单条目提取 id（resId 优先，logEvent 兜底） */
const cardId = (item: MgPlaylistSquareItem): string =>
  (item.resId ?? item.logEvent?.contentId ?? "").trim();

/** 从歌单条目提取标题（txt 优先，logEvent 兜底） */
const cardTitle = (item: MgPlaylistSquareItem): string =>
  (item.txt ?? item.logEvent?.contentName ?? "").trim();

/**
 * 判断区块节点是否为歌单条目区块
 * @param group - 广场区块节点
 */
const isSongListGroup = (group: MgSquareGroup): boolean => {
  const view = group.view ?? "";
  return view === "ZJ-SongList-Scroll" || view.includes("playlist_square");
};

/**
 * 解析歌单广场运营位为归一化卡片列表
 *
 * 与官方前端一致的两种区块形态：
 * - `playlist_square_*`：contents[0] 嵌套标题、contents[1] 为歌单条目
 * - `ZJ-Title` 后邻 `ZJ-SongList-Scroll`：标题在 contents[0].txt，条目在后邻区块
 * @param contents - 广场页 contents 数组
 * @returns 按歌单 id 去重后的卡片
 */
export const parseSquareContents = (contents: MgSquareGroup[] = []): MgPlaylistCard[] => {
  const cards = new Map<string, MgPlaylistCard>();
  contents.forEach((group, index) => {
    const view = group.view ?? "";
    let section = "";
    let items: MgPlaylistSquareItem[] = [];
    if (view.includes("playlist_square")) {
      const groups = group.contents ?? [];
      section = groups[0]?.contents?.[0]?.txt ?? "";
      items = groups[1]?.contents ?? [];
    } else if (view === "ZJ-Title") {
      const next = contents[index + 1];
      if (!next || !isSongListGroup(next)) return;
      section = group.contents?.[0]?.txt ?? "";
      items = next.contents ?? [];
    } else {
      return;
    }
    for (const item of items) {
      const id = cardId(item);
      const title = cardTitle(item);
      if (!id || !title || cards.has(id)) continue;
      cards.set(id, {
        id,
        title,
        cover: item.img ?? "",
        subtitle: (item.txt2 ?? "").trim(),
        section,
      });
    }
  });
  return [...cards.values()];
};

/**
 * 按区块筛选并分页
 * @param cards - 归一化歌单卡片
 * @param params - page / limit / topic
 * @returns 分页后的 list 与筛选后总数 total
 */
export const sliceCards = (
  cards: MgPlaylistCard[],
  params: MgPlaylistDiscoverParams = {},
): { list: MgPlaylistCard[]; total: number } => {
  const topic = (params.topic ?? "").trim().toLowerCase();
  const filtered = topic
    ? cards.filter((card) => card.section.toLowerCase().includes(topic))
    : cards;
  const limit = Math.max(0, params.limit ?? 0);
  const page = Math.max(1, params.page ?? 1);
  const list = limit > 0 ? filtered.slice((page - 1) * limit, page * limit) : filtered;
  return { list, total: filtered.length };
};

/**
 * 发现：歌单广场运营位真实歌单池
 * @param params - page / limit / topic
 * @returns list 为分页后卡片，total 为筛选后总数
 */
export const playlistDiscover = async (
  params: MgPlaylistDiscoverParams = {},
): Promise<{ list: MgPlaylistCard[]; total: number }> => {
  const body = await mgRequest<MgSquarePageResponse>(`${MG_SQUARE_URL}?templateVersion=1`);
  if (body.code !== "000000") throw new Error(`咪咕歌单广场请求失败: ${body.code}`);
  return sliceCards(parseSquareContents(body.data?.contents), params);
};

/**
 * 取歌单详情（标题/封面/创建者/曲目数）
 * @param params - 歌单 id
 */
export const playlist = async (
  params: MgPlaylistParams = {},
): Promise<MgPlaylistDetailResponse> => {
  const id = (params.id ?? "").trim();
  if (!id) throw new Error("migu playlist id required");
  return mgRequest<MgPlaylistDetailResponse>(
    `${MG_PLAYLIST_DETAIL_URL}?playlistId=${encodeURIComponent(id)}`,
  );
};

/**
 * 取歌单曲目分页
 * @param params - 歌单 id 与分页
 */
export const playlistSongs = async (
  params: MgPlaylistSongsParams = {},
): Promise<MgPlaylistSongsResponse> => {
  const id = (params.id ?? "").trim();
  if (!id) throw new Error("migu playlist id required");
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.max(1, Math.min(params.limit ?? 50, 50));
  return mgRequest<MgPlaylistSongsResponse>(
    `${MG_PLAYLIST_SONGS_URL}?playlistId=${encodeURIComponent(id)}&pageNo=${page}&pageSize=${limit}`,
  );
};
