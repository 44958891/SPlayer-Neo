import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import type { CoverItem } from "@/types/artist";
import type { Platform } from "@shared/types/platform";
import type { DiscoveryPlaylist, DiscoveryResult } from "@/apis/recommend/discovery";

const mocks = vi.hoisted(() => ({
  discovery: vi.fn(),
  radar: vi.fn(),
  artists: vi.fn(),
}));

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/user", async () => {
  const { reactive } = await import("vue");
  const state = reactive({ profile: null as { userId: number } | null });
  return { useUserStore: () => state };
});
vi.mock("@/apis/recommend/netease", () => ({
  fetchRadarPlaylists: mocks.radar,
  fetchArtists: mocks.artists,
}));
vi.mock("@/apis/recommend/discovery", () => ({
  fetchDiscoveryPlaylists: mocks.discovery,
}));

/** 构建发现歌单卡片 */
const playlist = (id: string, source: Platform = "netease"): DiscoveryPlaylist => ({
  id,
  title: `歌单${id}`,
  trackCount: 10,
  source,
});

/** 构建发现结果 */
const result = (items: DiscoveryPlaylist[], failed: Platform[] = []): DiscoveryResult => ({
  items,
  failedPlatforms: failed,
  reusedCount: 0,
  freshCount: items.length,
});

/** 构建雷达 / 歌手区块卡片 */
const card = (id: string): CoverItem => ({ id, title: id, trackCount: 1 });

/** 雷达 / 歌手区块默认成功响应 */
const okOthers = (): void => {
  mocks.radar.mockResolvedValue([card("radar-ok")]);
  mocks.artists.mockResolvedValue([card("artist-1")]);
};

/** 手动 resolve / reject 的延迟任务 */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/** composable 实例类型（发现区 refs 为模块级共享） */
type Home = Awaited<ReturnType<typeof createHome>>;

let mod: typeof import("./useHomeDiscover");

/** 本用例创建的全部 effectScope，afterEach 统一 stop，杜绝旧 watch 跨用例残留 */
const scopes: ReturnType<typeof effectScope>[] = [];

/** 载入全新的 composable 模块，隔离模块级缓存状态 */
const loadModule = async (): Promise<void> => {
  vi.resetModules();
  mod = await import("./useHomeDiscover");
};

/** 在独立 effectScope 内创建实例，同一模块可创建多次共享模块缓存 */
const createHome = (scope = effectScope(true)): ReturnType<typeof mod.useHomeDiscover> => {
  scopes.push(scope);
  let home!: ReturnType<typeof mod.useHomeDiscover>;
  scope.run(() => {
    home = mod.useHomeDiscover();
  });
  return home;
};

/** 每个用例独立：重置模块后创建首个实例 */
const fresh = async (): Promise<Home> => {
  await loadModule();
  return createHome();
};

/** 当前用例的用户 store（工厂内 reactive 状态，随模块重置重建） */
const userStore = async (): Promise<{ profile: { userId: number } | null }> => {
  const m = await import("@/stores/user");
  return m.useUserStore() as { profile: { userId: number } | null };
};

/** 排空微任务队列，等待 watch 与在途请求收敛 */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
};

const TTL = 30 * 60 * 1000;
const COOLDOWN = 60 * 1000;

beforeEach(async () => {
  const user = await userStore();
  user.profile = null;
  await nextTick();
  // reset 同时清掉 Once 实现队列，避免跨用例残留
  vi.resetAllMocks();
  okOthers();
  // 时间设近纪元：验证 discoverAt / discoverFailedAt 的 0 值不误判为有效缓存或冷却中
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});

afterEach(() => {
  for (const scope of scopes) scope.stop();
  scopes.length = 0;
  vi.useRealTimers();
});

describe("useHomeDiscover 发现区状态层", () => {
  it("缓存命中：30 分钟内重复 ensure 不再请求，同模块新实例复用缓存", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("p1"), playlist("p2")]));
    const first = await fresh();
    await expect(first.ensurePlaylists()).resolves.toBe(true);
    expect(first.recommendPlaylists.value.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(mocks.discovery).toHaveBeenCalledTimes(1);

    const second = createHome();
    await expect(second.ensurePlaylists()).resolves.toBe(true);
    expect(mocks.discovery).toHaveBeenCalledTimes(1);
    expect(second.recommendPlaylists.value).toHaveLength(2);
    expect(second.recommendTitle.value).toBe("home.discovery.title");
    expect(second.recommendSubtitle.value).toBe("home.discovery.subtitle");
  });

  it("force 在缓存有效期内也强制请求，缓存过期后 ensure 重拉", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("p1")]));
    const home = await fresh();
    await home.ensurePlaylists();
    await expect(home.refreshPlaylists()).resolves.toBe(true);
    expect(mocks.discovery).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(TTL + 1);
    await expect(home.ensurePlaylists()).resolves.toBe(true);
    expect(mocks.discovery).toHaveBeenCalledTimes(3);
  });

  it("单飞：并发 ensure / refresh 合流同一请求，force 也防重复", async () => {
    const gate = deferred<DiscoveryResult>();
    mocks.discovery.mockReturnValue(gate.promise);
    const home = await fresh();
    const first = home.ensurePlaylists();
    const second = home.ensurePlaylists();
    const third = home.refreshPlaylists();
    expect(home.playlistsLoading.value).toBe(true);
    expect(mocks.discovery).toHaveBeenCalledTimes(1);

    gate.resolve(result([playlist("p1")]));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await third).toBe(true);
    expect(home.playlistsLoading.value).toBe(false);
    expect(home.playlistsError.value).toBeNull();

    await flush();
    await expect(home.ensurePlaylists()).resolves.toBe(true);
    expect(mocks.discovery).toHaveBeenCalledTimes(1);
  });

  it("首次全失败（freshCount 0 全平台失败）：false 置 loadFailed，冷却期内不请求", async () => {
    mocks.discovery.mockResolvedValue(result([], ["netease", "qqmusic", "kugou", "kuwo", "migu"]));
    const home = await fresh();
    await expect(home.ensurePlaylists()).resolves.toBe(false);
    expect(home.playlistsError.value).toBe("home.discovery.loadFailed");
    expect(home.recommendPlaylists.value).toEqual([]);
    expect(mocks.discovery).toHaveBeenCalledTimes(1);

    await expect(home.ensurePlaylists()).resolves.toBe(false);
    expect(mocks.discovery).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(COOLDOWN + 1);
    await expect(home.ensurePlaylists()).resolves.toBe(false);
    expect(mocks.discovery).toHaveBeenCalledTimes(2);
  });

  it("刷新全失败保旧列表（服务按契约返回旧 items + freshCount 0）：false 置 refreshFailed，失败不写新鲜 TTL", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("old")]));
    const home = await fresh();
    await home.ensurePlaylists();
    await vi.advanceTimersByTimeAsync(TTL + 1);

    mocks.discovery.mockResolvedValue({
      items: [playlist("old")],
      failedPlatforms: ["kuwo"],
      reusedCount: 1,
      freshCount: 0,
    });
    await expect(home.refreshPlaylists()).resolves.toBe(false);
    expect(home.recommendPlaylists.value.map((p) => p.id)).toEqual(["old"]);
    expect(home.playlistsError.value).toBe("home.discovery.refreshFailed");
    expect(home.unavailablePlatforms.value).toEqual([]);

    await vi.advanceTimersByTimeAsync(COOLDOWN + 1);
    mocks.discovery.mockResolvedValue(result([playlist("new")]));
    await expect(home.ensurePlaylists()).resolves.toBe(true);
    expect(mocks.discovery).toHaveBeenCalledTimes(3);
    expect(home.playlistsError.value).toBeNull();
    expect(home.recommendPlaylists.value.map((p) => p.id)).toEqual(["new"]);
  });

  it("全重复无失败（freshCount 0 无失败平台）：false 置 unchanged，空且无旧置 empty", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("old")]));
    const home = await fresh();
    await home.ensurePlaylists();
    await vi.advanceTimersByTimeAsync(TTL + 1);

    mocks.discovery.mockResolvedValue({
      items: [playlist("old")],
      failedPlatforms: [],
      reusedCount: 1,
      freshCount: 0,
    });
    await expect(home.refreshPlaylists()).resolves.toBe(false);
    expect(home.playlistsError.value).toBe("home.discovery.unchanged");
    expect(home.unavailablePlatforms.value).toEqual([]);
    expect(home.recommendPlaylists.value.map((p) => p.id)).toEqual(["old"]);

    await vi.advanceTimersByTimeAsync(COOLDOWN + 1);
    mocks.discovery.mockResolvedValue(result([playlist("new")]));
    await expect(home.ensurePlaylists()).resolves.toBe(true);
    expect(home.playlistsError.value).toBeNull();

    const other = await fresh();
    mocks.discovery.mockResolvedValue({
      items: [],
      failedPlatforms: [],
      reusedCount: 0,
      freshCount: 0,
    });
    await expect(other.ensurePlaylists()).resolves.toBe(false);
    expect(other.playlistsError.value).toBe("home.discovery.empty");
    expect(mocks.discovery).toHaveBeenCalledTimes(4);
  });

  it("请求抛错与全失败同等处理，不传播异常", async () => {
    mocks.discovery.mockRejectedValue(new Error("network down"));
    const home = await fresh();
    await expect(home.ensurePlaylists()).resolves.toBe(false);
    expect(home.playlistsError.value).toBe("home.discovery.loadFailed");
    expect(home.playlistsLoading.value).toBe(false);
  });

  it("部分成功（freshCount > 0）：unavailablePlatforms 保留失败平台不置错误，结果照常缓存", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("p1"), playlist("p2")], ["kuwo", "migu"]));
    const home = await fresh();
    await expect(home.ensurePlaylists()).resolves.toBe(true);
    expect(home.unavailablePlatforms.value).toEqual(["kuwo", "migu"]);
    expect(home.playlistsError.value).toBeNull();

    await expect(home.refreshPlaylists()).resolves.toBe(true);
    expect(mocks.discovery).toHaveBeenCalledTimes(2);

    const second = createHome();
    await expect(second.ensurePlaylists()).resolves.toBe(true);
    expect(second.unavailablePlatforms.value).toEqual(["kuwo", "migu"]);
    expect(mocks.discovery).toHaveBeenCalledTimes(2);
  });

  it("换号：立即清雷达，旧代次与旧 uid 的迟到响应均被丢弃，发现区跨账号复用", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("p1")]));
    const gateA = deferred<CoverItem[]>();
    const gateB = deferred<CoverItem[]>();
    mocks.radar.mockImplementationOnce(() => gateA.promise);
    mocks.radar.mockImplementationOnce(() => gateB.promise);
    mocks.radar.mockResolvedValueOnce([card("radar-A2")]);

    const home = await fresh();
    const user = await userStore();
    user.profile = { userId: 1 };
    const firstLoad = home.load();
    expect(mocks.radar).toHaveBeenCalledTimes(1);

    user.profile = { userId: 2 };
    await nextTick();
    // 换号立即清雷达，避免等待期残留上一账号卡片
    expect(home.radarPlaylists.value).toEqual([]);
    await flush();
    expect(mocks.radar).toHaveBeenCalledTimes(2);

    user.profile = { userId: 1 };
    await nextTick();
    await flush();
    expect(home.radarPlaylists.value.map((c) => c.id)).toEqual(["radar-A2"]);

    // 迟到响应：A 代次按 generation 丢弃，B 代次按 uid 不匹配丢弃
    gateA.resolve([card("radar-A-stale")]);
    gateB.resolve([card("radar-B-stale")]);
    await firstLoad;
    await flush();
    expect(home.radarPlaylists.value.map((c) => c.id)).toEqual(["radar-A2"]);
    expect(mocks.radar).toHaveBeenCalledTimes(3);
    // 发现区公开内容全程只拉一次
    expect(mocks.discovery).toHaveBeenCalledTimes(1);
  });

  it("未登录不拉雷达，登录后随 uid 变化由 watch 重拉", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("p1")]));
    const home = await fresh();
    const user = await userStore();
    await home.load();
    expect(mocks.radar).not.toHaveBeenCalled();

    user.profile = { userId: 7 };
    await nextTick();
    await flush();
    expect(mocks.radar).toHaveBeenCalledTimes(1);
    expect(home.radarPlaylists.value.map((c) => c.id)).toEqual(["radar-ok"]);
  });

  it("卸载保护：scope 销毁后迟到的账号区块响应不回写实例状态", async () => {
    await loadModule();
    mocks.discovery.mockResolvedValue(result([playlist("p1")]));
    const gate = deferred<CoverItem[]>();
    mocks.radar.mockReturnValue(gate.promise);
    const user = await userStore();
    user.profile = { userId: 1 };
    const scope = effectScope();
    const home = createHome(scope);
    const loading = home.load();
    scope.stop();

    gate.resolve([card("late")]);
    await loading;
    await flush();
    expect(home.radarPlaylists.value).toEqual([]);
    expect(home.artists.value).toEqual([]);
    // 发现区为模块级共享缓存，照常写入供下次挂载复用
    expect(home.recommendPlaylists.value.map((p) => p.id)).toEqual(["p1"]);
    expect(mocks.discovery).toHaveBeenCalledTimes(1);
  });

  it("loadOthers 合流：同 uid 同代次的并发 load 不重复拉取雷达", async () => {
    mocks.discovery.mockResolvedValue(result([playlist("p1")]));
    await loadModule();
    const user = await userStore();
    user.profile = { userId: 3 };
    const home = createHome();
    const gate = deferred<CoverItem[]>();
    mocks.radar.mockReturnValue(gate.promise);
    const first = home.load();
    const second = home.load();
    gate.resolve([card("radar-3")]);
    await Promise.all([first, second]);
    expect(mocks.radar).toHaveBeenCalledTimes(1);
    expect(home.radarPlaylists.value.map((c) => c.id)).toEqual(["radar-3"]);
  });
});
