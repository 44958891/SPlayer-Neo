import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadRequest } from "@shared/types/download";
import type { Track } from "@shared/types/player";
import i18n from "@/i18n";
import QualityUpgradeDialog from "./QualityUpgradeDialog.vue";

const mocks = vi.hoisted(() => ({
  searchSongs: vi.fn(),
  tracks: [] as Track[],
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@/apis/search", () => ({ searchSongs: mocks.searchSongs }));
vi.mock("@/stores/library", () => ({
  useLibraryStore: () => ({ tracks: mocks.tracks, startScan: vi.fn() }),
}));
vi.mock("@/stores/download", () => ({
  useDownloadStore: () => ({ activeTasks: [], historyTasks: [] }),
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ system: { download: {} } }),
}));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

/** 挂载实际升级弹窗，用原生控件替身观察禁用状态与用户选择 */
const mountDialog = () =>
  mount(QualityUpgradeDialog, {
    props: { open: true },
    global: {
      plugins: [i18n],
      stubs: {
        SDialog: { template: '<div><slot /><slot name="footer" :close="() => {}" /></div>' },
        SSelect: {
          props: ["modelValue", "options", "disabled"],
          emits: ["update:modelValue"],
          template:
            '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option></select>',
        },
        SButton: {
          props: ["disabled"],
          emits: ["click"],
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        SCheckbox: true,
        SLoading: true,
        SAlert: true,
      },
    },
  });

beforeEach(() => {
  localStorage.clear();
  i18n.global.locale.value = "zh-CN";
  mocks.searchSongs.mockReset().mockResolvedValue([]);
  mocks.tracks.splice(0, mocks.tracks.length, {
    id: "local",
    title: "歌曲",
    artists: [{ id: "artist", name: "歌手" }],
    source: "local",
    duration: 200000,
    path: "D:/Music/test.mp3",
    quality: {
      codec: "mp3",
      sampleRate: 44100,
      bitsPerSample: 16,
      channels: 2,
      bitRate: 128000,
    },
  });
});

describe("音质升级平台缺档", () => {
  it.each([
    ["kuwo", "hi-res"],
    ["migu", "jymaster"],
  ])("%s 不支持 %s 时保留目标、禁止扫描并明确提示", async (platform, target) => {
    localStorage.setItem("upgrade.platform", platform);
    localStorage.setItem("upgrade.target", target);
    const wrapper = mountDialog();
    const targetSelect = wrapper.findAll("select")[0];
    expect(targetSelect.element.value).toBe(target);
    expect(targetSelect.find(`option[value="${target}"]`).attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("当前平台不支持所选音质目标");
    const scan = wrapper.findAll("button").find((button) => button.text() === "开始检测")!;
    expect(scan.attributes("disabled")).toBeDefined();
    await scan.trigger("click");
    expect(mocks.searchSongs).not.toHaveBeenCalled();
    expect(localStorage.getItem("upgrade.target")).toBe(target);
    await targetSelect.setValue("lossless");
    expect(scan.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("酷狗母带升级入队按平台 Hi-Res 规格传下限，仍保留母带目标", async () => {
    localStorage.setItem("upgrade.platform", "kugou");
    localStorage.setItem("upgrade.target", "jymaster");
    mocks.searchSongs.mockResolvedValue({
      items: [{ ...mocks.tracks[0], id: "kg-online", source: "kugou", path: undefined }],
      total: 1,
      hasMore: false,
    });
    const startMany = vi.fn(async (_requests: DownloadRequest[]) => [{ ok: true }]);
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { download: { startMany } },
    });
    const wrapper = mountDialog();
    const scan = wrapper.findAll("button").find((button) => button.text() === "开始检测")!;
    await scan.trigger("click");
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.text()).toContain("酷狗 · 蝰蛇超清"));
    const upgrade = wrapper
      .findAll("button")
      .find(
        (button) => button.text() === i18n.global.t("library.upgrade.upgradeBtn", { count: 1 }),
      )!;
    await upgrade.trigger("click");
    await flushPromises();
    expect(startMany).toHaveBeenCalledOnce();
    expect(startMany.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        track: expect.objectContaining({ source: "kugou", id: "kg-online" }),
        qualitySelection: "kugou:kugou-master",
        qualityLevel: "jymaster",
        minLevel: "hi-res",
        replaceSourcePath: "D:/Music/test.mp3",
      }),
    ]);
    wrapper.unmount();
  });

  it("全部平台扫描母带时跳过未提供母带档的咪咕", async () => {
    localStorage.setItem("upgrade.platform", "all");
    localStorage.setItem("upgrade.target", "jymaster");
    const wrapper = mountDialog();
    const scan = wrapper.findAll("button").find((button) => button.text() === "开始检测")!;
    await scan.trigger("click");
    await vi.waitFor(() => expect(mocks.searchSongs).toHaveBeenCalledTimes(4));
    expect(mocks.searchSongs.mock.calls.map((call) => call[0]).sort()).toEqual([
      "kugou",
      "kuwo",
      "netease",
      "qqmusic",
    ]);
    wrapper.unmount();
  });
});
