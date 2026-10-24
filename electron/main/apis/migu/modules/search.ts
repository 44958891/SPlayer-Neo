/**
 * 咪咕搜索模块
 *
 * 只有 `search_all.do` 一个接口可用，用 searchSwitch 控制返回哪几类结果；
 * 歌单接口已下线（返回空），因此不提供歌单搜索。
 */

import { MG_SEARCH_URL, buildSearchSwitch, type MgSearchResponse } from "../core/config";
import { mgSearch } from "../core/request";

/** 搜索参数 */
export interface MgSearchParams {
  /** 关键词 */
  keywords?: string;
  /** 页码，从 1 开始 */
  page?: number;
  /** 每页条数 */
  limit?: number;
  /** 结果类型 */
  type?: "song" | "album" | "singer";
}

/**
 * 搜索歌曲/专辑/歌手
 * @param params - 搜索参数
 */
export const search = async (params: MgSearchParams = {}): Promise<MgSearchResponse> => {
  const keyword = (params.keywords ?? "").trim();
  if (!keyword) return { code: "000000" };
  const type = params.type ?? "song";
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.max(1, Math.min(params.limit ?? 30, 100));
  const searchSwitch = buildSearchSwitch({
    song: type === "song",
    album: type === "album",
    singer: type === "singer",
  });
  const url =
    `${MG_SEARCH_URL}?text=${encodeURIComponent(keyword)}` +
    `&pageNo=${page}&pageSize=${limit}&searchSwitch=${encodeURIComponent(searchSwitch)}`;
  return mgSearch(url);
};
