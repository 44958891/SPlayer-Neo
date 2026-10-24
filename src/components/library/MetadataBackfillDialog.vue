<script setup lang="ts">
/**
 * 本地音乐封面/歌词补全
 *
 * 扫描曲库中缺内嵌封面或内嵌歌词的本地文件，按标题/歌手/时长在多平台匹配在线同名曲，
 * 取封面与歌词写回文件标签（只补缺失项，不覆盖已有内容）。
 *
 * 与音质升级的区别：不重新下载音频，只补元数据，因此更快也无损；
 * 平台限流沿用升级弹窗的节奏门/熔断策略。
 */
import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { TagBatchEntry } from "@shared/types/library";
import { ALL_PLATFORMS } from "@shared/types/platform";
import { searchSongs } from "@/apis/search";
import { useLibraryStore } from "@/stores/library";
import * as player from "@/core/player";
import { rankUpgradeCandidates } from "@/utils/qualityUpgrade";
import {
  buildBackfillEdit,
  emptySummary,
  hasAnyNeed,
  pickBackfillNeeds,
  type BackfillNeeds,
  type BackfillSummary,
} from "@/utils/backfill";
import {
  allGatesDisabled,
  awaitGate,
  createGates,
  gateFailure,
  gateSkip,
  gateSuccess,
  resetGates,
} from "@/utils/platformGate";
import { buildDownloadLyric } from "@/utils/lyric/serialize";
import { toast } from "@/composables/useToast";
import IconLucideImage from "~icons/lucide/image";
import IconLucideFileText from "~icons/lucide/file-text";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideSquare from "~icons/lucide/square";
import IconLucideCircleCheck from "~icons/lucide/check-circle-2";
import IconLucideCircleAlert from "~icons/lucide/alert-circle";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const libraryStore = useLibraryStore();

type Phase = "idle" | "scanning" | "matching" | "writing" | "done";

/** 单条待补曲目 */
interface BackfillItem {
  local: Track;
  needs: BackfillNeeds;
  status: "pending" | "matching" | "matched" | "written" | "none" | "failed";
  checked: boolean;
  /** 匹配到的封面 URL */
  coverUrl?: string;
  /** 匹配到的歌词文本 */
  lyricText?: string;
  /** 成败说明 */
  note?: string;
}

const phase = ref<Phase>("idle");
const items = ref<BackfillItem[]>([]);
const currentLabel = ref("");
const summary = ref<BackfillSummary>(emptySummary());
let canceled = false;

/** 音源选择：单平台或全部平台并发（与升级弹窗同源记忆） */
type SourceChoice = Platform | "all";
const sourceOptions = [
  { value: "all", label: t("library.upgrade.sourceAll") },
  { value: "netease", label: t("library.upgrade.sourceNetease") },
  { value: "qqmusic", label: t("library.upgrade.sourceQq") },
  { value: "kugou", label: t("library.upgrade.sourceKugou") },
  { value: "kuwo", label: t("library.upgrade.sourceKuwo") },
  { value: "migu", label: t("library.upgrade.sourceMigu") },
] as { value: SourceChoice; label: string }[];

const storedSource = localStorage.getItem("backfill.platform") as SourceChoice | null;
const platform = ref<SourceChoice>(
  storedSource && (storedSource === "all" || ALL_PLATFORMS.includes(storedSource as Platform))
    ? storedSource
    : "all",
);
watch(platform, (v) => localStorage.setItem("backfill.platform", v));

/** 补哪几类（默认都补） */
const wantCover = ref(localStorage.getItem("backfill.cover") !== "0");
const wantLyric = ref(localStorage.getItem("backfill.lyric") !== "0");
watch(wantCover, (v) => localStorage.setItem("backfill.cover", v ? "1" : "0"));
watch(wantLyric, (v) => localStorage.setItem("backfill.lyric", v ? "1" : "0"));

const activePlatforms = computed<Platform[]>(() =>
  platform.value === "all" ? [...ALL_PLATFORMS] : [platform.value],
);

/** 各平台节奏门与熔断 */
const gates = createGates(ALL_PLATFORMS);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 已匹配到可写内容的项 */
const matchedItems = computed(() => items.value.filter((item) => item.status === "matched"));
const writtenCount = computed(() => items.value.filter((item) => item.status === "written").length);
const failedCount = computed(() => items.value.filter((item) => item.status === "failed").length);
const noneCount = computed(() => items.value.filter((item) => item.status === "none").length);

/** 进度 */
const processed = computed(
  () =>
    items.value.filter((item) => item.status !== "pending" && item.status !== "matching").length,
);
const percent = computed(() =>
  items.value.length === 0 ? 0 : Math.round((processed.value / items.value.length) * 100),
);
const currentText = computed(() => {
  if (phase.value === "scanning") return t("library.backfill.phaseScan");
  if (phase.value === "matching")
    return t("library.backfill.phaseMatch", { current: currentLabel.value });
  if (phase.value === "writing") return t("library.backfill.phaseWrite");
  return "";
});

/** 单平台搜索（带节奏门 + 超时） */
const searchOnPlatform = async (platformKey: Platform, keyword: string): Promise<Track[]> => {
  const ready = await awaitGate(gates, platformKey, () => canceled);
  if (!ready) {
    gateSkip(gates, platformKey);
    return [];
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const res = await Promise.race([
      searchSongs(platformKey, keyword, 0, 10),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 12_000);
      }),
    ]);
    if (!res) throw new Error("timeout");
    gateSuccess(gates, platformKey);
    return res.items;
  } catch {
    gateFailure(gates, platformKey);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** 多平台并发匹配同名曲，取打分最高者 */
const matchTrack = async (local: Track): Promise<Track | null> => {
  const keyword = `${local.title} ${local.artists[0]?.name ?? ""}`.trim();
  if (!keyword) return null;
  const results = await Promise.all(
    activePlatforms.value.map((platformKey) => searchOnPlatform(platformKey, keyword)),
  );
  const candidates = results.flat();
  if (candidates.length === 0) return null;
  return rankUpgradeCandidates(local, candidates)[0]?.online ?? null;
};

/** 拉取该平台歌词并序列化为 LRC */
const fetchLyricText = async (online: Track): Promise<string | undefined> => {
  const lookupId = online.source === "qqmusic" ? (online.extId ?? online.id) : online.id;
  try {
    const resp = await window.api.lyrics.matchById(online.source as Platform, lookupId);
    if (!resp.ok || !resp.data?.content) return undefined;
    const text = buildDownloadLyric(
      {
        content: resp.data.content,
        translation: resp.data.translation,
        translationFormat: resp.data.translationFormat,
        romaji: resp.data.romaji,
        romajiFormat: resp.data.romajiFormat,
      },
      resp.data.format,
      "lrc",
    );
    return text ?? undefined;
  } catch {
    return undefined;
  }
};

/** 第一步：读库内本地曲目的标签，筛出缺封面/歌词的项 */
const start = async (): Promise<void> => {
  if (phase.value !== "idle" && phase.value !== "done") return;
  canceled = false;
  summary.value = emptySummary();
  items.value = [];
  phase.value = "scanning";

  const candidates = libraryStore.tracks.filter(
    (track) => track.source === "local" && track.path && !track.cuePath,
  );
  if (candidates.length === 0) {
    toast.warning(t("library.backfill.emptyLibrary"));
    phase.value = "idle";
    return;
  }

  const resp = await window.api.library.readTagsBatch(candidates.map((track) => track.path!));
  if (!resp.success || !resp.data) {
    toast.error(t("library.backfill.readFailed"));
    phase.value = "idle";
    return;
  }
  const byPath = new Map<string, TagBatchEntry>(resp.data.map((entry) => [entry.path, entry]));
  const pendingItems: BackfillItem[] = [];
  for (const track of candidates) {
    const entry = byPath.get(track.path!);
    // 读取失败的项跳过：无法确认是否缺，误判会导致无谓覆盖
    if (!entry?.ok) continue;
    const needs = pickBackfillNeeds({
      hasCover: entry.hasCover,
      lyricLength: entry.lyricLength,
    });
    const wanted: BackfillNeeds = {
      cover: needs.cover && wantCover.value,
      lyric: needs.lyric && wantLyric.value,
    };
    if (!hasAnyNeed(wanted)) continue;
    pendingItems.push({ local: track, needs: wanted, status: "pending", checked: true });
  }
  items.value = pendingItems;
  summary.value.total = pendingItems.length;
  summary.value.needCover = pendingItems.filter((item) => item.needs.cover).length;
  summary.value.needLyric = pendingItems.filter((item) => item.needs.lyric).length;
  if (pendingItems.length === 0) {
    toast.success(t("library.backfill.nothingMissing"));
    phase.value = "done";
    return;
  }

  // 第二步：逐首多平台匹配（并发 2 路，避免瞬时请求洪峰）
  resetGates(gates, ALL_PLATFORMS);
  phase.value = "matching";
  let next2 = 0;
  const worker = async (): Promise<void> => {
    while (!canceled) {
      const index = next2++;
      if (index >= pendingItems.length) break;
      const item = pendingItems[index];
      item.status = "matching";
      currentLabel.value = `${item.local.title} - ${item.local.artists.map((a) => a.name).join("/")}`;
      try {
        const online = await matchTrack(item.local);
        if (!online) {
          item.status = "none";
        } else {
          if (item.needs.cover) {
            item.coverUrl = online.coverOriginal ?? online.cover;
          }
          if (item.needs.lyric) {
            item.lyricText = await fetchLyricText(online);
          }
          const writable =
            (item.needs.cover && item.coverUrl) || (item.needs.lyric && item.lyricText);
          item.status = writable ? "matched" : "none";
        }
      } catch {
        item.status = "none";
      }
      if (allGatesDisabled(gates, activePlatforms.value)) {
        canceled = true;
        toast.warning(t("library.backfill.aborted"));
      }
    }
  };
  await Promise.all([worker(), worker()]);
  currentLabel.value = "";
  summary.value.matched = items.value.filter((item) => item.status === "matched").length;
  summary.value.unmatched = noneCount.value;
  // 没有可写项时直接收尾
  if (summary.value.matched === 0) {
    phase.value = "done";
    toast.info(t("library.backfill.noneMatched"));
    return;
  }
  await writeBack();
};

/** 第三步：批量写回标签（每批 20 首，失败不中断） */
const writeBack = async (): Promise<void> => {
  const pending = items.value.filter((item) => item.status === "matched");
  if (pending.length === 0) return;
  phase.value = "writing";
  const BATCH = 20;
  for (let start = 0; start < pending.length; start += BATCH) {
    if (canceled) break;
    const slice = pending.slice(start, start + BATCH);
    const edits = slice
      .map((item) =>
        buildBackfillEdit(item.local, item.needs, {
          coverUrl: item.coverUrl,
          lyricText: item.lyricText,
        }),
      )
      .filter((edit): edit is NonNullable<typeof edit> => edit !== null);
    if (edits.length === 0) continue;
    // IPC 结构化克隆：编辑项来自响应式数组，先深拷贝为纯对象
    const payload = JSON.parse(JSON.stringify(edits));
    // 必须走 player.saveTrackTags 而非裸 writeTags：它负责
    // ① 目标含当前播放曲时先停播释放文件句柄、写后重载并恢复进度
    // ② 写入成功后同步 media store / 播放队列 / 曲库列表
    // 裸调 writeTags 会跳过这些，播放中写标签可能失败或让播放器状态与磁盘不一致
    const outcomes = await player.saveTrackTags(payload);
    if (!outcomes) {
      for (const item of slice) {
        item.status = "failed";
        item.note = t("library.backfill.writeFailed");
      }
      summary.value.failed += slice.length;
      continue;
    }
    outcomes.forEach((outcome, index) => {
      const item = slice[index];
      if (!item) return;
      if (outcome.success) {
        item.status = "written";
        summary.value.written++;
      } else {
        item.status = "failed";
        item.note = outcome.error ?? t("library.backfill.writeFailed");
        summary.value.failed++;
      }
    });
    await sleep(50);
  }
  phase.value = "done";
  const refreshed = items.value.filter((item) => item.status === "written");
  if (refreshed.length > 0) {
    toast.success(t("library.backfill.doneToast", { count: refreshed.length }));
    // 封面变化需重新扫描生成缩略图；增量扫描只处理 mtime 变过的文件
    libraryStore.startScan(true);
  } else {
    toast.warning(t("library.backfill.failedToast", { count: summary.value.failed }));
  }
};

/** 停止 */
const stop = (): void => {
  canceled = true;
};

/** 全选 / 反选 */
const allChecked = computed(
  () => matchedItems.value.length > 0 && matchedItems.value.every((item) => item.checked),
);
const toggleAll = (): void => {
  const next = !allChecked.value;
  for (const item of matchedItems.value) item.checked = next;
};
const checkedCount = computed(() => matchedItems.value.filter((item) => item.checked).length);

/** 只写勾选项 */
const writeChecked = async (): Promise<void> => {
  for (const item of items.value) {
    if (item.status === "matched" && !item.checked) item.status = "none";
  }
  await writeBack();
};

watch(
  () => props.open,
  (open) => {
    if (!open && (phase.value === "matching" || phase.value === "scanning")) {
      // 关闭即停：组件不销毁，不置位会继续在后台打请求
      canceled = true;
      phase.value = "done";
      currentLabel.value = "";
    }
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('library.backfill.title')"
    :description="t('library.backfill.description')"
    width="620px"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-3">
      <!-- 控制行 -->
      <div class="flex items-center gap-2 flex-wrap">
        <div class="w-32 shrink-0">
          <SSelect v-model="platform" :options="sourceOptions" />
        </div>
        <SCheckbox v-model="wantCover" :label="t('library.backfill.optCover')" />
        <SCheckbox v-model="wantLyric" :label="t('library.backfill.optLyric')" />
        <SButton
          type="primary"
          variant="secondary"
          class="shrink-0 ml-auto"
          :disabled="phase !== 'idle' && phase !== 'done'"
          @click="start"
        >
          <template #icon><IconLucidePlay class="size-4" /></template>
          {{ phase === "done" ? t("library.backfill.again") : t("library.backfill.start") }}
        </SButton>
        <SButton
          v-if="phase === 'scanning' || phase === 'matching' || phase === 'writing'"
          variant="tertiary"
          class="shrink-0"
          @click="stop"
        >
          <template #icon><IconLucideSquare class="size-3.5" /></template>
          {{ t("library.backfill.stop") }}
        </SButton>
      </div>

      <!-- 说明 -->
      <div class="text-xs text-on-surface-variant/50 leading-relaxed">
        {{ t("library.backfill.hint") }}
      </div>

      <!-- 进度 -->
      <div
        v-if="phase === 'scanning' || phase === 'matching' || phase === 'writing'"
        class="flex items-center gap-2 text-sm text-on-surface-variant"
      >
        <SLoading class="size-3.5 text-primary shrink-0" />
        <span class="truncate">{{ currentText }}</span>
        <span class="ml-auto shrink-0 tabular-nums text-on-surface-variant/70">
          {{ processed }}/{{ items.length }} · {{ percent }}%
        </span>
      </div>

      <!-- 汇总 -->
      <div
        v-else-if="phase === 'done' && items.length > 0"
        class="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs"
      >
        <span class="text-on-surface-variant/70">
          {{ t("library.backfill.summaryTotal", { count: summary.total }) }}
        </span>
        <span class="text-green-500">
          {{ t("library.backfill.summaryWritten", { count: writtenCount }) }}
        </span>
        <span v-if="noneCount > 0" class="text-on-surface-variant/50">
          {{ t("library.backfill.summaryNone", { count: noneCount }) }}
        </span>
        <span v-if="failedCount > 0" class="text-red-500">
          {{ t("library.backfill.summaryFailed", { count: failedCount }) }}
        </span>
      </div>

      <!-- 结果列表 -->
      <div v-if="items.length > 0" class="max-h-72 overflow-y-auto flex flex-col gap-1 -mx-1 px-1">
        <div
          v-for="(item, idx) in items"
          :key="`${item.local.path}-${idx}`"
          class="flex items-center gap-2.5 p-2 rounded-lg"
          :class="item.status === 'matched' ? 'hover:bg-on-surface/5' : ''"
        >
          <SCheckbox
            v-if="item.status === 'matched'"
            :model-value="item.checked"
            class="shrink-0"
            @update:model-value="item.checked = !item.checked"
          />
          <IconLucideCircleCheck
            v-else-if="item.status === 'written'"
            class="size-4 shrink-0 text-green-500"
          />
          <IconLucideCircleAlert
            v-else-if="item.status === 'failed'"
            class="size-4 shrink-0 text-red-500"
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
              <span v-if="item.note" class="text-red-400">· {{ item.note }}</span>
            </div>
          </div>
          <!-- 缺什么 / 补什么 -->
          <STag v-if="item.needs.cover" size="small" round type="default" variant="soft">
            <template #icon><IconLucideImage class="size-3" /></template>
            {{ t("library.backfill.tagCover") }}
          </STag>
          <STag v-if="item.needs.lyric" size="small" round type="default" variant="soft">
            <template #icon><IconLucideFileText class="size-3" /></template>
            {{ t("library.backfill.tagLyric") }}
          </STag>
          <span v-if="item.status === 'none'" class="text-xs text-on-surface-variant/50 shrink-0">
            {{ t("library.backfill.noMatch") }}
          </span>
        </div>
      </div>

      <!-- 空态 -->
      <div v-else-if="phase === 'idle'" class="py-6 text-center text-sm text-on-surface-variant/50">
        {{ t("library.backfill.idle") }}
      </div>
      <div v-else-if="phase === 'done'" class="py-6 text-center text-sm text-on-surface-variant/50">
        {{ t("library.backfill.nothingMissing") }}
      </div>
    </div>
    <template #footer="{ close }">
      <div class="flex items-center justify-between w-full">
        <SCheckbox
          v-if="matchedItems.length > 0 && phase !== 'writing'"
          :model-value="allChecked"
          :label="t('library.backfill.selectAll')"
          @update:model-value="toggleAll"
        />
        <span v-else />
        <div class="flex items-center gap-2">
          <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
          <SButton
            type="primary"
            :disabled="checkedCount === 0 || phase === 'writing'"
            @click="writeChecked"
          >
            {{ t("library.backfill.writeBtn", { count: checkedCount }) }}
          </SButton>
        </div>
      </div>
    </template>
  </SDialog>
</template>
