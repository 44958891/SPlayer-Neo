<script setup lang="ts">
/**
 * 歌单导入弹窗：粘贴平台歌单分享链接（或纯 ID），拉取曲目并落到本地歌单
 *
 * 支持多行批量：每行一个链接，逐个导入；单行失败不影响后续行。
 */
import type { Platform } from "@shared/types/platform";
import { parseWithShortLink, fetchRemotePlaylist } from "@/apis/playlistImport";
import { usePlaylistStore } from "@/stores/playlist";
import { toast } from "@/composables/useToast";
import SDialog from "@/components/ui/SDialog.vue";
import SButton from "@/components/ui/SButton.vue";
import SSelect from "@/components/ui/SSelect.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 至少导入成功一个歌单：携带第一个新歌单 id */
  imported: [playlistId: string];
}>();

const { t } = useI18n();
const playlistStore = usePlaylistStore();

const PLATFORM_OPTIONS = [
  { value: "netease", label: "网易云" },
  { value: "qqmusic", label: "QQ音乐" },
  { value: "kugou", label: "酷狗" },
  { value: "kuwo", label: "酷我" },
  { value: "migu", label: "咪咕" },
];

const links = ref("");
/** 纯 ID（无域名特征）时的平台归属 */
const fallbackPlatform = ref<Platform>("netease");
const importing = ref(false);
/** 第一个导入成功的歌单 id，用于导入完成后跳转 */
const firstImportedId = ref<string | null>(null);

interface LineState {
  input: string;
  status: "pending" | "running" | "done" | "failed";
  message: string;
}
const lines = ref<LineState[]>([]);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    links.value = "";
    lines.value = [];
    importing.value = false;
    firstImportedId.value = null;
    fallbackPlatform.value = "netease";
  },
);

const canImport = computed(() => !importing.value && links.value.trim().length > 0);

/** 导入单行：解析 → 拉取 → 建歌单 → 追加曲目 */
const importOne = async (state: LineState): Promise<void> => {
  state.status = "running";
  try {
    const parsed = await parseWithShortLink(state.input, fallbackPlatform.value);
    if (!parsed) {
      state.status = "failed";
      state.message = t("playlist.import.errorParse");
      return;
    }
    const { playlist, tracks } = await fetchRemotePlaylist(parsed);
    if (tracks.length === 0) {
      state.status = "failed";
      state.message = t("playlist.import.errorEmpty");
      return;
    }
    const title = playlist.name || t("playlist.import.defaultTitle");
    const created = await playlistStore.create(title, playlist.description ?? undefined);
    const added = await playlistStore.addTracks(created.id, tracks);
    state.status = "done";
    state.message = t("playlist.import.doneLine", { count: added });
    if (!firstImportedId.value) firstImportedId.value = created.id;
  } catch (error) {
    state.status = "failed";
    state.message =
      error instanceof Error ? error.message.slice(0, 80) : String(error).slice(0, 80);
  }
};

const startImport = async (): Promise<void> => {
  const inputs = links.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (inputs.length === 0) return;
  importing.value = true;
  lines.value = inputs.map((input) => ({ input, status: "pending", message: "" }));
  for (const state of lines.value) {
    if (!importing.value) break;
    await importOne(state);
  }
  importing.value = false;
  const ok = lines.value.filter((l) => l.status === "done").length;
  const failed = lines.value.filter((l) => l.status === "failed").length;
  if (ok > 0 && failed === 0) toast.success(t("playlist.import.toastOk", { count: ok }));
  else if (ok > 0) toast.warning(t("playlist.import.toastPartial", { ok, failed }));
  else toast.error(t("playlist.import.toastFail"));
  if (ok > 0 && firstImportedId.value) emit("imported", firstImportedId.value);
};

const platformModel = computed({
  get: () => fallbackPlatform.value,
  set: (value: string) => {
    fallbackPlatform.value = value as Platform;
  },
});

const close = (): void => {
  if (importing.value) return;
  emit("update:open", false);
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('playlist.import.title')"
    width="560px"
    @update:open="(value) => emit('update:open', value)"
  >
    <div class="flex flex-col gap-3">
      <p class="text-xs text-on-surface-variant/70 leading-relaxed">
        {{ t("playlist.import.description") }}
      </p>
      <textarea
        v-model="links"
        rows="4"
        :placeholder="t('playlist.import.placeholder')"
        :disabled="importing"
        class="w-full rounded-lg border border-solid border-outline-variant/40 bg-transparent text-on-surface px-3 py-2 text-sm outline-none resize-none focus:border-primary/60 disabled:opacity-50"
      />
      <div class="flex items-center gap-2">
        <span class="text-xs text-on-surface-variant/60 shrink-0">
          {{ t("playlist.import.fallbackPlatform") }}
        </span>
        <SSelect
          v-model="platformModel"
          :options="PLATFORM_OPTIONS"
          :disabled="importing"
          class="flex-1"
        />
      </div>
      <div
        v-if="lines.length > 0"
        class="max-h-40 overflow-y-auto rounded-lg bg-on-surface/4 flex flex-col gap-1 p-2"
      >
        <div v-for="(line, index) in lines" :key="index" class="flex items-center gap-2 text-xs">
          <IconLucideLoader
            v-if="line.status === 'running'"
            class="size-3.5 shrink-0 text-primary animate-spin"
          />
          <span
            v-else
            class="size-2 shrink-0 rounded-full"
            :class="
              line.status === 'done'
                ? 'bg-green-500'
                : line.status === 'failed'
                  ? 'bg-red-500'
                  : 'bg-on-surface-variant/40'
            "
          />
          <span class="truncate text-on-surface-variant" :title="line.input">
            {{ line.input.slice(0, 60) }}
          </span>
          <span
            class="ml-auto shrink-0 truncate max-w-50%"
            :class="
              line.status === 'failed'
                ? 'text-red-500'
                : line.status === 'done'
                  ? 'text-green-600'
                  : 'text-on-surface-variant/50'
            "
            :title="line.message"
          >
            {{ line.message }}
          </span>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <SButton variant="secondary" :disabled="importing" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="primary" :disabled="!canImport" :loading="importing" @click="startImport">
          {{ importing ? t("playlist.import.importing") : t("playlist.import.start") }}
        </SButton>
      </div>
    </template>
  </SDialog>
</template>
