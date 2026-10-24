import type { Track, TrackSource } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { PluginQuality } from "@shared/types/plugin";
import { buildHealthKey, isTimeoutMessage, type PluginHealthEntry } from "@shared/utils/audioProbe";
import { qualityMeets, qualityRank, type QualityLevel } from "@/utils/quality";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { useUserStore } from "@/stores/user";
import { resolveNeteaseUrl } from "@/apis/song/netease";
import { resolveQQMusicUrl } from "@/apis/song/qqmusic";
import { resolveKugouUrl } from "@/apis/song/kugou";
import { resolveKuwoUrl } from "@/apis/song/kuwo";
import { ErrorCode } from "@shared/types/errors";
import { handleError } from "@/utils/errors";

/** 在线平台 source → 插件 source key */
const PLATFORM_TO_PLUGIN_SOURCE: Record<Platform, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
  kuwo: "kw",
  migu: "mg",
};

/** 取链首次快速超时：多数正常取链在 1s 内返回，超过 8s 视为上游冷启动 */
const RESOLVE_TIMEOUT_FAST_MS = 8_000;
/** 超时软失败后的长超时重试：插件上游偶发 i/o timeout，给足 25s */
const RESOLVE_TIMEOUT_RETRY_MS = 25_000;

/** 体检表缓存有效期：同一次扫描里几十上百首歌只需拉一次全表 */
const HEALTH_CACHE_TTL_MS = 10_000;
let healthCache: { at: number; table: Record<string, PluginHealthEntry> } | null = null;

/**
 * 读体检表（带 10s 内存缓存）
 *
 * 取链编排每首歌都会查一次表，直接打 IPC 会把整张表反复序列化传输；
 * 缓存让同一轮扫描只拉一次，写入侧（本进程的 reportHealth）主动失效。
 * @returns 键 → 结论的映射（取不到时返回空对象，按"无记录"处理）
 */
const readHealthTable = async (): Promise<Record<string, PluginHealthEntry>> => {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_CACHE_TTL_MS) return healthCache.table;
  const table = await window.api.plugins.health().catch(() => ({}));
  healthCache = { at: now, table };
  return table;
};

/** 使体检表缓存失效（写入结论后调用） */
const invalidateHealthCache = (): void => {
  healthCache = null;
};

/** 解析选项 */
export interface ResolveTrackSourceOptions {
  /** 将解析失败原因交给播放流程，供提示和跳曲决策使用 */
  onError?: (error: string) => void;
  /** 要跳过的插件 ID 列表 */
  skipPluginIds?: readonly string[];
  /** 是否跳过官方在线接口，直接进入插件兜底 */
  skipOfficialOnline?: boolean;
  /** 是否静默解析 */
  silent?: boolean;
  /** 流媒体 PlaySessionId，用于预载时隔离当前播放会话 */
  streamingPlaySessionId?: string;
}

/**
 * 检查给定 source 是否为在线平台
 * @param source - 要检查的 source
 */
const isOnlinePlatform = (source: TrackSource): source is Platform =>
  source === "netease" ||
  source === "qqmusic" ||
  source === "kugou" ||
  source === "kuwo" ||
  source === "migu";

/**
 * 派生缓存键
 * netease / qqmusic 把音质档位并入键，使不同音质的同一首歌互不覆盖
 * @param track - 要解析的 track
 * @param songLevel - 在线歌曲音质档位
 * @returns 派生缓存键，如果该 track 不参与歌曲缓存则返回 null
 */
const cacheKeyForTrack = (track: Track, songLevel: QualityLevel): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  if (track.source === "kugou" && track.id) {
    return `o:kugou:${track.id}:${track.extId ?? ""}:${songLevel}`;
  }
  if (isOnlinePlatform(track.source) && track.id) {
    return `o:${track.source}:${track.id}:${songLevel}`;
  }
  return null;
};

/** 在线 URL 解析结果 */
export type OnlineResolveResult =
  | {
      ok: true;
      url: string;
      isTrial: boolean;
      provider: "official" | "plugin" | "trial";
      pluginId?: string;
      /** 解析确认（官方接口下发档位 / 插件实际请求档位）的音质等级 */
      level?: QualityLevel;
      /** 预探针实测的完整文件体积（字节）；未探测或未知时缺省 */
      sizeBytes?: number;
    }
  | { ok: false; errorCode: ErrorCode };

/**
 * 经插件解析在线音频源 URL
 * @param track - 要解析的 track
 * @param quality - 音质档位（由调用方传入，默认 hq）
 * @returns 解析结果，失败时带原因码
 */
export const resolveByPlugin = async (
  track: Track,
  quality: QualityLevel = "hq",
  skipPluginIds: readonly string[] = [],
): Promise<OnlineResolveResult> => {
  const fail = (errorCode: ErrorCode): OnlineResolveResult => ({ ok: false, errorCode });
  if (!isOnlinePlatform(track.source)) return fail(ErrorCode.URL_RESOLVE_FAILED);
  const pluginSource = PLATFORM_TO_PLUGIN_SOURCE[track.source];
  if (!pluginSource) return fail(ErrorCode.URL_RESOLVE_FAILED);
  const skip = new Set(skipPluginIds);
  const plugins = usePluginsStore();
  const candidates = plugins.list.filter(
    (info) =>
      !skip.has(info.manifest.id) &&
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[pluginSource]?.actions.includes("musicUrl"),
  );
  if (candidates.length === 0) return fail(ErrorCode.NO_PLUGIN_AVAILABLE);
  // 补齐 id / songmid / songId / hash / albumId 等字段
  const totalSec = track.duration > 0 ? Math.round(track.duration / 1000) : 0;
  const interval =
    totalSec > 0
      ? `${Math.floor(totalSec / 60)
          .toString()
          .padStart(2, "0")}:${(totalSec % 60).toString().padStart(2, "0")}`
      : null;
  const singer = track.artists.map((artist) => artist.name).join("/");
  const songId = track.id;
  const isHash =
    typeof songId === "string" && songId.length === 32 && /^[0-9a-fA-F]{32}$/.test(songId);
  const hash = isHash || track.source === "kugou" ? songId : undefined;
  // 咪咕插件取链需要 copyrightId（宿主存在 extId），与 songId 一起塞进 meta
  const miguCopyrightId = track.source === "migu" ? (track.extId ?? "").trim() : "";
  const musicInfo = {
    id: songId,
    songmid: songId,
    songId,
    name: track.title,
    singer,
    source: pluginSource,
    interval,
    img: track.cover ?? null,
    ...(hash ? { hash } : {}),
    ...(miguCopyrightId ? { copyrightId: miguCopyrightId } : {}),
    albumId: track.album?.id ?? "",
    albumName: track.album?.name ?? "",
    meta: {
      songId,
      albumName: track.album?.name ?? "",
      albumId: track.album?.id ?? "",
      picUrl: track.cover ?? null,
      ...(hash ? { hash } : {}),
      ...(miguCopyrightId ? { copyrightId: miguCopyrightId } : {}),
    },
  };
  for (const plugin of candidates) {
    try {
      const res = await window.api.plugins.resolveUrl({
        pluginId: plugin.manifest.id,
        source: pluginSource,
        quality,
        musicInfo,
      });
      if (res?.url) {
        return {
          ok: true,
          url: res.url,
          isTrial: false,
          provider: "plugin",
          pluginId: plugin.manifest.id,
          level: res.quality,
        };
      }
    } catch (err) {
      console.warn("[plugin] resolveUrl failed", plugin.manifest.id, err);
    }
  }
  return fail(ErrorCode.URL_RESOLVE_FAILED);
};

/**
 * 并行调用全部候选插件解析 URL，取实际档位最高的一版
 *
 * 多个音源插件各有资源覆盖面，串行只取首个成功者容易拿到低档；并发执行总耗时
 * 只取决于最慢的插件（不叠加），并在结果里按声明档位择优。
 *
 * 借鉴 GZ Music 的音源体检后新增三层防护：
 * 1. 取链超时 soft-fail：首次 8s 超时后带 25s 超时重试一次（插件上游冷启动较慢）
 * 2. URL 预探针：拿到直链后发 1 字节 Range 请求，按 Content-Type 与体积反推
 *    时长，超过时长地板才视为可用（拦截试听片段 / 防盗链页面 / 无效数据）
 * 3. 体检登记表：硬失败组合（无版权/无链接/非音频/试听）记入持久化表，
 *    短期内不再重复尝试；脚本 hash 变化后自动失效
 *
 * @param track - 要解析的 track
 * @param quality - 音质档位
 * @param skipPluginIds - 要跳过的插件 ID
 * @param probe - 是否启用 URL 预探针（下载/升级场景建议开启；播放场景可关）
 */
export const resolveByPluginBest = async (
  track: Track,
  quality: QualityLevel = "hq",
  skipPluginIds: readonly string[] = [],
  probe = false,
): Promise<OnlineResolveResult> => {
  const fail = (errorCode: ErrorCode): OnlineResolveResult => ({ ok: false, errorCode });
  if (!isOnlinePlatform(track.source)) return fail(ErrorCode.URL_RESOLVE_FAILED);
  const pluginSource = PLATFORM_TO_PLUGIN_SOURCE[track.source];
  if (!pluginSource) return fail(ErrorCode.URL_RESOLVE_FAILED);
  const skip = new Set(skipPluginIds);
  const plugins = usePluginsStore();
  const candidates = plugins.list.filter(
    (info) =>
      !skip.has(info.manifest.id) &&
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[pluginSource]?.actions.includes("musicUrl"),
  );
  if (candidates.length === 0) return fail(ErrorCode.NO_PLUGIN_AVAILABLE);
  // 体检登记表：跳过该（脚本 × 源 × 档 × 曲目）近期硬失败的组合，避免重复无效请求
  // 键必须带曲目：无版权/无链接类硬失败是单曲级的，不带会把"某首歌拿不到"误记成插件整体不可用
  const probeApiAvailable = typeof window.api.plugins.probeUrl === "function";
  const trackKey = `${track.source}:${track.id}`;
  const healthKeys = new Map<string, string>();
  let healthyCandidates = candidates;
  if (probeApiAvailable) {
    try {
      const keys = candidates.map((info) => {
        const key = buildHealthKey(
          info.manifest.id,
          info.manifest.hash,
          pluginSource,
          quality,
          trackKey,
        );
        healthKeys.set(info.manifest.id, key);
        return key;
      });
      const table = await readHealthTable();
      const knownSet = new Set(
        keys.filter((key) => table[key] && !table[key].ok && table[key].hard),
      );
      // 仅当仍有健康候选时才裁剪；全部命中硬失败说明多为单曲级问题累积，放行一次重试
      if (knownSet.size > 0 && knownSet.size < candidates.length) {
        healthyCandidates = candidates.filter(
          (info) => !knownSet.has(healthKeys.get(info.manifest.id)!),
        );
      }
    } catch {
      healthyCandidates = candidates;
    }
  }
  // 补齐 id / songmid / songId / hash / albumId 等字段
  const totalSec = track.duration > 0 ? Math.round(track.duration / 1000) : 0;
  const interval =
    totalSec > 0
      ? `${Math.floor(totalSec / 60)
          .toString()
          .padStart(2, "0")}:${(totalSec % 60).toString().padStart(2, "0")}`
      : null;
  const singer = track.artists.map((artist) => artist.name).join("/");
  const songId = track.id;
  const isHash =
    typeof songId === "string" && songId.length === 32 && /^[0-9a-fA-F]{32}$/.test(songId);
  const hash = isHash || track.source === "kugou" ? songId : undefined;
  // 咪咕插件取链需要 copyrightId（宿主存在 extId），与 songId 一起塞进 meta
  const miguCopyrightId = track.source === "migu" ? (track.extId ?? "").trim() : "";
  const musicInfo = {
    id: songId,
    songmid: songId,
    songId,
    name: track.title,
    singer,
    source: pluginSource,
    interval,
    img: track.cover ?? null,
    ...(hash ? { hash } : {}),
    ...(miguCopyrightId ? { copyrightId: miguCopyrightId } : {}),
    albumId: track.album?.id ?? "",
    albumName: track.album?.name ?? "",
    meta: {
      songId,
      albumName: track.album?.name ?? "",
      albumId: track.album?.id ?? "",
      picUrl: track.cover ?? null,
      ...(hash ? { hash } : {}),
      ...(miguCopyrightId ? { copyrightId: miguCopyrightId } : {}),
    },
  };

  /** 体检回写（软失败 message 缺省时不落表，交由调用方重试） */
  const reportHealth = async (
    pluginId: string,
    entry: { ok: boolean; hard?: boolean; message?: string; sizeBytes?: number },
  ): Promise<void> => {
    if (!probeApiAvailable) return;
    const key = healthKeys.get(pluginId);
    if (!key) return;
    // 写入后让读缓存失效，避免同一轮里读到刚写前的旧表
    invalidateHealthCache();
    await window.api.plugins.healthReport?.({ key, entry }).catch(() => {});
  };

  /** 取链（首次 8s，超时后带 25s 重试一次） */
  const resolveOnce = async (
    plugin: (typeof candidates)[number],
  ): Promise<{ url: string; level?: PluginQuality; softTimeout: boolean } | { error: string }> => {
    const attempt = async (
      timeoutMs: number,
    ): Promise<{ url: string; level?: PluginQuality } | { error: string }> => {
      try {
        const res = await window.api.plugins.resolveUrl({
          pluginId: plugin.manifest.id,
          source: pluginSource,
          quality,
          musicInfo,
          timeoutMs,
        });
        if (res?.url) return { url: res.url, level: res.quality };
        return { error: "返回空链接" };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    };
    const first = await attempt(RESOLVE_TIMEOUT_FAST_MS);
    if (!("error" in first)) return { ...first, softTimeout: false };
    if (!isTimeoutMessage(first.error)) return first;
    console.warn("[plugin] resolveUrl 超时，使用长超时重试一次", plugin.manifest.id);
    const second = await attempt(RESOLVE_TIMEOUT_RETRY_MS);
    if (!("error" in second)) return { ...second, softTimeout: true };
    return second;
  };

  // 并发请求全部候选插件，任一失败不影响其余
  const settled = await Promise.all(
    healthyCandidates.map(async (plugin) => {
      const res = await resolveOnce(plugin);
      if ("error" in res) {
        // 超时类为软失败：不落表，下次照常尝试；其余硬失败落表
        if (!isTimeoutMessage(res.error)) {
          void reportHealth(plugin.manifest.id, { ok: false, hard: true, message: res.error });
        }
        console.warn("[plugin] resolveUrl failed", plugin.manifest.id, res.error);
        return null;
      }
      return {
        ok: true as const,
        url: res.url,
        pluginId: plugin.manifest.id,
        level: res.level,
        softTimeout: res.softTimeout,
      };
    }),
  );
  const hits = settled.filter((item): item is NonNullable<typeof item> => item !== null);
  if (hits.length === 0) return fail(ErrorCode.URL_RESOLVE_FAILED);
  // 取声明档位最高者；档位未知按最低计，同档位保持候选顺序（稳定）
  hits.sort((a, b) => {
    const rankA = a.level ? qualityRank(a.level) : -1;
    const rankB = b.level ? qualityRank(b.level) : -1;
    return rankB - rankA;
  });
  let best = hits[0];
  /** 探针实测体积（随接受结果带出，供下载进度兜底） */
  let bestSize: number | undefined;

  // URL 预探针：按声明档位从高到低逐个探测，取首个可用者
  if (probe && probeApiAvailable) {
    let accepted = false;
    let probedResponses = 0;
    let hardRejected = 0;
    for (const hit of hits) {
      const result = await window.api.plugins
        .probeUrl({ url: hit.url, durationSec: totalSec })
        .catch(() => null);
      // 探针自身不可用：按未探测处理，保留声明档位最高者（由下载后校验兜底）
      if (!result) break;
      probedResponses++;
      if (result.ok) {
        best = hit;
        accepted = true;
        if (result.sizeBytes > 0) bestSize = result.sizeBytes;
        void reportHealth(hit.pluginId, { ok: true, sizeBytes: result.sizeBytes });
        break;
      }
      // 硬失败落表；软失败（超时）不落表，继续试下一个候选
      if (!result.timedOut) {
        hardRejected++;
        void reportHealth(hit.pluginId, { ok: false, hard: true, message: result.message });
      }
      console.warn("[plugin] 探针拒绝", hit.pluginId, result.message);
    }
    // 每个候选都拿到响应且全为硬失败 → 判定取链失败（避免把试听片段交给下载器）
    if (!accepted && probedResponses === hits.length && hardRejected === hits.length) {
      return fail(ErrorCode.SOURCE_PROBE_REJECTED);
    }
  }

  return {
    ok: true,
    url: best.url,
    isTrial: false,
    provider: "plugin",
    pluginId: best.pluginId,
    level: best.level,
    sizeBytes: bestSize,
  };
};

/**
 * 解析在线音频源 URL
 *
 * 官方接口返回的实际档位低于请求档位（接口静默降档 / 平台本身没有该档位）时，
 * 先让插件尝试拿到更高档位，插件失败再回落到官方降档直链；官方已达标则直接采用。
 * @param track - 要解析的 track
 * @param songLevel - 在线歌曲音质档位（仅内置官方接口生效）
 */
const resolveOnlineUrl = async (
  track: Track,
  songLevel: QualityLevel,
  options: ResolveTrackSourceOptions = {},
): Promise<OnlineResolveResult> => {
  const settings = useSettingsStore();
  let trialUrl: string | null = null;
  let officialErrorCode: ErrorCode | null = null;
  /** 官方直链可用但档位低于请求时的兜底结果 */
  let officialFallback: { url: string; level: QualityLevel } | null = null;
  if (track.source === "netease" && !options.skipOfficialOnline) {
    const user = useUserStore();
    try {
      const resolved = await resolveNeteaseUrl(track, songLevel, {
        authenticated: user.isLoggedIn,
        validate: () => user.fetchStatus(),
      });
      if (!resolved.available) {
        officialErrorCode = resolved.errorCode;
      } else if (!resolved.isTrial) {
        const level = resolved.level;
        if (!level || qualityMeets(level, songLevel)) {
          return { ok: true, url: resolved.url, isTrial: false, provider: "official", level };
        }
        officialFallback = { url: resolved.url, level };
      } else {
        trialUrl = resolved.url;
      }
    } catch (err) {
      console.warn("[audio-source] official URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  if (track.source === "qqmusic" && !options.skipOfficialOnline) {
    try {
      const resolved = await resolveQQMusicUrl(track, songLevel);
      if (resolved.available) {
        const level = resolved.level;
        if (!level || qualityMeets(level, songLevel)) {
          return { ok: true, url: resolved.url, isTrial: false, provider: "official", level };
        }
        officialFallback = { url: resolved.url, level };
      } else {
        officialErrorCode = resolved.errorCode;
      }
    } catch (err) {
      console.warn("[audio-source] official QQMusic URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  if (track.source === "kugou" && !options.skipOfficialOnline) {
    try {
      const resolved = await resolveKugouUrl(track, songLevel);
      if (resolved.available) {
        if (qualityMeets(resolved.level, songLevel)) {
          return {
            ok: true,
            url: resolved.url,
            isTrial: false,
            provider: "official",
            level: resolved.level,
          };
        }
        officialFallback = { url: resolved.url, level: resolved.level };
      } else {
        officialErrorCode = resolved.errorCode;
      }
    } catch (err) {
      console.warn("[audio-source] official Kugou URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  if (track.source === "kuwo" && !options.skipOfficialOnline) {
    try {
      const resolved = await resolveKuwoUrl(track, songLevel);
      if (resolved.available) {
        if (qualityMeets(resolved.level, songLevel)) {
          return {
            ok: true,
            url: resolved.url,
            isTrial: false,
            provider: "official",
            level: resolved.level,
          };
        }
        officialFallback = { url: resolved.url, level: resolved.level };
      } else {
        officialErrorCode = resolved.errorCode;
      }
    } catch (err) {
      console.warn("[audio-source] official Kuwo URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  const pluginResolved = await resolveByPluginBest(track, songLevel, options.skipPluginIds ?? []);
  if (officialFallback) {
    // 官方只是降档拿到了直链：插件承诺更高档位才替换，否则保留可播的官方结果
    const pluginIsHigher =
      pluginResolved.ok &&
      pluginResolved.level !== undefined &&
      qualityRank(pluginResolved.level) > qualityRank(officialFallback.level);
    if (pluginIsHigher) return pluginResolved;
    return {
      ok: true,
      url: officialFallback.url,
      isTrial: false,
      provider: "official",
      level: officialFallback.level,
    };
  }
  if (pluginResolved.ok) return pluginResolved;
  if (trialUrl && settings.player.allowTrialPlay) {
    return { ok: true, url: trialUrl, isTrial: true, provider: "trial" };
  }
  if (trialUrl) return { ok: false, errorCode: ErrorCode.NETEASE_TRIAL_DISABLED };
  if (officialErrorCode) return { ok: false, errorCode: officialErrorCode };
  return pluginResolved;
};

/**
 * 解析结果
 * - fromCache 为 true 时表示音源直接命中本地缓存
 * - cacheRequest 存在时表示尚未缓存，调用方应在合适时机（如播放达到阈值后）触发它
 */
export interface ResolvedTrackSource {
  source: string;
  fromCache: boolean;
  provider: "local" | "cache" | "streaming" | "official" | "plugin" | "trial";
  pluginId?: string;
  /** 解析确认的实际音质档位；本地 / 缓存命中等未知场景缺省 */
  level?: QualityLevel;
  /**
   * 下载音源并返回可供原生预载使用的缓存路径
   * @param preloadId - 可选的预载消费者标识，用于缓存租约和独立取消
   * @param signal - 在解析下载地址期间取消任务的信号
   * @returns 缓存路径，未完成下载或已取消时返回 null
   */
  cacheRequest?: (preloadId?: string, signal?: AbortSignal) => Promise<string | null>;
}

/**
 * 记录解析错误，支持静默模式抑制
 * @param err - 错误信息或错误码
 * @param options - 提示方式和错误接收回调
 */
const reportLoadError = (err: ErrorCode | string, options: ResolveTrackSourceOptions): void => {
  options.onError?.(err);
  if (!options.silent) handleError(err);
};

/**
 * 解析歌曲的可播放音源及缓存下载入口
 * @param track - 要解析的歌曲
 * @param options - 错误提示、流媒体会话及在线来源重试选项
 * @returns 本地路径或远端地址及缓存入口，无法解析时返回 null
 */
export const resolveTrackSource = async (
  track: Track,
  options: ResolveTrackSourceOptions = {},
): Promise<ResolvedTrackSource | null> => {
  // 本地文件
  if (track.source === "local") {
    const localPath = track.cueAudioPath ?? track.path;
    if (!localPath) reportLoadError(ErrorCode.FILE_NOT_FOUND, options);
    return localPath ? { source: localPath, fromCache: false, provider: "local" } : null;
  }
  const settings = useSettingsStore();
  const songLevel = settings.player.songLevel;
  const cacheKey = cacheKeyForTrack(track, songLevel);
  const cacheEnabled = settings.system.cache?.songCache?.enabled === true && cacheKey !== null;
  if (cacheEnabled) {
    const cached = await window.api.cache.song.lookup(cacheKey!);
    if (cached) return { source: cached, fromCache: true, provider: "cache" };
  }
  // 流媒体
  if (track.source === "streaming") {
    try {
      const store = useStreamingStore();
      const streamUrl = await store.getStreamUrl(
        track,
        options.streamingPlaySessionId
          ? { playSessionId: options.streamingPlaySessionId }
          : undefined,
      );
      const result: ResolvedTrackSource = {
        source: streamUrl,
        fromCache: false,
        provider: "streaming",
      };
      if (cacheEnabled && settings.system.cache.songCache.cacheStreaming) {
        // 缓存下载用独立 PlaySessionId
        result.cacheRequest = async (preloadId, signal) => {
          try {
            const cacheUrl = await store.getStreamUrl(track, {
              playSessionId: crypto.randomUUID(),
            });
            if (signal?.aborted) return null;
            return await window.api.cache.song.fetch(cacheKey, "streaming", cacheUrl, preloadId);
          } catch (err) {
            console.warn("[cache] streaming getStreamUrl failed", err);
            return null;
          }
        };
      }
      return result;
    } catch (err) {
      reportLoadError(err instanceof Error ? err.message : String(err), options);
      return null;
    }
  }
  // 在线源（netease / qqmusic / kugou）
  if (isOnlinePlatform(track.source)) {
    try {
      const resolved = await resolveOnlineUrl(track, songLevel, options);
      if (!resolved.ok) {
        reportLoadError(resolved.errorCode, options);
        return null;
      }
      const url = resolved.url;
      const result: ResolvedTrackSource = {
        source: url,
        fromCache: false,
        provider: resolved.provider,
        pluginId: resolved.pluginId,
        level: resolved.level,
      };
      if (cacheEnabled && !resolved.isTrial) {
        result.cacheRequest = async (preloadId, signal) => {
          if (signal?.aborted) return null;
          return window.api.cache.song.fetch(cacheKey, track.source, url, preloadId);
        };
      }
      return result;
    } catch (err) {
      reportLoadError(err instanceof Error ? err.message : String(err), options);
      return null;
    }
  }
  return null;
};
