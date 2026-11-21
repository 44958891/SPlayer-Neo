import type { Track, TrackSource } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { PluginQuality } from "@shared/types/plugin";
import type { DownloadTrackIdentity } from "@shared/types/download";
import type {
  PlatformQualityOption,
  QualityProvenance,
  ResolvedAudioFile,
} from "@shared/types/quality";
import { buildHealthKey, isTimeoutMessage, type PluginHealthEntry } from "@shared/utils/audioProbe";
import {
  findPlatformQuality,
  normalizeStoredQualitySelection,
  resolvePlatformQuality,
} from "@shared/utils/platformQuality";
import { provenanceFromPlugin, validateQualityProvenance } from "@shared/utils/qualityProvenance";
import { qualityMeets, qualityRank, type QualityLevel } from "@/utils/quality";
import { streamingSourceForTrack } from "@shared/utils/streamingSource";
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
  /** 已下载文件加载失败时跳过，继续解析缓存或在线音源 */
  skipDownloaded?: boolean;
  /** 显式重取链时跳过歌曲缓存读取；缓存写入（cacheRequest）不受影响 */
  skipCache?: boolean;
  /** 将解析失败原因交给播放流程，供提示和跳曲决策使用 */
  onError?: (error: string) => void;
  /** 要跳过的插件 ID 列表 */
  skipPluginIds?: readonly string[];
  /** 是否跳过官方在线接口，直接进入插件兜底 */
  skipOfficialOnline?: boolean;
  /** 用户保存的具体平台音质选择标识；缺省回读设置，未保存时保持通用档位请求 */
  qualitySelection?: string;
  /** 是否静默解析 */
  silent?: boolean;
}

/**
 * 解析当前曲目的具体音质选择（仅显式提供或设置里保存过时生效）
 * @param track - 要解析的 track，选择按其平台约束解析
 * @param songLevel - 历史全局音质等级，用于跨平台时按音质意图映射
 * @param selection - 调用方显式传入或设置保存的选择标识
 * @returns 该平台的目标选项；QQ 空间目标按独立档位请求，其余通用请求沿用旧行为
 */
const resolveSelectionOption = (
  track: Track,
  songLevel: QualityLevel,
  selection: string | undefined,
): PlatformQualityOption | undefined => {
  if (!isOnlinePlatform(track.source)) return undefined;
  if (!selection && !(track.source === "qqmusic" && songLevel === "sky")) return undefined;
  return resolvePlatformQuality(track.source, songLevel, selection);
};

/**
 * 校验跨进程读回的文件及其来源信息，剔除非法字段
 * @param file - IPC 回传的已存在音频文件
 * @returns 来源信息经过校验的文件，空文件返回 undefined
 */
const validatedAudioFile = (file: ResolvedAudioFile | null): ResolvedAudioFile | undefined => {
  if (!file?.path) return undefined;
  return { ...file, qualityProvenance: validateQualityProvenance(file.qualityProvenance) };
};

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
 * netease / qqmusic 把音质档位并入键，使不同音质的同一首歌互不覆盖；
 * 有具体平台音质选择时以选项 id 并入键，同档位的臻品音质与全景声互不覆盖
 * @param track - 要解析的 track
 * @param songLevel - 在线歌曲音质档位
 * @param selectionId - 当前平台的具体音质选择标识；缺省保持旧键格式
 * @returns 派生缓存键，如果该 track 不参与歌曲缓存则返回 null
 */
const cacheKeyForTrack = (
  track: Track,
  songLevel: QualityLevel,
  selectionId?: string,
): string | null => {
  const tier = selectionId ?? songLevel;
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  if (track.source === "kugou" && track.id) {
    return `o:kugou:${track.id}:${track.extId ?? ""}:${tier}`;
  }
  if (isOnlinePlatform(track.source) && track.id) {
    return `o:${track.source}:${track.id}:${tier}`;
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
      /** 本次取链的音质来源证据；官方通道来自响应/文件名/请求，插件通道由回包形态决定 */
      qualityProvenance?: QualityProvenance;
      /** 预探针实测的完整文件体积（字节）；未探测或未知时缺省 */
      sizeBytes?: number;
    }
  | { ok: false; errorCode: ErrorCode };

/**
 * 经插件解析在线音频源 URL
 * @param track - 要解析的 track
 * @param quality - 音质档位（由调用方传入，默认 hq）
 * @param skipPluginIds - 要跳过的插件 ID
 * @param qualitySelection - 当前平台的具体音质选择标识；独立插件曲目保持通用请求
 * @returns 解析结果，失败时带原因码
 */
export const resolveByPlugin = async (
  track: Track,
  quality: QualityLevel = "hq",
  skipPluginIds: readonly string[] = [],
  qualitySelection?: string,
): Promise<OnlineResolveResult> => {
  const fail = (errorCode: ErrorCode): OnlineResolveResult => ({ ok: false, errorCode });
  const plugins = usePluginsStore();
  if (track.source === "plugin") {
    const origin = track.plugin;
    if (!origin || skipPluginIds.includes(origin.pluginId)) {
      return fail(ErrorCode.NO_PLUGIN_AVAILABLE);
    }
    const plugin = plugins.list.find((info) => info.manifest.id === origin.pluginId);
    if (
      !plugin?.enabled ||
      plugin.status.state !== "ready" ||
      !plugin.status.sources[origin.source]?.actions.includes("musicUrl")
    ) {
      return fail(ErrorCode.NO_PLUGIN_AVAILABLE);
    }
    try {
      const res = await window.api.plugins.resolveUrl({
        pluginId: origin.pluginId,
        source: origin.source,
        quality,
        musicInfo: { ...origin.musicInfo, songmid: origin.musicInfo.id },
      });
      const current = plugins.list.find((info) => info.manifest.id === origin.pluginId);
      if (
        !current?.enabled ||
        current.status.state !== "ready" ||
        !current.status.sources[origin.source]?.actions.includes("musicUrl")
      ) {
        return fail(ErrorCode.NO_PLUGIN_AVAILABLE);
      }
      return res?.url
        ? {
            ok: true,
            url: res.url,
            isTrial: false,
            provider: "plugin",
            pluginId: origin.pluginId,
            level: res.quality,
            qualityProvenance: provenanceFromPlugin(res, origin.pluginId, origin.source),
          }
        : fail(ErrorCode.URL_RESOLVE_FAILED);
    } catch (err) {
      console.warn("[plugin] resolveUrl failed", origin.pluginId, err);
      return fail(ErrorCode.URL_RESOLVE_FAILED);
    }
  }
  if (!isOnlinePlatform(track.source)) return fail(ErrorCode.URL_RESOLVE_FAILED);
  const pluginSource = PLATFORM_TO_PLUGIN_SOURCE[track.source];
  if (!pluginSource) return fail(ErrorCode.URL_RESOLVE_FAILED);
  const skip = new Set(skipPluginIds);
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
        ...(qualitySelection ? { qualitySelection } : {}),
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
          qualityProvenance: provenanceFromPlugin(res, plugin.manifest.id, pluginSource),
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
 * @param qualitySelection - 当前平台的具体音质选择标识，随请求透传给插件
 */
export const resolveByPluginBest = async (
  track: Track,
  quality: QualityLevel = "hq",
  skipPluginIds: readonly string[] = [],
  probe = false,
  qualitySelection?: string,
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
          qualitySelection ?? quality,
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
  ): Promise<
    | {
        url: string;
        level?: PluginQuality;
        provenance: QualityProvenance;
        softTimeout: boolean;
      }
    | { error: string }
  > => {
    const attempt = async (
      timeoutMs: number,
    ): Promise<
      { url: string; level?: PluginQuality; provenance: QualityProvenance } | { error: string }
    > => {
      try {
        const res = await window.api.plugins.resolveUrl({
          pluginId: plugin.manifest.id,
          source: pluginSource,
          quality,
          ...(qualitySelection ? { qualitySelection } : {}),
          musicInfo,
          timeoutMs,
        });
        if (res?.url)
          return {
            url: res.url,
            level: res.quality,
            provenance: provenanceFromPlugin(res, plugin.manifest.id, pluginSource),
          };
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
        provenance: res.provenance,
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
  /** 显式选择下参与采用的候选池；已知低于物理下限的回执不再冒充成功 */
  let pool = hits;
  const explicitOption = qualitySelection ? findPlatformQuality(qualitySelection) : undefined;
  if (explicitOption) {
    // 与共享校验同一物理下限口径：品牌档看最低规格，空间等声明类专档不做档位排名
    const physicalFloor =
      explicitOption.minimumLevel ??
      (explicitOption.requiresDeclaration
        ? explicitOption.family === "premium"
          ? "hi-res"
          : undefined
        : explicitOption.level);
    if (physicalFloor) {
      const floorRank = qualityRank(physicalFloor);
      const knownLower = hits.filter(
        (hit) =>
          hit.provenance.evidence === "plugin" &&
          hit.level !== undefined &&
          qualityRank(hit.level) < floorRank,
      );
      // 仍有非已知降档候选时不采用已知降档回执，交由其余候选或上层换源兜底
      if (knownLower.length < hits.length) pool = hits.filter((hit) => !knownLower.includes(hit));
    }
  }
  let best = pool[0];
  /** 探针实测体积（随接受结果带出，供下载进度兜底） */
  let bestSize: number | undefined;

  // URL 预探针：按声明档位从高到低逐个探测，取首个可用者
  if (probe && probeApiAvailable) {
    let accepted = false;
    let probedResponses = 0;
    let hardRejected = 0;
    for (const hit of pool) {
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
    if (!accepted && probedResponses === pool.length && hardRejected === pool.length) {
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
    qualityProvenance: best.provenance,
    sizeBytes: bestSize,
  };
};

/**
 * 解析在线音频源 URL
 *
 * 官方接口返回的实际档位低于请求档位（接口静默降档 / 平台本身没有该档位）时，
 * 先让插件尝试拿到更高档位，插件失败再回落到官方降档直链；官方已达标则直接采用。
 * 有具体音质选择时按目录描述决定官方通道是否可用：官方不支持的臻品 / 全景声等
 * 专档直接走插件，避免官方同档位的其他品牌档（如全景声选择拿到臻品音质）冒名顶替。
 * @param track - 要解析的 track
 * @param songLevel - 在线歌曲音质档位（仅内置官方接口生效）
 * @param options - 解析选项；qualitySelection 为具体平台音质选择标识
 */
const resolveOnlineUrl = async (
  track: Track,
  songLevel: QualityLevel,
  options: ResolveTrackSourceOptions = {},
): Promise<OnlineResolveResult> => {
  const settings = useSettingsStore();
  const selectionOption = resolveSelectionOption(track, songLevel, options.qualitySelection);
  const officialAllowed = selectionOption ? selectionOption.official : true;
  let trialUrl: string | null = null;
  let officialErrorCode: ErrorCode | null = null;
  /** 官方直链可用但档位低于请求时的兜底结果 */
  let officialFallback: {
    url: string;
    level: QualityLevel;
    qualityProvenance?: QualityProvenance;
  } | null = null;
  if (track.source === "netease" && !options.skipOfficialOnline && officialAllowed) {
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
          return {
            ok: true,
            url: resolved.url,
            isTrial: false,
            provider: "official",
            level,
            qualityProvenance: resolved.qualityProvenance,
          };
        }
        officialFallback = {
          url: resolved.url,
          level,
          qualityProvenance: resolved.qualityProvenance,
        };
      } else {
        trialUrl = resolved.url;
      }
    } catch (err) {
      console.warn("[audio-source] official URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  if (track.source === "qqmusic" && !options.skipOfficialOnline && officialAllowed) {
    try {
      const resolved = await resolveQQMusicUrl(track, songLevel);
      if (resolved.available) {
        const level = resolved.level;
        if (!level || qualityMeets(level, songLevel)) {
          return {
            ok: true,
            url: resolved.url,
            isTrial: false,
            provider: "official",
            level,
            qualityProvenance: resolved.qualityProvenance,
          };
        }
        officialFallback = {
          url: resolved.url,
          level,
          qualityProvenance: resolved.qualityProvenance,
        };
      } else {
        officialErrorCode = resolved.errorCode;
      }
    } catch (err) {
      console.warn("[audio-source] official QQMusic URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  if (track.source === "kugou" && !options.skipOfficialOnline && officialAllowed) {
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
            qualityProvenance: resolved.qualityProvenance,
          };
        }
        officialFallback = {
          url: resolved.url,
          level: resolved.level,
          qualityProvenance: resolved.qualityProvenance,
        };
      } else {
        officialErrorCode = resolved.errorCode;
      }
    } catch (err) {
      console.warn("[audio-source] official Kugou URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  if (track.source === "kuwo" && !options.skipOfficialOnline && officialAllowed) {
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
            qualityProvenance: resolved.qualityProvenance,
          };
        }
        officialFallback = {
          url: resolved.url,
          level: resolved.level,
          qualityProvenance: resolved.qualityProvenance,
        };
      } else {
        officialErrorCode = resolved.errorCode;
      }
    } catch (err) {
      console.warn("[audio-source] official Kuwo URL resolve failed:", err);
      officialErrorCode = ErrorCode.NETWORK_ERROR;
    }
  }
  const pluginResolved = await resolveByPluginBest(
    track,
    songLevel,
    options.skipPluginIds ?? [],
    false,
    selectionOption?.id,
  );
  if (officialFallback) {
    // 官方只是降档拿到了直链：插件承诺更高档位才替换，否则保留可播的官方结果
    // 显式选择时替换依据必须来自实际档位回执，请求回显的老插件不能冒充达标来源
    const pluginIsHigher =
      pluginResolved.ok &&
      pluginResolved.level !== undefined &&
      (!selectionOption || pluginResolved.qualityProvenance?.evidence !== "request") &&
      qualityRank(pluginResolved.level) > qualityRank(officialFallback.level);
    if (pluginIsHigher) return pluginResolved;
    return {
      ok: true,
      url: officialFallback.url,
      isTrial: false,
      provider: "official",
      level: officialFallback.level,
      qualityProvenance: officialFallback.qualityProvenance,
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
  provider: "local" | "download" | "cache" | "streaming" | "official" | "plugin" | "trial";
  pluginId?: string;
  /** 解析确认的实际音质档位；本地 / 缓存命中等未知场景缺省 */
  level?: QualityLevel;
  /** 本次音源的档位来源证据；旧路径查询或未知场景缺省 */
  qualityProvenance?: QualityProvenance;
  /**
   * 本次请求的具体平台音质选择标识；是请求目标而非实际交付，
   * 与 level / qualityProvenance 分开携带，供播放校验对照使用
   */
  qualitySelection?: string;
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
  // 具体音质选择仅在显式传入或设置保存过时生效；通用请求保持旧默认行为
  const selectionId = options.qualitySelection ?? settings.player.songQualitySelection;
  const selectionOption = resolveSelectionOption(track, songLevel, selectionId);
  const targetLevel = selectionOption?.level ?? songLevel;
  // 跨平台映射后仍按具体选项分缓存，增强与空间档不能共用 sky 桶
  const concreteSelectionId = selectionOption?.id;
  if (track.source === "plugin") {
    const resolved = await resolveByPlugin(track, songLevel, options.skipPluginIds);
    if (!resolved.ok) {
      reportLoadError(resolved.errorCode, options);
      return null;
    }
    return {
      source: resolved.url,
      fromCache: false,
      provider: "plugin",
      pluginId: resolved.pluginId,
      level: resolved.level,
      qualityProvenance: resolved.qualityProvenance,
    };
  }
  if (!options.skipDownloaded) {
    try {
      const identity: DownloadTrackIdentity = {
        source: track.source,
        id: track.id,
        ...(track.source === "streaming"
          ? { serverId: track.serverId, originalId: track.originalId }
          : {}),
      };
      const downloadApi = window.api.download;
      if (typeof downloadApi?.lookupInfo === "function") {
        // 新查询带回随文件保存的来源信息，经校验后原样继承
        const file = validatedAudioFile(await downloadApi.lookupInfo(identity));
        if (file) {
          return {
            source: file.path,
            fromCache: false,
            provider: "download",
            qualityProvenance: file.qualityProvenance,
            qualitySelection: concreteSelectionId,
          };
        }
      } else {
        // 旧查询只回路径：显式不带来源信息，清掉曲目上残留的上一轮 provenance
        const downloaded = await window.api.download.lookup(identity);
        if (downloaded)
          return {
            source: downloaded,
            fromCache: false,
            provider: "download",
            qualitySelection: concreteSelectionId,
          };
      }
    } catch (err) {
      console.warn("[audio-source] download lookup failed:", err);
    }
  }
  if (
    isOnlinePlatform(track.source) &&
    ((selectionId && (!normalizeStoredQualitySelection(selectionId) || !selectionOption)) ||
      (track.source === "qqmusic" && !selectionOption && songLevel === "jyeffect"))
  ) {
    reportLoadError(ErrorCode.URL_RESOLVE_FAILED, options);
    return null;
  }
  const cacheKey = cacheKeyForTrack(track, targetLevel, concreteSelectionId);
  const cacheEnabled = settings.system.cache?.songCache?.enabled === true && cacheKey !== null;
  if (cacheEnabled && !options.skipCache) {
    const cacheApi = window.api.cache.song;
    if (typeof cacheApi?.lookupInfo === "function") {
      // 新查询带回随缓存保存的来源信息，经校验后原样继承
      const file = validatedAudioFile(await cacheApi.lookupInfo(cacheKey!));
      if (file) {
        return {
          source: file.path,
          fromCache: true,
          provider: "cache",
          qualityProvenance: file.qualityProvenance,
          qualitySelection: concreteSelectionId,
        };
      }
    } else {
      const cached = await window.api.cache.song.lookup(cacheKey!);
      if (cached)
        return {
          source: cached,
          fromCache: true,
          provider: "cache",
          qualitySelection: concreteSelectionId,
        };
    }
  }
  // 流媒体
  if (track.source === "streaming") {
    try {
      const source = streamingSourceForTrack(track);
      const result: ResolvedTrackSource = {
        source,
        fromCache: false,
        provider: "streaming",
      };
      if (cacheEnabled && settings.system.cache.songCache.cacheStreaming) {
        // 缓存下载用独立 PlaySessionId
        result.cacheRequest = async (preloadId, signal) => {
          try {
            if (signal?.aborted) return null;
            return await window.api.cache.song.fetch(cacheKey, "streaming", source, preloadId);
          } catch (err) {
            console.warn("[cache] 流媒体缓存失败", err);
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
      // 把按当前平台解析出的选择带入子流程，设置默认路径与显式传参走同一套官方门槛
      const resolved = await resolveOnlineUrl(track, targetLevel, {
        ...options,
        qualitySelection: selectionOption?.id ?? options.qualitySelection,
      });
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
        qualityProvenance: resolved.qualityProvenance,
        qualitySelection: concreteSelectionId,
      };
      if (cacheEnabled && !resolved.isTrial) {
        // 来源信息随缓存文件落盘，再次命中缓存时仍能展示档位依据
        const fetchSong = window.api.cache.song.fetch;
        const provenance = resolved.qualityProvenance;
        result.cacheRequest = async (preloadId, signal) => {
          if (signal?.aborted) return null;
          return fetchSong(cacheKey, track.source, url, preloadId, provenance);
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
