import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { DownloadRequest, DownloadTagOptions, DownloadTask } from "@shared/types/download";
import type { QualityLevel } from "@shared/types/quality";
import { QUALITY_LABELS } from "@/utils/quality";
import {
  PLATFORM_QUALITY_OPTIONS,
  canDownloadQualityOption,
  collectQualityCapabilities,
  findPlatformQuality,
  platformOf,
  resolvePlatformQuality,
} from "@/utils/platformQuality";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";

/** 下载选项 */
interface EnqueueOptions {
  /** 临时通用音质档位，覆盖设置（旧协议，映射到当前平台具体档位） */
  quality?: QualityLevel;
  /** 平台具体音质选择标识（platform:tier），覆盖设置；必须匹配歌曲平台 */
  qualitySelection?: string;
  /** 复用已有任务 id（重试） */
  taskId?: string;
  /** 音质升级：文件落地目录（原文件所在目录） */
  targetDir?: string;
  /** 音质升级：下载成功后删除的原文件路径 */
  replaceSourcePath?: string;
  /** 音质升级：替换的显式质量下限（原文件损坏时用） */
  minLevel?: QualityLevel;
}

/** 可下载通用音质档位（展示顺序；无平台上下文时的旧菜单兜底） */
const DOWNLOAD_QUALITY_LEVELS: QualityLevel[] = [
  "jymaster",
  "sky",
  "jyeffect",
  "hi-res",
  "lossless",
  "hq",
  "sq",
  "lq",
];

/** 下载菜单项（比旧结构多一个禁用标记，供 SDropdownMenu 原生置灰） */
export interface DownloadQualityMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
}

/** 下载目标解析结果 */
export type ResolvedDownloadTarget =
  | { ok: true; level: QualityLevel; qualitySelection?: string }
  | { ok: false; reason: "local" | "unsupported" };

/**
 * 解析单曲的下载音质目标
 *
 * 在线平台：显式选择标识必须能匹配该平台；默认目标由「全局通用档位 + 全局具体选择」
 * 映射到歌曲所属平台。映射不到等价档位（如环绕声目标落到 QQ 音乐）时判定不支持，
 * 失败要显式报出，禁止静默降级到其他档位。
 *
 * 非在线平台（流媒体服务器等）：保持旧通用档位，无平台具体选择。
 *
 * @param platform - 歌曲平台；非在线平台传 undefined
 * @param legacyLevel - 全局通用档位偏好
 * @param storedSelection - 全局具体选择偏好
 * @param explicit - 单次请求覆盖（qualitySelection 优先，其次 quality）
 */
export const resolveDownloadTarget = (
  platform: Platform | undefined,
  legacyLevel: QualityLevel,
  storedSelection: string | undefined,
  explicit?: { quality?: QualityLevel; qualitySelection?: string },
): ResolvedDownloadTarget => {
  if (!platform) {
    return { ok: true, level: explicit?.quality ?? legacyLevel };
  }
  const selection = explicit?.qualitySelection;
  const exact = selection ? findPlatformQuality(selection, platform) : undefined;
  if (selection && !exact) return { ok: false, reason: "unsupported" };
  if (exact) return { ok: true, level: exact.level, qualitySelection: exact.id };
  // 显式指定了旧通用档位时只按档位映射，不受全局具体选择干扰
  const familySelection = explicit?.quality ? undefined : (selection ?? storedSelection);
  const mapped = resolvePlatformQuality(
    platform,
    explicit?.quality ?? legacyLevel,
    familySelection,
  );
  return mapped
    ? { ok: true, level: mapped.level, qualitySelection: mapped.id }
    : { ok: false, reason: "unsupported" };
};

/**
 * 构建下载音质菜单项
 *
 * 在线平台：仅列出该平台自己的菜单（选项 key 为选择标识），无法服务的档位置灰并附原因；
 * 「跟随默认」项展示该平台实际映射到的目标，而不是笼统的全局档位。
 * 无平台上下文（流媒体服务器等）：维持旧通用档位菜单。
 *
 * @param defaultLabel - 「跟随默认」项文案（仅无平台上下文时使用）
 * @param keyPrefix - key 前缀；右键菜单用 "download:" 做路由
 * @param trackOrSource - 歌曲（取其 source）或平台字符串
 */
export const buildDownloadQualityItems = (
  defaultLabel: string,
  keyPrefix = "",
  trackOrSource?: Track | string | null,
): DownloadQualityMenuItem[] => {
  const { t } = i18n.global;
  const platform = platformOf(trackOrSource);
  if (!platform) {
    return [
      { key: keyPrefix, label: defaultLabel },
      ...DOWNLOAD_QUALITY_LEVELS.map((quality) => ({
        key: `${keyPrefix}${quality}`,
        label: QUALITY_LABELS[quality],
      })),
    ];
  }
  const download = useSettingsStore().system.download;
  const capabilities = collectQualityCapabilities(platform);
  const target = resolvePlatformQuality(platform, download.quality, download.qualitySelection);
  const defaultItem: DownloadQualityMenuItem = {
    key: keyPrefix,
    label: t("quality.selection.defaultWithQuality", {
      quality: target ? t(target.labelKey) : t("quality.selection.unavailable"),
    }),
  };
  return [
    defaultItem,
    ...PLATFORM_QUALITY_OPTIONS[platform].map<DownloadQualityMenuItem>((option) => {
      const enabled = canDownloadQualityOption(option, capabilities);
      const reason = !capabilities.hasPlugin
        ? t("quality.selection.pluginRequired")
        : t("quality.selection.unavailable");
      return {
        key: `${keyPrefix}${option.id}`,
        label: enabled ? t(option.labelKey) : `${t(option.labelKey)} · ${reason}`,
        disabled: !enabled,
      };
    }),
  ];
};

/** 请求构建结果 */
type RequestBuild =
  { ok: true; req: DownloadRequest } | { ok: false; reason: "local" | "unsupported" };

/**
 * 构建下载请求（不入队不提示）
 * @param track - 要下载的歌曲
 * @param opts - 覆盖选项
 */
const buildRequest = (track: Track, opts: EnqueueOptions): RequestBuild => {
  if (track.source === "local") return { ok: false, reason: "local" };
  const download = useSettingsStore().system.download;
  const platform = platformOf(track);
  const target = resolveDownloadTarget(platform, download.quality, download.qualitySelection, opts);
  if (!target.ok) return { ok: false, reason: "unsupported" };
  const tagOptions: DownloadTagOptions = {
    embedCover: download.embedCover,
    embedMeta: download.embedMeta,
    embedLyric: download.embedLyric,
    writeLrc: download.writeLrc,
    saveTtml: download.saveTtml,
  };
  return {
    ok: true,
    req: {
      taskId: opts.taskId ?? crypto.randomUUID(),
      // 深拷贝为纯对象：IPC 结构化克隆无法处理 Vue 响应式 Proxy（如来自 ref 数组的曲目）
      track: JSON.parse(JSON.stringify(track)) as Track,
      qualityLevel: target.level,
      ...(target.qualitySelection ? { qualitySelection: target.qualitySelection } : {}),
      coverUrl: track.coverOriginal ?? track.cover,
      tagOptions,
      lyricFileFormat: download.lyricFileFormat,
      targetDir: opts.targetDir,
      replaceSourcePath: opts.replaceSourcePath,
      minLevel: opts.minLevel,
    },
  };
};

export const useDownload = () => {
  // 与 download/resolver 一致使用全局 t：该组合函数只在事件回调里取文案，无需随语言切换响应
  const t = i18n.global.t;

  /**
   * 构建不含网络解析的下载请求
   * @returns 本地曲目返回 null；平台不支持目标档位时提示后返回 null
   */
  const prepareRequest = (track: Track, opts: EnqueueOptions): DownloadRequest | null => {
    const built = buildRequest(track, opts);
    if (built.ok) return built.req;
    if (built.reason === "unsupported") {
      toast.error(t("quality.selection.unsupported"));
    }
    return null;
  };

  /**
   * 单曲下载（不等待完成）
   * @returns 是否成功入队
   */
  const enqueue = async (track: Track, opts: EnqueueOptions = {}): Promise<boolean> => {
    const req = prepareRequest(track, opts);
    if (!req) return false;
    const res = opts.taskId
      ? await window.api.download.retry(req)
      : await window.api.download.start(req);
    if (!res.ok) {
      toast.warning(
        res.reason === "downloaded"
          ? t("download.alreadyDownloaded")
          : res.reason === "existsLocal"
            ? t("download.alreadyLocal", { title: track.title })
            : t("download.alreadyQueued"),
      );
      return false;
    }
    if (opts.taskId === undefined) toast.success(t("download.started", { title: track.title }));
    return true;
  };

  /** 批量下载：每首歌按自身平台映射默认目标，平台不支持的目标单独计数上报 */
  const enqueueMany = async (tracks: Track[]): Promise<void> => {
    const builds = tracks.map((track) => buildRequest(track, {}));
    const rejected = builds.filter((build) => !build.ok && build.reason === "unsupported").length;
    const requests = builds.flatMap((build) => (build.ok ? [build.req] : []));
    const results = await window.api.download.startMany(requests).catch(() => []);
    const count = results.filter((result) => result?.ok).length;
    if (count > 0) toast.success(t("download.enqueued", { count }));
    if (rejected > 0) toast.warning(t("quality.selection.batchUnsupported", { count: rejected }));
  };

  /** 重试：用任务保存的完整 Track 重新入队（复用 taskId、保存的选择与升级参数） */
  const retry = (task: DownloadTask): Promise<boolean> =>
    enqueue(task.track, {
      quality: task.qualityLevel,
      qualitySelection: task.qualitySelection,
      taskId: task.taskId,
      targetDir: task.targetDir,
      replaceSourcePath: task.replaceSourcePath,
      minLevel: task.minLevel,
    });

  return { enqueue, enqueueMany, retry };
};
