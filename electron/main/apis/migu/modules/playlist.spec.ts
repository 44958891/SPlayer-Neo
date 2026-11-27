import type { MgPlaylistCard, MgSquareGroup } from "@shared/utils/migu/config";
import { describe, expect, it } from "vitest";
import { parseSquareContents, sliceCards } from "./playlist";

/** 用官方广场实测返回的区块形态（2026-11 真实响应）验证解析 */
const squareItem = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  resId: id,
  txt: title,
  img: `https://img.example/${id}.png`,
  txt2: "10万",
  ...extra,
});

const contents: MgSquareGroup[] = [
  {
    view: "playlist_square_scene_zone",
    contents: [
      { contents: [{ txt: "场景歌单" }] },
      {
        contents: [
          squareItem("233475831", "宝藏R&B：耳机给你一只"),
          squareItem("232454418", "午后轻电音"),
        ],
      },
    ],
  },
  { view: "ZJ-Title", contents: [{ txt: "编辑推荐" }] },
  {
    view: "ZJ-SongList-Scroll",
    contents: [squareItem("237497933", "华语速爆新歌"), squareItem("", "无 id 应跳过")],
  },
  { view: "ZJ-Title", contents: [{ txt: "孤标题无条目" }] },
  {
    view: "playlist_square_recommend_finalData",
    contents: [
      { contents: [{ txt: "你可能喜欢的歌单" }] },
      { contents: [squareItem("233475831", "重复 id 应去重")] },
    ],
  },
];

describe("咪咕歌单广场解析", () => {
  it("解析两种区块形态，去重并跳过无效条目", () => {
    const cards = parseSquareContents(contents);
    expect(cards.map((card) => card.id)).toEqual(["233475831", "232454418", "237497933"]);
    expect(cards[0]).toMatchObject({
      id: "233475831",
      title: "宝藏R&B：耳机给你一只",
      cover: "https://img.example/233475831.png",
      subtitle: "10万",
    } satisfies Partial<MgPlaylistCard>);
    expect(cards[0].section).toBe("场景歌单");
    expect(cards[2].section).toBe("编辑推荐");
  });

  it("空 contents 返回空列表", () => {
    expect(parseSquareContents()).toEqual([]);
  });
});

describe("咪咕歌单发现筛选分页", () => {
  const cards = parseSquareContents(contents);

  it("topic 按区块名子串筛选并返回筛选后总数", () => {
    const { list, total } = sliceCards(cards, { topic: "场景" });
    expect(total).toBe(2);
    expect(list.map((card) => card.id)).toEqual(["233475831", "232454418"]);

    const editor = sliceCards(cards, { topic: "编辑" });
    expect(editor.total).toBe(1);
    expect(editor.list[0]?.id).toBe("237497933");
  });

  it("page/limit 切片", () => {
    expect(sliceCards(cards, { page: 1, limit: 2 }).list.map((card) => card.id)).toEqual([
      "233475831",
      "232454418",
    ]);
    expect(sliceCards(cards, { page: 2, limit: 2 }).list.map((card) => card.id)).toEqual([
      "237497933",
    ]);
    expect(sliceCards(cards, { page: 3, limit: 2 }).list).toEqual([]);
  });

  it("无 limit 时返回全部", () => {
    expect(sliceCards(cards, {}).list).toHaveLength(3);
  });
});
