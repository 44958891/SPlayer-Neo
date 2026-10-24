<script setup lang="ts">
/**
 * 本地音乐音质升级
 *
 * 扫描曲库中低于目标音质的歌曲，按标题/歌手/时长在多平台同时匹配在线同名曲，
 * 取声明音质最高的一版，经下载管线获取更高音质并替换原文件
 * （下载成功才删原文件，失败不动原文件）。
 */
import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { DownloadRequest, DownloadTask, EnqueueResult } from "@shared/types/download";
import type { QualityLevel } from "@/utils/quality";
import { ALL_PLATFORMS } from "@shared/types/platform";
import { searchSongs } from "@/apis/search";
import { useLibraryStore } from "@/stores/library";
import { useDownloadStore } from "@/stores/download";
import { useSettingsStore } from "@/stores/settings";
import { QUALITY_LABELS, qualityRank, getQualityLevel } from "@/utils/quality";
import { findUpgradeMatch, pathDirName, pathExt } from "@/utils/qualityUpgrade";
import { formatFileSize } from "@/utils/format";
import { toast } from "@/composables/useToast";
import QualityTag from "@/components/ui/QualityTag.vue";
import IconLucideArrowRight from "~icons/lucide/arrow-right";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const libraryStore = useLibraryStore();
const downloadStore = useDownloadStore();

/** 可选目标档位（无损起步；环绕声档无法从本地文件元数据验证，不作为目标） */
const TARGET_LEVELS: QualityLevel[] = ["lossless", "hi-res", "jymaster"];

const targetOptions = TARGET_LEVELS.map((level) => ({
  value: level,
  label: QUALITY_LABELS[level],
}));

/** 音源选择：单平台或全部平台并发 */
type SourceChoice = Platform | "all";
const sourceOptions = [
  { value: "all", label: t("library.upgrade.sourceAll") },
  { value: "netease", label: t("library.upgrade.sourceNetease") },
  { value: "qqmusic", label: t("library.upgrade.sourceQq") },
  { value: "kugou", label: t("library.upgrade.sourceKugou") },
  { value: "kuwo", label: t("library.upgrade.sourceKuwo") },
  { value: "migu", label: t("library.upgrade.sourceMigu") },
] as { value: SourceChoice; label: string }[];

const storedSource = localStorage.getItem("upgrade.platform") as SourceChoice | null;
const platform = ref<SourceChoice>(
  storedSource && (storedSource === "all" || ALL_PLATFORMS.includes(storedSource as Platform))
    ? storedSource
    : "all",
);
watch(platform, (v) => localStorage.setItem("upgrade.platform", v));

/** 目标档位 */
const target = ref<QualityLevel>(
  (localStorage.getItem("upgrade.target") as QualityLevel) ?? "lossless",
);
watch(target, (v) => localStorage.setItem("upgrade.target", v));

type ItemStatus = "matching" | "matched" | "none";

/** 单条升级候选 */
interface UpgradeItem {
  local: Track;
  status: ItemStatus;
  matched?: Track;
  checked: boolean;
  /** 因接口失败未完成（继续检测时重试） */
  failed?: boolean;
}

const phase = ref<"idle" | "scanning" | "done">("idle");
const items = ref<UpgradeItem[]>([]);
const scanned = ref(0);
const failedCount = ref(0);
/** 全部平台都被熔断停用（无可用音源） */
const aborted = ref(false);
let scanCanceled = false;

/** 本次扫描启用的平台 */
const activePlatforms = computed<Platform[]>(() =>
  platform.value === "all" ? [...ALL_PLATFORMS] : [platform.value],
);

/** 待跟进的升级任务 id（全部收尾后刷新曲库） */
const pendingIds = ref<string[]>([]);
/** 是否已入队（展示"进行中"横幅） */
const enqueued = ref(false);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 单平台请求状态：节奏门 + 连续失败计数 + 冷却截止时间
 * 各平台独立限流与熔断，单平台被风控不影响其余平台继续检测
 */
interface PlatformState {
  /** 上次发起请求时间（节奏门） */
  lastAt: number;
  /** 连续失败次数 */
  fails: number;
  /** 熔断触发次数 */
  trips: number;
  /** 冷却截止时间戳；0 表示可用 */
  cooldownUntil: number;
  /** 已彻底停用（熔断次数用尽） */
  disabled: boolean;
}

/** 每平台最小请求间隔（网易对连发最敏感，其余平台留出余量即可） */
const PACE_MS: Record<Platform, number> = {
  netease: 700,
  qqmusic: 400,
  kugou: 400,
  kuwo: 400,
  migu: 400,
};
/** 连续失败达到该值时进入冷却 */
const BREAK_THRESHOLD = 8;
/** 阶梯冷却时长 */
const BREAK_COOLDOWNS_MS = [10000, 30000, 60000];
/** 单曲搜索超时 */
const SEARCH_TIMEOUT_MS = 12000;

const platformStates: Record<Platform, PlatformState> = {
  netease: { lastAt: 0, fails: 0, trips: 0, cooldownUntil: 0, disabled: false },
  qqmusic: { lastAt: 0, fails: 0, trips: 0, cooldownUntil: 0, disabled: false },
  kugou: { lastAt: 0, fails: 0, trips: 0, cooldownUntil: 0, disabled: false },
  kuwo: { lastAt: 0, fails: 0, trips: 0, cooldownUntil: 0, disabled: false },
  migu: { lastAt: 0, fails: 0, trips: 0, cooldownUntil: 0, disabled: false },
};

/**
 * 等待指定平台的节奏门与冷却结束
 * @param platformKey - 平台
 * @param maxWaitMs - 最长等待（等待超出则本次跳过该平台，避免单平台冷却拖住整首歌）
 */
const awaitPlatform = async (platformKey: Platform, maxWaitMs = 3000): Promise<boolean> => {
  const state = platformStates[platformKey];
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (scanCanceled) return false;
    if (state.disabled) return false;
    const now = Date.now();
    if (now > deadline) return false;
    // 冷却中的平台直接跳过本首歌（不再等待冷却结束），避免单平台限流拖住整体进度
    if (state.cooldownUntil > now) return false;
    const wait = state.lastAt + PACE_MS[platformKey] - now;
    if (wait > 0) {
      await sleep(Math.min(wait, deadline - now));
      continue;
    }
    state.lastAt = Date.now();
    return true;
  }
};

/** 带超时的搜索 */
const searchWithTimeout = async (
  platformKey: Platform,
  keyword: string,
): Promise<Track[] | null> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      searchSongs(platformKey, keyword, 0, 10).then((res) => res.items),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** 记录一次成功 */
const markSuccess = (platformKey: Platform): void => {
  const state = platformStates[platformKey];
  state.fails = 0;
};

/** 记录一次失败；连续失败触发冷却，多次熔断后停用该平台 */
const markFailure = (platformKey: Platform): void => {
  const state = platformStates[platformKey];
  state.fails++;
  if (state.fails < BREAK_THRESHOLD) return;
  state.fails = 0;
  if (state.trips >= BREAK_COOLDOWNS_MS.length) {
    state.disabled = true;
    return;
  }
  const cooldown = BREAK_COOLDOWNS_MS[Math.min(state.trips, BREAK_COOLDOWNS_MS.length - 1)];
  state.cooldownUntil = Date.now() + cooldown;
  state.trips++;
};

/**
 * 多平台并发匹配同一首歌，取声明音质最高的一版
 *
 * 竞速采用策略：任一平台命中且声明音质已达目标档位即立即采用（不必等最慢的平台）；
 * 否则等全部返回后取声明音质最高的一版。平台顺序用于同档位时的稳定偏好。
 */
const matchAcrossPlatforms = async (
  local: Track,
): Promise<{ track: Track | null; allFailed: boolean }> => {
  const keyword = `${local.title} ${local.artists[0]?.name ?? ""}`.trim();
  const targetRank = qualityRank(target.value);
  const platforms = activePlatforms.value;
  const hits: Track[] = [];
  let failedCountLocal = 0;
  let settled = 0;
  let earlyAdopt: Track | null = null;
  let resolveRace: (() => void) | null = null;
  const racePromise = new Promise<void>((resolve) => {
    resolveRace = resolve;
  });

  const tasks = platforms.map(async (platformKey) => {
    try {
      if (platformStates[platformKey].disabled) {
        failedCountLocal++;
        return;
      }
      const ready = await awaitPlatform(platformKey);
      if (!ready) {
        // 熔断冷却中被跳过：不计失败（该平台本轮只是暂时不可用）
        return;
      }
      const list = await searchWithTimeout(platformKey, keyword);
      if (list === null) throw new Error("timeout");
      markSuccess(platformKey);
      const hit = findUpgradeMatch(local, list);
      if (hit) {
        hits.push(hit);
        if (qualityRank(getQualityLevel(hit.quality)) >= targetRank && !earlyAdopt) {
          earlyAdopt = hit;
          resolveRace?.();
        }
      }
    } catch {
      markFailure(platformKey);
      failedCountLocal++;
    } finally {
      settled++;
      if (settled >= platforms.length) resolveRace?.();
    }
  });

  await racePromise;
  if (!earlyAdopt) await Promise.all(tasks);
  if (scanCanceled) return { track: null, allFailed: false };
  if (earlyAdopt) return { track: earlyAdopt, allFailed: false };
  if (hits.length === 0) {
    return {
      track: null,
      allFailed: platforms.length > 0 && failedCountLocal === platforms.length,
    };
  }
  // 声明的可用音质越高越优先；同档位按到达顺序取稳定结果
  let best = hits[0];
  for (const hit of hits.slice(1)) {
    const bestRank = qualityRank(getQualityLevel(best.quality));
    const hitRank = qualityRank(getQualityLevel(hit.quality));
    if (hitRank > bestRank) best = hit;
  }
  return { track: best, allFailed: false };
};

/** 本轮检测的音源+目标档（变更后不能续检） */
const lastScanKey = ref("");
const unresolvedCount = computed(() => items.value.filter((i) => i.status === "matching").length);
const keyMatch = computed(() => lastScanKey.value === `${platform.value}:${target.value}`);
const canResume = computed(
  () =>
    phase.value === "done" && keyMatch.value && items.value.length > 0 && unresolvedCount.value > 0,
);
const scanButtonLabel = computed(() => {
  if (canResume.value) return t("library.upgrade.resume", { count: unresolvedCount.value });
  return phase.value === "done" ? t("library.upgrade.rescan") : t("library.upgrade.start");
});

/** 低于目标档位的候选（CUE 分轨与无法识别音质的文件跳过） */
const candidates = computed(() =>
  libraryStore.tracks.filter((track) => {
    if (track.source !== "local" || !track.path || track.cuePath) return false;
    if (!track.quality?.codec || track.quality.codec === "unknown") return false;
    return qualityRank(getQualityLevel(track.quality)) < qualityRank(target.value);
  }),
);

const matchedItems = computed(() => items.value.filter((item) => item.status === "matched"));
const noneCount = computed(() => items.value.filter((item) => item.status === "none").length);
const checkedCount = computed(() => matchedItems.value.filter((item) => item.checked).length);
const allChecked = computed(
  () => matchedItems.value.length > 0 && checkedCount.value === matchedItems.value.length,
);

const percent = computed(() =>
  candidates.value.length === 0 ? 100 : Math.round((scanned.value / candidates.value.length) * 100),
);

/** 开始检测：多平台并发 + 每平台独立节奏门/熔断；中止/停止后可续检（保留已完成结果） */
const startScan = async (resume = false): Promise<void> => {
  if (phase.value === "scanning") return;
  const key = `${platform.value}:${target.value}`;
  scanCanceled = false;
  aborted.value = false;
  phase.value = "scanning";
  failedCount.value = 0;
  enqueued.value = false;
  for (const platformKey of ALL_PLATFORMS) {
    platformStates[platformKey] = {
      lastAt: 0,
      fails: 0,
      trips: 0,
      cooldownUntil: 0,
      disabled: false,
    };
  }
  const list = candidates.value;
  if (resume && keyMatch.value && items.value.length > 0) {
    // 续检：已完成（matched / 非失败的 none）保留，未完成与失败项重扫
    const prev = new Map(items.value.map((item) => [item.local.path, item]));
    items.value = list.map((local) => {
      const old = prev.get(local.path);
      return old && old.status !== "matching" && !old.failed
        ? old
        : { local, status: "matching", checked: true };
    });
  } else {
    items.value = list.map((local) => ({ local, status: "matching", checked: true }));
  }
  scanned.value = items.value.filter((item) => item.status !== "matching").length;
  lastScanKey.value = key;
  if (list.length === 0) {
    phase.value = "done";
    return;
  }
  // 并发路数：每首歌内部已是多平台并发，外层固定 2 路避免瞬时请求洪峰
  const lanes = 2;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!scanCanceled) {
      const idx = next++;
      if (idx >= list.length) break;
      const item = items.value[idx];
      if (item.status !== "matching") continue;
      const { track, allFailed } = await matchAcrossPlatforms(item.local);
      if (scanCanceled) break;
      if (track) {
        item.matched = track;
        item.status = "matched";
        item.failed = false;
      } else {
        item.status = "none";
        item.failed = allFailed;
        if (allFailed) failedCount.value++;
      }
      scanned.value++;
      // 所有平台都被熔断停用：提前收尾
      if (ALL_PLATFORMS.every((platformKey) => platformStates[platformKey].disabled)) {
        scanCanceled = true;
        aborted.value = true;
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  if (aborted.value) toast.warning(t("library.upgrade.aborted"));
  phase.value = "done";
};

const stopScan = (): void => {
  scanCanceled = true;
  phase.value = "done";
};

const toggleAll = (): void => {
  const next = !allChecked.value;
  for (const item of matchedItems.value) item.checked = next;
};

/** 构建"落地原目录 + 成功后删原文件"的下载请求 */
const buildRequest = (item: UpgradeItem): DownloadRequest => {
  const download = useSettingsStore().system.download;
  const online = item.matched!;
  return {
    taskId: crypto.randomUUID(),
    track: online,
    qualityLevel: target.value,
    coverUrl: online.coverOriginal ?? online.cover,
    tagOptions: {
      embedCover: download.embedCover,
      embedMeta: download.embedMeta,
      embedLyric: download.embedLyric,
      writeLrc: download.writeLrc,
      saveTtml: download.saveTtml,
    },
    lyricFileFormat: download.lyricFileFormat,
    targetDir: pathDirName(item.local.path!),
    replaceSourcePath: item.local.path!,
  };
};

/** 入队升级下载 */
const startUpgrade = async (): Promise<void> => {
  const seen = new Set<string>();
  const requests: DownloadRequest[] = [];
  for (const item of matchedItems.value) {
    if (!item.checked || !item.matched) continue;
    const key = `${item.matched.source}:${item.matched.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push(buildRequest(item));
  }
  if (requests.length === 0) return;
  // IPC 结构化克隆无法处理 Vue 响应式 Proxy（匹配结果来自响应式数组），先深拷贝为纯对象
  const payload = JSON.parse(JSON.stringify(requests)) as DownloadRequest[];
  let results: EnqueueResult[];
  try {
    results = await window.api.download.startMany(payload);
  } catch {
    toast.error(t("library.upgrade.enqueueFailed"));
    return;
  }
  const okIds = payload.filter((_, idx) => results[idx]?.ok).map((req) => req.taskId);
  if (okIds.length === 0) {
    toast.warning(t("download.alreadyQueued"));
    return;
  }
  pendingIds.value = okIds;
  enqueued.value = true;
  toast.success(t("download.enqueued", { count: okIds.length }));
};

const isTerminal = (status: DownloadTask["status"]): boolean =>
  status !== "queued" && status !== "downloading";

/** 跟进升级任务：全部收尾后按成功数刷新曲库 */
watch(
  () => [downloadStore.activeTasks, downloadStore.historyTasks] as const,
  () => {
    if (pendingIds.value.length === 0) return;
    const byId = new Map(
      [...downloadStore.activeTasks, ...downloadStore.historyTasks].map((task) => [
        task.taskId,
        task,
      ]),
    );
    const finished = pendingIds.value.filter((id) => {
      const task = byId.get(id);
      return !task || isTerminal(task.status);
    });
    if (finished.length < pendingIds.value.length) return;
    const doneCount = pendingIds.value.filter((id) => byId.get(id)?.status === "done").length;
    const failedCount = pendingIds.value.length - doneCount;
    pendingIds.value = [];
    if (doneCount > 0) {
      toast.success(t("library.upgrade.doneToast", { count: doneCount }));
    }
    // 校验拒绝（音源质量不足/无效文件）也计入失败，明确告知原文件已保留
    if (failedCount > 0) {
      toast.warning(t("library.upgrade.failedToast", { count: failedCount }));
    }
    if (doneCount > 0) {
      void libraryStore.startScan(true);
    }
  },
);

watch(
  () => props.open,
  (open) => {
    if (open) return;
    // 关闭时中断未完成的检测
    if (phase.value === "scanning") stopScan();
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('library.upgrade.title')"
    :description="t('library.upgrade.description')"
    width="600px"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-3">
      <!-- 控制行 -->
      <div class="flex items-center gap-2">
        <div class="w-32 shrink-0">
          <SSelect v-model="target" :options="targetOptions" />
        </div>
        <div class="w-32 shrink-0">
          <SSelect v-model="platform" :options="sourceOptions" />
        </div>
        <SButton
          type="primary"
          variant="secondary"
          class="shrink-0"
          :disabled="phase === 'scanning' || libraryStore.tracks.length === 0"
          @click="startScan(canResume)"
        >
          {{ scanButtonLabel }}
        </SButton>
        <SButton v-if="canResume" variant="tertiary" class="shrink-0" @click="startScan(false)">
          {{ t("library.upgrade.rescan") }}
        </SButton>
        <SButton v-if="phase === 'scanning'" variant="tertiary" class="shrink-0" @click="stopScan">
          {{ t("library.upgrade.stop") }}
        </SButton>
      </div>
      <!-- 提示 -->
      <div class="text-xs text-on-surface-variant/50 leading-relaxed">
        {{ t("library.upgrade.hint") }}
      </div>
      <!-- 检测进度 -->
      <div
        v-if="phase === 'scanning'"
        class="flex items-center gap-2 text-sm text-on-surface-variant"
      >
        <SLoading class="size-3.5 text-primary shrink-0" />
        <span class="tabular-nums">
          {{ t("library.upgrade.scanning", { scanned, total: candidates.length }) }}
        </span>
        <span class="text-on-surface-variant/40 tabular-nums">{{ percent }}%</span>
      </div>
      <!-- 汇总 -->
      <div
        v-else-if="phase === 'done' && items.length > 0"
        class="flex items-center gap-3 text-xs text-on-surface-variant/60"
      >
        <span>{{ t("library.upgrade.matched", { count: matchedItems.length }) }}</span>
        <span>{{ t("library.upgrade.unmatched", { count: noneCount - failedCount }) }}</span>
        <span v-if="failedCount > 0" class="text-red-400">
          {{ t("library.upgrade.failed", { count: failedCount }) }}
        </span>
      </div>
      <!-- 入队横幅 -->
      <SAlert v-if="enqueued" type="success" :title="t('library.upgrade.enqueued')" />
      <!-- 结果列表 -->
      <div v-if="items.length > 0" class="max-h-72 overflow-y-auto flex flex-col gap-1 -mx-1 px-1">
        <div
          v-for="(item, idx) in items"
          :key="`${item.local.path}-${idx}`"
          class="flex items-center gap-2.5 p-2 rounded-lg"
          :class="item.status === 'matched' ? 'hover:bg-on-surface/5' : 'opacity-55'"
        >
          <SCheckbox
            v-if="item.status === 'matched'"
            :model-value="item.checked"
            class="shrink-0"
            @update:model-value="item.checked = !item.checked"
          />
          <SLoading
            v-else-if="item.status === 'matching'"
            class="size-4 shrink-0 text-on-surface-variant/40"
          />
          <div v-else class="w-4 shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm text-on-surface truncate" :title="item.local.path">
              {{ item.local.title }}
            </div>
            <div class="text-xs text-on-surface-variant/60 truncate">
              {{ item.local.artists.map((a) => a.name).join(" / ") }}
              <span class="opacity-50">
                · {{ pathExt(item.local.path!) }} · {{ formatFileSize(item.local.fileSize ?? 0) }}
              </span>
            </div>
          </div>
          <template v-if="item.status === 'matched'">
            <QualityTag :level="getQualityLevel(item.local.quality)" />
            <IconLucideArrowRight class="size-3 text-on-surface-variant/40 shrink-0" />
            <QualityTag :level="target" />
          </template>
          <span
            v-else-if="item.status === 'none'"
            class="text-xs text-on-surface-variant/50 shrink-0"
          >
            {{ t("library.upgrade.noMatch") }}
          </span>
        </div>
      </div>
      <!-- 空结果 -->
      <div v-else-if="phase === 'done'" class="py-6 text-center text-sm text-on-surface-variant/50">
        {{ t("library.upgrade.none") }}
      </div>
    </div>
    <template #footer="{ close }">
      <div class="flex items-center justify-between w-full">
        <SCheckbox
          v-if="matchedItems.length > 0"
          :model-value="allChecked"
          :label="t('library.upgrade.selectAll')"
          @update:model-value="toggleAll"
        />
        <span v-else />
        <div class="flex items-center gap-2">
          <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
          <SButton
            type="primary"
            :disabled="checkedCount === 0 || phase === 'scanning'"
            @click="startUpgrade"
          >
            {{ t("library.upgrade.upgradeBtn", { count: checkedCount }) }}
          </SButton>
        </div>
      </div>
    </template>
  </SDialog>
</template>
