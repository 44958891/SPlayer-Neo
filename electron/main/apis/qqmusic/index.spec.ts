// @vitest-environment node
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { callQQMusic, clearQQMusicCache } from "./index";
import type { QMParams } from "./core/types";

const state = vi.hoisted(() => ({
  modules: {} as Record<string, (params: QMParams) => Promise<unknown>>,
  cookies: {} as Record<string, string>,
}));

vi.mock("./modules", () => ({ modules: state.modules }));

vi.mock("./core/request", () => ({
  getQQMusicCookies: () => state.cookies,
  getQQMusicUin: () => {
    const raw =
      state.cookies.qm_str_musicid ||
      state.cookies.uin ||
      state.cookies.wxuin ||
      state.cookies.p_uin ||
      "";
    return raw ? raw.replace(/^o/, "") : "0";
  },
  clearQQMusicCookies: vi.fn(),
  mergeQQMusicCookies: vi.fn(),
}));

const BASE = 1_700_000_000_000;
let now = BASE;

/** 注册模块 mock 实现 */
const setModule = (name: string, impl: (params: QMParams) => Promise<unknown>): void => {
  state.modules[name] = impl;
};

const setSearch = (impl: (params: QMParams) => Promise<unknown>): void => setModule("search", impl);

const moduleFn = (name: string): Mock => state.modules[name] as Mock;

/** 构造合法搜索成功值 */
const searchOk = (mark: string): Record<string, unknown> => ({
  code: 200,
  total: 1,
  songs: [{ id: mark }],
});

/** 以当前 cookie 生成结果标记，便于断言命中来源 */
const markByAccount = (): string =>
  `${state.cookies.uin ?? "anon"}-${state.cookies.tmeLoginType ?? "?"}`;

describe("QM 主进程缓存", () => {
  beforeEach(() => {
    for (const key of Object.keys(state.modules)) delete state.modules[key];
    state.cookies = {};
    clearQQMusicCache();
    now = BASE;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  it("新鲜期内命中缓存不重复请求", async () => {
    setSearch(vi.fn(async () => searchOk("v1")));
    const first = await callQQMusic("search", { keywords: "hello" });
    now += 60_000;
    const second = await callQQMusic("search", { keywords: "hello" });
    expect(moduleFn("search")).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("过期后请求失败回退陈旧结果并携带 searchRecovery", async () => {
    setSearch(vi.fn(async () => searchOk("v1")));
    const first = await callQQMusic("search", { keywords: "hello" });
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValueOnce(new Error("down"));
    const recovered = await callQQMusic("search", { keywords: "hello" });
    expect(recovered).toEqual({
      code: 200,
      total: 1,
      songs: [{ id: "v1" }],
      searchRecovery: { kind: "cache", cachedAt: BASE },
    });
    expect(moduleFn("search")).toHaveBeenCalledTimes(2);
    expect(first).not.toHaveProperty("searchRecovery");
    now += 60_000;
    moduleFn("search").mockRejectedValueOnce(new Error("down"));
    const again = await callQQMusic("search", { keywords: "hello" });
    expect(again.searchRecovery).toEqual({ kind: "cache", cachedAt: BASE });
  });

  it("超过陈旧保留期后失败不再回退", async () => {
    setSearch(vi.fn(async () => searchOk("v1")));
    await callQQMusic("search", { keywords: "hello" });
    now += 31 * 60_000;
    moduleFn("search").mockRejectedValue(new Error("down"));
    await expect(callQQMusic("search", { keywords: "hello" })).rejects.toThrow("down");
  });

  it("请求失败不写入任何缓存", async () => {
    setSearch(vi.fn(async () => searchOk("v1")));
    moduleFn("search").mockRejectedValueOnce(new Error("boom"));
    await expect(callQQMusic("search", { keywords: "hello" })).rejects.toThrow("boom");
    const value = await callQQMusic("search", { keywords: "hello" });
    expect(value).toEqual(searchOk("v1"));
    expect(moduleFn("search")).toHaveBeenCalledTimes(2);
    expect(value).not.toHaveProperty("searchRecovery");
  });

  it("账号切换后新鲜缓存互不可见", async () => {
    setSearch(vi.fn(async () => searchOk(markByAccount())));
    state.cookies = { uin: "111", qm_keyst: "K", tmeLoginType: "2" };
    const a = await callQQMusic("search", { keywords: "x" });
    expect(a.songs[0].id).toBe("111-2");
    state.cookies = { uin: "222", qm_keyst: "K", tmeLoginType: "2" };
    const b = await callQQMusic("search", { keywords: "x" });
    expect(b.songs[0].id).toBe("222-2");
    expect(moduleFn("search")).toHaveBeenCalledTimes(2);
    state.cookies = { uin: "222", qm_keyst: "K", tmeLoginType: "1" };
    const c = await callQQMusic("search", { keywords: "x" });
    expect(c.songs[0].id).toBe("222-1");
    expect(moduleFn("search")).toHaveBeenCalledTimes(3);
  });

  it("陈旧结果不跨账号回退", async () => {
    setSearch(vi.fn(async () => searchOk(markByAccount())));
    state.cookies = { uin: "111", qm_keyst: "K", tmeLoginType: "2" };
    await callQQMusic("search", { keywords: "x" });
    state.cookies = { uin: "222", qm_keyst: "K", tmeLoginType: "2" };
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValueOnce(new Error("down"));
    await expect(callQQMusic("search", { keywords: "x" })).rejects.toThrow("down");
    const own = await callQQMusic("search", { keywords: "x" });
    expect(own.songs[0].id).toBe("222-2");
    expect(own).not.toHaveProperty("searchRecovery");
    expect(moduleFn("search")).toHaveBeenCalledTimes(3);
  });

  it("musickey 轮换不影响同账号缓存命中", async () => {
    setSearch(vi.fn(async () => searchOk(state.cookies.qm_keyst ?? "")));
    state.cookies = { uin: "111", qm_keyst: "K1", tmeLoginType: "2" };
    await callQQMusic("search", { keywords: "x" });
    state.cookies = { uin: "111", qm_keyst: "K2", tmeLoginType: "2" };
    const fresh = await callQQMusic("search", { keywords: "x" });
    expect(fresh.songs[0].id).toBe("K1");
    expect(moduleFn("search")).toHaveBeenCalledTimes(1);
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValue(new Error("down"));
    const stale = await callQQMusic("search", { keywords: "x" });
    expect(stale.songs[0].id).toBe("K1");
    expect(stale.searchRecovery).toEqual({ kind: "cache", cachedAt: BASE });
  });

  it("分页与分类参数构成独立缓存键且默认参数归一", async () => {
    setSearch(
      vi.fn(async (params: QMParams) => {
        const {
          keywords,
          page = 1,
          type = 0,
        } = params as {
          keywords?: string;
          page?: number;
          type?: number;
        };
        return searchOk(`${keywords}-${page}-${type}`);
      }),
    );
    await callQQMusic("search", { keywords: "x", page: 1 });
    await callQQMusic("search", { keywords: "x", page: 2 });
    await callQQMusic("search", { keywords: "x", type: 8 });
    expect(moduleFn("search")).toHaveBeenCalledTimes(3);
    const defaulted = await callQQMusic("search", { keywords: "x", page: 1, limit: 30, type: 0 });
    expect(defaulted.songs[0].id).toBe("x-1-0");
    expect(moduleFn("search")).toHaveBeenCalledTimes(3);
  });

  it("空结果属于成功值并可参与陈旧恢复", async () => {
    setSearch(vi.fn(async () => ({ code: 200, total: 0, songs: [] })));
    const empty = await callQQMusic("search", { keywords: "x" });
    expect(empty.songs).toEqual([]);
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValue(new Error("down"));
    const recovered = await callQQMusic("search", { keywords: "x" });
    expect(recovered.songs).toEqual([]);
    expect(recovered.searchRecovery).toEqual({ kind: "cache", cachedAt: BASE });
  });

  it("假错误与畸形结果不缓存也不回退", async () => {
    setSearch(vi.fn(async () => ({ code: 400, total: 0, message: "keywords required" })));
    const bad = await callQQMusic("search", { keywords: "" });
    expect(bad.code).toBe(400);
    await callQQMusic("search", { keywords: "" });
    expect(moduleFn("search")).toHaveBeenCalledTimes(2);
    moduleFn("search").mockResolvedValueOnce({ code: 200, total: 5 });
    const malformed = await callQQMusic("search", { keywords: "x" });
    expect(malformed.code).toBe(200);
    expect(malformed.songs).toBeUndefined();
    await callQQMusic("search", { keywords: "x" });
    expect(moduleFn("search")).toHaveBeenCalledTimes(4);
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValue(new Error("down"));
    await expect(callQQMusic("search", { keywords: "x" })).rejects.toThrow("down");
  });

  it("同键并发调用合并为单次请求", async () => {
    let release!: (value: unknown) => void;
    setSearch(
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const p1 = callQQMusic("search", { keywords: "x", page: 2 });
    const p2 = callQQMusic("search", { keywords: "x", page: 2 });
    expect(moduleFn("search")).toHaveBeenCalledTimes(1);
    release(searchOk("once"));
    expect(await p1).toEqual(searchOk("once"));
    expect(await p2).toEqual(searchOk("once"));
  });

  it("免缓存接口不走去重与缓存", async () => {
    setModule(
      "song_url",
      vi.fn(async (params: QMParams) => ({ url: params.id })),
    );
    const [a, b] = await Promise.all([
      callQQMusic("song_url", { id: "s1" }),
      callQQMusic("song_url", { id: "s1" }),
    ]);
    expect(a).toEqual(b);
    expect(moduleFn("song_url")).toHaveBeenCalledTimes(2);
    await callQQMusic("song_url", { id: "s1" });
    expect(moduleFn("song_url")).toHaveBeenCalledTimes(3);
  });

  it("新鲜缓存按上限 LRU 淘汰", async () => {
    setModule(
      "hot_search",
      vi.fn(async (params: QMParams) => ({ i: params.i })),
    );
    for (let i = 0; i <= 200; i++) await callQQMusic("hot_search", { i });
    expect(moduleFn("hot_search")).toHaveBeenCalledTimes(201);
    await callQQMusic("hot_search", { i: 0 });
    expect(moduleFn("hot_search")).toHaveBeenCalledTimes(202);
    await callQQMusic("hot_search", { i: 200 });
    expect(moduleFn("hot_search")).toHaveBeenCalledTimes(202);
  });

  it("陈旧缓存按上限淘汰", async () => {
    setSearch(vi.fn(async (params: QMParams) => searchOk(String(params.keywords))));
    for (let i = 0; i <= 200; i++) await callQQMusic("search", { keywords: `k${i}` });
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValue(new Error("down"));
    await expect(callQQMusic("search", { keywords: "k0" })).rejects.toThrow("down");
    const recovered = await callQQMusic("search", { keywords: "k200" });
    expect(recovered.songs[0].id).toBe("k200");
    expect(recovered.searchRecovery).toEqual({ kind: "cache", cachedAt: BASE });
  });

  it("清空缓存同时清除新鲜与陈旧层", async () => {
    setSearch(vi.fn(async () => searchOk("v1")));
    await callQQMusic("search", { keywords: "x" });
    clearQQMusicCache();
    await callQQMusic("search", { keywords: "x" });
    expect(moduleFn("search")).toHaveBeenCalledTimes(2);
    clearQQMusicCache();
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValue(new Error("down"));
    await expect(callQQMusic("search", { keywords: "x" })).rejects.toThrow("down");
  });

  it("清空后旧在途响应不得回填缓存", async () => {
    let release!: (value: unknown) => void;
    setSearch(
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const pending = callQQMusic("search", { keywords: "x" });
    clearQQMusicCache();
    release(searchOk("late"));
    expect(await pending).toEqual(searchOk("late"));
    setSearch(vi.fn(async () => searchOk("second")));
    const next = await callQQMusic("search", { keywords: "x" });
    expect(next).toEqual(searchOk("second"));
    expect(moduleFn("search")).toHaveBeenCalledTimes(1);
  });

  it("清空不影响清空后新建的在途调用", async () => {
    const releases: Array<(value: unknown) => void> = [];
    setSearch(
      vi.fn(
        () =>
          new Promise((resolve) => {
            releases.push(resolve);
          }),
      ),
    );
    const p1 = callQQMusic("search", { keywords: "x" });
    clearQQMusicCache();
    const p2 = callQQMusic("search", { keywords: "x" });
    const p3 = callQQMusic("search", { keywords: "x" });
    expect(moduleFn("search")).toHaveBeenCalledTimes(2);
    releases[1]?.(searchOk("b"));
    expect(await p2).toEqual(searchOk("b"));
    expect(await p3).toEqual(searchOk("b"));
    releases[0]?.(searchOk("a"));
    expect(await p1).toEqual(searchOk("a"));
    const p4 = callQQMusic("search", { keywords: "y" });
    releases[2]?.(searchOk("c"));
    expect(await p4).toEqual(searchOk("c"));
    expect(moduleFn("search")).toHaveBeenCalledTimes(3);
  });

  it("非搜索接口保持原缓存行为", async () => {
    setModule(
      "hot_search",
      vi.fn(async () => ({ code: 500, message: "server busy" })),
    );
    const value = await callQQMusic("hot_search");
    expect(value.code).toBe(500);
    await callQQMusic("hot_search");
    expect(moduleFn("hot_search")).toHaveBeenCalledTimes(1);
    now += 3 * 60_000;
    await callQQMusic("hot_search");
    expect(moduleFn("hot_search")).toHaveBeenCalledTimes(2);
  });

  it("timestamp 参数绕过 search 新鲜缓存", async () => {
    setSearch(vi.fn(async (params: QMParams) => searchOk(String(params.timestamp ?? "plain"))));
    await callQQMusic("search", { keywords: "x" });
    await callQQMusic("search", { keywords: "x", timestamp: 111 });
    await callQQMusic("search", { keywords: "x", timestamp: 222 });
    expect(moduleFn("search")).toHaveBeenCalledTimes(3);
    now += 3 * 60_000;
    moduleFn("search").mockRejectedValue(new Error("down"));
    const recovered = await callQQMusic("search", { keywords: "x" });
    expect(recovered.songs[0].id).toBe("222");
    expect(recovered.searchRecovery).toEqual({ kind: "cache", cachedAt: BASE });
  });
});
