<script setup lang="ts">
/**
 * 歌单备份：JSON 全量导出/导入 + 按歌单导出 m3u
 */
import type { Track } from "@shared/types/player";
import { usePlaylistStore } from "@/stores/playlist";
import { toast } from "@/composables/useToast";
import IconLucideDownload from "~icons/lucide/download";
import IconLucideUpload from "~icons/lucide/upload";
import IconLucideListMusic from "~icons/lucide/list-music";
import SButton from "@/components/ui/SButton.vue";
import SSelect from "@/components/ui/SSelect.vue";

const { t } = useI18n();
const playlistStore = usePlaylistStore();

const busy = ref(false);
const m3uPlaylistId = ref("");
const localPlaylists = computed(() => playlistStore.playlists);
const m3uOptions = computed(() =>
  localPlaylists.value.map((p) => ({ value: p.id, label: p.title })),
);

const dayStamp = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
};

/** 全量本地歌单（含完整曲目） */
const collectPlaylists = async (): Promise<
  { title: string; description?: string; tracks: Track[] }[]
> => {
  const out: { title: string; description?: string; tracks: Track[] }[] = [];
  for (const summary of localPlaylists.value) {
    const detail = await playlistStore.get(summary.id);
    if (detail) {
      out.push({ title: detail.title, description: detail.description, tracks: detail.tracks });
    }
  }
  return out;
};

const exportJson = async (): Promise<void> => {
  if (busy.value) return;
  busy.value = true;
  try {
    if (localPlaylists.value.length === 0) {
      toast.warning(t("settings.playlistBackup.emptyPlaylists"));
      return;
    }
    const playlists = await collectPlaylists();
    const backup = {
      app: "splayer-next",
      kind: "playlist-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      playlists,
    };
    const res = await window.api.system.saveFile(
      new TextEncoder().encode(JSON.stringify(backup, null, 2)).buffer as ArrayBuffer,
      `splayer-playlists-${dayStamp()}.json`,
    );
    if (res.success) toast.success(t("settings.playlistBackup.exported", { path: res.path ?? "" }));
    else if (res.error) toast.error(res.error);
  } finally {
    busy.value = false;
  }
};

const importJson = async (): Promise<void> => {
  if (busy.value) return;
  busy.value = true;
  try {
    const res = await window.api.system.openTextFile({
      name: "JSON",
      exts: ["json"],
    });
    if (!res.success || res.canceled || !res.content) return;
    const parsed = JSON.parse(res.content) as {
      playlists?: { title?: string; description?: string; tracks?: Track[] }[];
    };
    const playlists = Array.isArray(parsed.playlists) ? parsed.playlists : [];
    if (playlists.length === 0) {
      toast.warning(t("settings.playlistBackup.invalidFile"));
      return;
    }
    let createdCount = 0;
    let addedTotal = 0;
    const existing = new Set(localPlaylists.value.map((p) => p.title));
    for (const item of playlists) {
      const tracks = Array.isArray(item.tracks) ? item.tracks : [];
      if (!item.title || tracks.length === 0) continue;
      const title = existing.has(item.title)
        ? `${item.title} (${t("settings.playlistBackup.imported")})`
        : item.title;
      existing.add(title);
      const created = await playlistStore.create(title, item.description ?? undefined);
      const added = await playlistStore.addTracks(created.id, tracks);
      createdCount += 1;
      addedTotal += added;
    }
    if (createdCount > 0) {
      toast.success(
        t("settings.playlistBackup.importedSummary", {
          playlists: createdCount,
          tracks: addedTotal,
        }),
      );
    } else {
      toast.warning(t("settings.playlistBackup.invalidFile"));
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    busy.value = false;
  }
};

/** m3u8 导出：本地曲目写绝对路径，在线曲目写注释占位 */
const exportM3u = async (): Promise<void> => {
  if (busy.value || !m3uPlaylistId.value) return;
  busy.value = true;
  try {
    const detail = await playlistStore.get(m3uPlaylistId.value);
    if (!detail || detail.tracks.length === 0) {
      toast.warning(t("settings.playlistBackup.emptyPlaylists"));
      return;
    }
    const lines: string[] = ["#EXTM3U8"];
    let skipped = 0;
    for (const track of detail.tracks) {
      const seconds = Math.round((track.duration ?? 0) / 1000);
      const artist = track.artists.map((a) => a.name).join("/");
      lines.push(`#EXTINF:${seconds},${artist} - ${track.title}`);
      if (track.path) {
        lines.push(track.path);
      } else {
        lines.push(`#SPLAYER-NETEASE-TRACK:${track.id}`);
        skipped += 1;
      }
    }
    const safeName = `${detail.title.replace(/[\\/:*?"<>|]/g, " ").trim() || "playlist"}.m3u8`;
    const res = await window.api.system.saveFile(
      new TextEncoder().encode(`${lines.join("\n")}\n`).buffer as ArrayBuffer,
      safeName,
    );
    if (res.success) {
      toast.success(
        skipped > 0
          ? t("settings.playlistBackup.m3uExportedSkipped", { path: res.path ?? "", skipped })
          : t("settings.playlistBackup.exported", { path: res.path ?? "" }),
      );
    } else if (res.error) {
      toast.error(res.error);
    }
  } finally {
    busy.value = false;
  }
};

const m3uModel = computed({
  get: () => m3uPlaylistId.value,
  set: (value: string) => {
    m3uPlaylistId.value = value;
  },
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2 flex-wrap">
      <SButton variant="secondary" :disabled="busy" @click="exportJson">
        <template #icon><IconLucideDownload class="size-4" /></template>
        {{ t("settings.playlistBackup.exportJson") }}
      </SButton>
      <SButton variant="secondary" :disabled="busy" @click="importJson">
        <template #icon><IconLucideUpload class="size-4" /></template>
        {{ t("settings.playlistBackup.importJson") }}
      </SButton>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <SSelect
        v-model="m3uModel"
        :options="m3uOptions"
        :placeholder="t('settings.playlistBackup.pickPlaylist')"
        :disabled="busy || m3uOptions.length === 0"
        class="w-60"
      />
      <SButton variant="secondary" :disabled="busy || !m3uPlaylistId" @click="exportM3u">
        <template #icon><IconLucideListMusic class="size-4" /></template>
        {{ t("settings.playlistBackup.exportM3u") }}
      </SButton>
    </div>
    <p class="text-xs text-on-surface-variant/50 leading-relaxed">
      {{ t("settings.playlistBackup.description") }}
    </p>
  </div>
</template>
