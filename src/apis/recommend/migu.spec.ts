import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMiguDiscoverPlaylists } from "./migu";

const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock("@/apis/migu", () => ({ migu: { playlist_discover: mocks.discover } }));

beforeEach(() => vi.resetAllMocks());

describe("咪咕发现归一化响应", () => {
  it("消费主进程 list/total 响应，无业务 code 字段也正常渲染真实来源", async () => {
    mocks.discover.mockResolvedValue({
      list: [
        { id: "real-id", title: "编辑精选", cover: "cover", section: "编辑推荐", subtitle: "" },
      ],
      total: 1,
    });
    const items = await fetchMiguDiscoverPlaylists({ topic: "华语", limit: 30, page: 1 });
    expect(items).toEqual([
      expect.objectContaining({ id: "real-id", title: "编辑精选", source: "migu" }),
    ]);
    expect(mocks.discover).toHaveBeenCalledWith({});
  });

  it("未知响应格式明确失败，空的合法列表保持为空", async () => {
    mocks.discover.mockResolvedValueOnce({ code: "403" });
    await expect(fetchMiguDiscoverPlaylists()).rejects.toThrow("返回格式无效");
    mocks.discover.mockResolvedValueOnce({ list: [], total: 0 });
    await expect(fetchMiguDiscoverPlaylists()).resolves.toEqual([]);
  });
});
