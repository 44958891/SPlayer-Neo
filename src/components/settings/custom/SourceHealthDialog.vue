<script setup lang="ts">
/**
 * 音源体检弹窗
 *
 * 对每个已启用的音源插件，逐「平台源 × 代表档位」用固定测试曲真实取链并探针，
 * 报告可用性、实测体积与码率是否与声明档位相符，结论同时写入体检登记表
 * （取链编排会跳过硬失败组合）。
 *
 * 遍历放在渲染层：便于显示进度、随时取消；单点执行与落表在主进程。
 */
import type { PluginQuality, CheckPointResult, CheckSong } from "@shared/types/plugin";
import {
  CHECK_SONGS,
  SOURCE_LABELS,
  pickCheckQualities,
  summarizeChecks,
} from "@shared/utils/sourceCheck";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";
import IconLucideActivity from "~icons/lucide/activity";
import IconLucideBan from "~icons/lucide/ban";
import IconLucideCircleCheck from "~icons/lucide/check-circle-2";
import IconLucideCircleAlert from "~icons/lucide/alert-circle";
import IconLucideClock from "~icons/lucide/clock";
import IconLucideCircleHelp from "~icons/lucide/help-circle";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideSquare from "~icons/lucide/square";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const pluginsStore = usePluginsStore();
const { sourcePlugins } = storeToRefs(pluginsStore);

type Phase = "idle" | "running" | "done";

/** 待体检的一个点（插件 × 源 × 档位） */
interface CheckPoint {
  key: string;
  pluginId: string;
  pluginName: string;
  source: string;
  quality: PluginQuality;
  song: CheckSong;
  status: "pending" | "running" | "finished";
  result?: CheckPointResult;
}

const phase = ref<Phase>("idle");
const points = ref<CheckPoint[]>([]);
const currentLabel = ref("");
let canceled = false;

/** 已完成的点数 */
const doneCount = computed(() => points.value.filter((p) => p.status === "finished").length);
const percent = computed(() =>
  points.value.length === 0 ? 0 : Math.round((doneCount.value / points.value.length) * 100),
);
/** 已完成的结论汇总 */
const summary = computed(() =>
  summarizeChecks(points.value.flatMap((p) => (p.result ? [p.result] : []))),
);

/** 按插件分组的结果（报告展示用） */
const grouped = computed(() => {
  const map = new Map<string, { pluginName: string; items: CheckPoint[] }>();
  for (const point of points.value) {
    const group = map.get(point.pluginId) ?? { pluginName: point.pluginName, items: [] };
    group.items.push(point);
    map.set(point.pluginId, group);
  }
  return [...map.values()];
});

/** 构建体检点清单：每个启用插件 × 每个已声明源（有测试曲的）× 代表档位 */
const buildPoints = (): CheckPoint[] => {
  const out: CheckPoint[] = [];
  for (const info of sourcePlugins.value) {
    if (!info.enabled || info.status.state !== "ready") continue;
    const sources = info.status.sources ?? {};
    for (const [source, capability] of Object.entries(sources)) {
      if (!capability.actions.includes("musicUrl")) continue;
      const song = CHECK_SONGS[source];
      if (!song) continue;
      for (const quality of pickCheckQualities(capability.qualities ?? [])) {
        out.push({
          key: `${info.manifest.id}|${source}|${quality}`,
          pluginId: info.manifest.id,
          pluginName: info.manifest.name,
          source,
          quality,
          song,
          status: "pending",
        });
      }
    }
  }
  return out;
};

/** 开始体检（逐点串行：插件上游多为同一服务，并发会互相拖慢/触发风控） */
const start = async (): Promise<void> => {
  if (phase.value === "running") return;
  points.value = buildPoints();
  if (points.value.length === 0) {
    toast.warning(t("settings.plugins.check.empty"));
    return;
  }
  canceled = false;
  phase.value = "running";
  for (const point of points.value) {
    if (canceled) break;
    point.status = "running";
    currentLabel.value = `${point.pluginName} · ${SOURCE_LABELS[point.source] ?? point.source} · ${point.quality}`;
    try {
      // IPC 结构化克隆无法处理 Vue 响应式 Proxy（point 来自 ref 数组），先深拷贝为纯对象
      point.result = await window.api.plugins.checkSource(
        JSON.parse(
          JSON.stringify({
            pluginId: point.pluginId,
            source: point.source,
            quality: point.quality,
            song: point.song,
          }),
        ),
      );
    } catch (err) {
      point.result = {
        pluginId: point.pluginId,
        source: point.source,
        quality: point.quality,
        status: "hard",
        message: err instanceof Error ? err.message : String(err),
        sizeBytes: 0,
        probedBps: 0,
        linkMs: 0,
        probeMs: 0,
      };
    }
    point.status = "finished";
  }
  // 未跑到的点（取消时）从清单里剔除，避免报告里混入无结论项
  points.value = points.value.filter((p) => p.status === "finished");
  currentLabel.value = "";
  phase.value = "done";
  if (canceled) toast.info(t("settings.plugins.check.stopped"));
  else toast.success(t("settings.plugins.check.done", { count: points.value.length }));
};

/** 停止体检 */
const stop = (): void => {
  canceled = true;
};

/** 清空体检登记表（下次取链不再跳过已知硬失败组合） */
const clearRecords = async (): Promise<void> => {
  const removed = await window.api.plugins.healthClear();
  toast.success(t("settings.plugins.check.recordsCleared", { count: removed }));
};

/** 状态 → 图标 / 文案 / 配色 */
const statusMeta = (result: CheckPointResult | undefined) => {
  switch (result?.status) {
    case "ok":
      return { icon: IconLucideCircleCheck, cls: "text-green-500", key: "ok" };
    case "mismatch":
      return { icon: IconLucideCircleAlert, cls: "text-amber-500", key: "mismatch" };
    case "hard":
      return { icon: IconLucideBan, cls: "text-red-500", key: "hard" };
    case "soft":
      return { icon: IconLucideClock, cls: "text-sky-400", key: "soft" };
    case "unsupported":
      return { icon: IconLucideCircleHelp, cls: "text-on-surface-variant/50", key: "unsupported" };
    default:
      return { icon: IconLucideActivity, cls: "text-on-surface-variant/40", key: "running" };
  }
};

/** 体积 / 码率展示 */
const sizeLabel = (result: CheckPointResult | undefined): string => {
  if (!result || result.sizeBytes <= 0) return "";
  const mb = (result.sizeBytes / 1048576).toFixed(1);
  const kbps = result.probedBps > 0 ? Math.round(result.probedBps / 1000) : 0;
  return kbps > 0 ? `${mb} MB · ~${kbps} kbps` : `${mb} MB`;
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      // 打开时若插件还没加载完，先拉一次
      if (sourcePlugins.value.length === 0) void pluginsStore.load();
      return;
    }
    // 关闭时中断未完成的体检：弹窗组件不会销毁，不置位会一直在后台打请求
    if (phase.value === "running") {
      canceled = true;
      phase.value = "done";
      points.value = points.value.filter((p) => p.status === "finished");
      currentLabel.value = "";
    }
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('settings.plugins.check.title')"
    :description="t('settings.plugins.check.description')"
    width="620px"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-3">
      <!-- 操作行 -->
      <div class="flex items-center gap-2">
        <SButton
          type="primary"
          variant="secondary"
          class="shrink-0"
          :disabled="phase === 'running'"
          @click="start"
        >
          <template #icon><IconLucidePlay class="size-4" /></template>
          {{
            phase === "done" ? t("settings.plugins.check.again") : t("settings.plugins.check.start")
          }}
        </SButton>
        <SButton v-if="phase === 'running'" variant="tertiary" class="shrink-0" @click="stop">
          <template #icon><IconLucideSquare class="size-3.5" /></template>
          {{ t("settings.plugins.check.stop") }}
        </SButton>
        <SButton variant="tertiary" class="shrink-0" @click="clearRecords">
          <template #icon><IconLucideTrash2 class="size-3.5" /></template>
          {{ t("settings.plugins.check.clearRecords") }}
        </SButton>
      </div>

      <!-- 说明 -->
      <div class="text-xs text-on-surface-variant/50 leading-relaxed">
        {{ t("settings.plugins.check.hint") }}
      </div>

      <!-- 进度 -->
      <div
        v-if="phase === 'running'"
        class="flex items-center gap-2 text-sm text-on-surface-variant"
      >
        <SLoading class="size-3.5 text-primary shrink-0" />
        <span class="truncate">{{ currentLabel }}</span>
        <span class="ml-auto shrink-0 tabular-nums text-on-surface-variant/70">
          {{ doneCount }}/{{ points.length }} · {{ percent }}%
        </span>
      </div>

      <!-- 汇总 -->
      <div
        v-else-if="phase === 'done' && points.length > 0"
        class="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs"
      >
        <span class="text-green-500">
          {{ t("settings.plugins.check.summaryOk", { count: summary.ok }) }}
        </span>
        <span v-if="summary.mismatch > 0" class="text-amber-500">
          {{ t("settings.plugins.check.summaryMismatch", { count: summary.mismatch }) }}
        </span>
        <span v-if="summary.hard > 0" class="text-red-500">
          {{ t("settings.plugins.check.summaryHard", { count: summary.hard }) }}
        </span>
        <span v-if="summary.soft > 0" class="text-sky-400">
          {{ t("settings.plugins.check.summarySoft", { count: summary.soft }) }}
        </span>
        <span v-if="summary.unsupported > 0" class="text-on-surface-variant/50">
          {{ t("settings.plugins.check.summaryUnsupported", { count: summary.unsupported }) }}
        </span>
      </div>

      <!-- 结果（按插件分组） -->
      <div v-if="points.length > 0" class="max-h-80 overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
        <div v-for="group in grouped" :key="group.pluginName" class="flex flex-col gap-1">
          <div class="text-xs font-medium text-on-surface-variant/70 px-1">
            {{ group.pluginName }}
          </div>
          <div
            v-for="point in group.items"
            :key="point.key"
            class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-on-surface/5"
          >
            <component
              :is="statusMeta(point.result).icon"
              class="size-4 shrink-0"
              :class="statusMeta(point.result).cls"
            />
            <span class="text-sm text-on-surface shrink-0">
              {{ SOURCE_LABELS[point.source] ?? point.source }}
            </span>
            <STag size="small" round type="default" variant="soft">{{ point.quality }}</STag>
            <span class="text-xs text-on-surface-variant/60 truncate">
              {{
                statusMeta(point.result).key === "ok"
                  ? sizeLabel(point.result)
                  : point.result?.message
              }}
            </span>
            <span class="ml-auto shrink-0 text-[11px] text-on-surface-variant/40 tabular-nums">
              {{ point.result ? `${point.result.linkMs + point.result.probeMs}ms` : "" }}
            </span>
          </div>
        </div>
      </div>

      <!-- 空态 -->
      <div v-else-if="phase === 'idle'" class="py-6 text-center text-sm text-on-surface-variant/50">
        {{ t("settings.plugins.check.idle") }}
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
