import type { CoverItem } from "@/types/artist";
import type { Platform } from "@shared/types/platform";
import { useUserStore } from "@/stores/user";
import { fetchRadarPlaylists, fetchArtists } from "@/apis/recommend/netease";
import { fetchDiscoveryPlaylists, type DiscoveryPlaylist } from "@/apis/recommend/discovery";

/** 各区块缓存有效期 */
const CACHE_TTL = 30 * 60 * 1000;
/** 发现区零新内容后的重试冷却，期内不再发请求 */
const RETRY_COOLDOWN = 60 * 1000;

/** 雷达 / 歌手的模块缓存 */
interface OthersCache {
  /** 缓存写入时间 */
  at: number;
  /** 缓存归属的用户 uid，未登录为 null，换号视为失效 */
  uid: number | null;
  radar: CoverItem[];
  artists: CoverItem[];
}

/** 其余区块模块缓存，仅保留当前一份，跨页面 / 重新挂载复用 */
let othersCache: OthersCache | null = null;
/** 其余区块在途请求，同 uid 同代次的重复调用合流，防 onMounted 与切号 watch 并发 */
let othersInflight: { uid: number | null; gen: number; promise: Promise<void> } | null = null;

/** 账号代次：uid 每次变化自增，A→B→A 回切后旧代次的迟到响应按代次失效 */
let uidGeneration = 0;

/** 发现区当前列表，模块级共享状态兼作唯一缓存，跨挂载 / 跨账号复用 */
const discoverItems = shallowRef<DiscoveryPlaylist[]>([]);
/** 发现区缓存写入时间，0 表示尚无有效缓存 */
let discoverAt = 0;
/** 发现区最近一次成功结果的不可用平台，缓存命中时一并恢复 */
let discoverUnavailable: Platform[] = [];
/** 发现区最近一次零新内容时间，冷却期内不再重试 */
let discoverFailedAt = 0;
/** 发现区进行中的请求，ensure / refresh 单飞合流，所有调用共享同一结果 */
let discoverInflight: Promise<boolean> | null = null;
/** 发现区失败提示（i18n key），产出新内容后清空，由 Home 映射显示 */
const playlistsError = ref<string | null>(null);
/** 发现区请求进行中 */
const playlistsLoading = ref(false);
/** 最近一次成功结果的不可用平台，完全失败时清空（由错误提示表达） */
const unavailablePlatforms = ref<Platform[]>([]);

/** 包裹拉取：失败记日志并回退空数组，单区块失败不影响整体 */
const safe = (label: string, task: Promise<CoverItem[]>): Promise<CoverItem[]> =>
  task.catch((error) => {
    console.warn(`[home] ${label} failed:`, error);
    return [];
  });

/**
 * 发现区统一执行器：ensure 与 refresh 共用的单飞入口
 *
 * freshCount > 0 视为成功（含部分平台失败）并刷新缓存；零新内容不伪成功：
 * 保留旧列表、不写新鲜 TTL、进入重试冷却，平台全失败时提示
 * loadFailed / refreshFailed，无失败但无新内容时提示 unchanged / empty
 *
 * @param force - true 跳过缓存命中与失败冷却强制拉取
 * @returns 是否产出新内容
 */
const runDiscovery = (force: boolean): Promise<boolean> => {
  if (discoverInflight) return discoverInflight;
  const cached =
    discoverAt > 0 && discoverItems.value.length > 0 && Date.now() - discoverAt < CACHE_TTL;
  const cooling = discoverFailedAt > 0 && Date.now() - discoverFailedAt < RETRY_COOLDOWN;
  if (!force && (cached || cooling)) {
    unavailablePlatforms.value = discoverUnavailable;
    return Promise.resolve(cached);
  }
  const previous = discoverItems.value;
  const hadItems = previous.length > 0;
  playlistsLoading.value = true;
  const request = (async (): Promise<boolean> => {
    try {
      const result = await fetchDiscoveryPlaylists(previous);
      if (result.freshCount === 0) {
        discoverFailedAt = Date.now();
        discoverUnavailable = [];
        unavailablePlatforms.value = [];
        playlistsError.value =
          result.failedPlatforms.length > 0
            ? hadItems
              ? "home.discovery.refreshFailed"
              : "home.discovery.loadFailed"
            : hadItems
              ? "home.discovery.unchanged"
              : "home.discovery.empty";
        if (result.failedPlatforms.length > 0) {
          console.warn("[home] discovery failed on platforms:", result.failedPlatforms);
        }
        return false;
      }
      discoverItems.value = result.items;
      discoverAt = Date.now();
      discoverFailedAt = 0;
      discoverUnavailable = result.failedPlatforms;
      unavailablePlatforms.value = result.failedPlatforms;
      playlistsError.value = null;
      return true;
    } catch (error) {
      discoverFailedAt = Date.now();
      discoverUnavailable = [];
      unavailablePlatforms.value = [];
      playlistsError.value = hadItems
        ? "home.discovery.refreshFailed"
        : "home.discovery.loadFailed";
      console.warn(
        "[home] discovery request failed:",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  })();
  const task: Promise<boolean> = request.finally(() => {
    playlistsLoading.value = false;
    if (discoverInflight === task) discoverInflight = null;
  });
  discoverInflight = task;
  return task;
};

/**
 * 首页推荐内容
 *
 * 「发现歌单」公开内容不依赖账号，跨账号复用；「雷达 / 歌手」按
 * 用户 uid 隔离，30 分钟内重新挂载直接复用，登录态变化只重拉账号区块
 */
export const useHomeDiscover = () => {
  const { t } = useI18n();
  const user = useUserStore();

  /** 雷达歌单 */
  const radarPlaylists = shallowRef<CoverItem[]>([]);
  /** 歌手推荐 */
  const artists = shallowRef<CoverItem[]>([]);

  /** 推荐歌单标题 */
  const recommendTitle = computed(() => t("home.discovery.title"));
  /** 推荐歌单副标题 */
  const recommendSubtitle = computed(() => t("home.discovery.subtitle"));

  // 卸载后停止 watch 并不再回写雷达等实例状态；发现区为模块级共享状态，照常更新缓存
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  /** 当前登录用户 uid，未登录为 null */
  const currentUid = (): number | null => user.profile?.userId ?? null;

  /** 用缓存填充雷达 / 歌手 */
  const applyOthers = (data: OthersCache): void => {
    radarPlaylists.value = data.radar;
    artists.value = data.artists;
  };

  /**
   * 拉取雷达 / 歌手：30 分钟内重挂复用，雷达仅在登录后拉取且按 uid 隔离；
   * 同 uid 同代次的在途请求合流，避免 onMounted 与切号 watch 并发重复拉取
   * @param uid - 发起时的用户 uid，响应返回时 uid 或代次已变化则整体丢弃不写缓存
   */
  const loadOthers = (uid: number | null): Promise<void> => {
    const gen = uidGeneration;
    if (othersInflight && othersInflight.uid === uid && othersInflight.gen === gen) {
      return othersInflight.promise;
    }
    const task = (async (): Promise<void> => {
      if (othersCache && othersCache.uid === uid && Date.now() - othersCache.at < CACHE_TTL) {
        applyOthers(othersCache);
        return;
      }
      const [radar, artistList] = await Promise.all([
        uid !== null
          ? safe("radar playlists", fetchRadarPlaylists())
          : Promise.resolve<CoverItem[]>([]),
        safe("artists", fetchArtists()),
      ]);
      // 账号已切换或组件已卸载的迟到响应不写缓存不应用，由当前代次的拉取覆盖
      if (currentUid() !== uid || gen !== uidGeneration || disposed) return;
      othersCache = { at: Date.now(), uid, radar, artists: artistList };
      applyOthers(othersCache);
    })();
    othersInflight = { uid, gen, promise: task };
    // task 不会 reject（safe 包裹），完成后仅清理仍归属本次的在途记录
    void task.then(() => {
      if (othersInflight?.promise === task) othersInflight = null;
    });
    return task;
  };

  /**
   * 确保发现区有内容：命中缓存或冷却期内直接复用，否则发起拉取
   * @returns 是否产出新内容（缓存命中为 true）
   */
  const ensurePlaylists = (): Promise<boolean> => runDiscovery(false);

  /**
   * 仅强制刷新发现区：产出新内容时替换列表，零新内容保留旧列表并置错误状态
   * @returns 是否产出新内容
   */
  const refreshPlaylists = (): Promise<boolean> => runDiscovery(true);

  /**
   * 拉取全部首页区块：发现区走 ensure 单飞，其余区块按缓存复用
   * @returns 无返回值，失败经 playlistsError / 各区块空列表表达
   */
  const load = async (): Promise<void> => {
    await Promise.all([ensurePlaylists(), loadOthers(currentUid())]);
  };

  // 账号变化：立即清雷达避免等待期残留上一账号卡片，代次自增使旧响应失效，随后重拉
  watch(currentUid, () => {
    uidGeneration += 1;
    radarPlaylists.value = [];
    void load();
  });

  return {
    recommendPlaylists: discoverItems,
    recommendTitle,
    recommendSubtitle,
    radarPlaylists,
    artists,
    load,
    ensurePlaylists,
    refreshPlaylists,
    playlistsLoading,
    playlistsError,
    unavailablePlatforms,
  };
};
