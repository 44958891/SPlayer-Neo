import type { CoverItem } from "@/types/artist";
import type { MgPlaylistCard } from "@shared/utils/migu/config";
import { migu as mgApi } from "@/apis/migu";

/** 发现参数 */
export interface MiguDiscoverOptions {
  /** 页码，从 1 开始 */
  page?: number;
  /** 每页条数 */
  limit?: number;
  /** 主题词（如"流行/华语/睡眠"），匹配歌单标题或区块；无匹配时回退全池，保证不返回空 */
  topic?: string;
}

/** 主进程歌单发现响应 */
interface MgDiscoverResponse {
  list: MgPlaylistCard[];
  total?: number;
}

/**
 * 咪咕歌单发现：官方网页歌单广场运营位的动态真实歌单池
 *
 * 数据来自 music.migu.cn/v5 歌单广场实际使用的官方运营位接口，返回真实歌单
 * （id 即 playlistId，可直接走咪咕歌单详情/播放链路）。topic 为通用主题词时
 * 先按标题/区块匹配，无匹配回退全池（洗牌由聚合层负责），不会因 topic 返回空。
 * @param options - page / limit / topic
 * @returns CoverItem 列表
 */
export const fetchMiguDiscoverPlaylists = async (
  options: MiguDiscoverOptions = {},
): Promise<CoverItem[]> => {
  // 全池取回（主进程 2 分钟缓存），主题词在渲染侧匹配，避免运营位区块名与通用主题不对齐时误筛成空
  const body = await mgApi["playlist_discover"]<MgDiscoverResponse>({});
  if (!Array.isArray(body.list)) throw new Error("咪咕歌单发现返回格式无效");

  let cards = body.list ?? [];
  const topic = (options.topic ?? "").trim();
  if (topic) {
    const hit = cards.filter((card) => card.title.includes(topic) || card.section.includes(topic));
    if (hit.length > 0) cards = hit;
  }

  const limit = Math.max(0, options.limit ?? 0);
  const page = Math.max(1, options.page ?? 1);
  const list = limit > 0 ? cards.slice((page - 1) * limit, page * limit) : cards;
  return list.map((card) => ({
    id: card.id,
    title: card.title,
    cover: card.cover,
    subtitle: card.section || card.subtitle,
    trackCount: 0,
    source: "migu" as const,
  }));
};
