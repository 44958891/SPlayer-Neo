import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { AudioQuality, Track, TrackDetail } from "@shared/types/player";
import type { QualityProvenance } from "@shared/types/quality";
import i18n from "@/i18n";
import { useMediaStore } from "@/stores/media";
import { qualityBadgeText, qualityLevelLabel, resolveQualityBadgeView } from "@/utils/qualityBadge";
import QualityControl from "./QualityControl.vue";

vi.mock("@/services/lyric/loader", () => ({ watchLyricPreference: vi.fn() }));
vi.mock("@/stores/settings", async () => {
  const { defineStore } = await import("pinia");
  return {
    useSettingsStore: defineStore("settings", {
      state: () => ({
        player: { songLevel: "hi-res", songQualitySelection: "netease:hires" },
        lyric: { cjkTransform: "none" },
      }),
    }),
  };
});
vi.mock("@/core/player", () => ({ reloadCurrentTrack: vi.fn() }));

const lossless: AudioQuality = {
  codec: "flac",
  sampleRate: 44100,
  bitsPerSample: 16,
  bitRate: 900000,
  channels: 2,
};
const provenance: QualityProvenance = {
  provider: "official",
  platform: "netease",
  evidence: "response",
};

const track: Track = {
  id: "a",
  title: "A",
  artists: [],
  source: "netease",
  duration: 1000,
};

/**
 * 构造带实测详情的曲目
 * @param playbackQuality - 主进程回传的请求对照
 */
const detail = (playbackQuality?: TrackDetail["playbackQuality"]): TrackDetail => ({
  quality: lossless,
  qualityProvenance: provenance,
  externalLyrics: [],
  ...(playbackQuality ? { playbackQuality } : {}),
});

/**
 * 挂载音质控制弹层，弹层与提示桩件内联渲染插槽便于断言
 * @param playbackQuality - 主进程回传的请求对照
 */
const mountControl = async (playbackQuality?: TrackDetail["playbackQuality"]) => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const media = useMediaStore();
  media.setTrack(track, detail(playbackQuality));
  const wrapper = mount(QualityControl, {
    global: {
      plugins: [pinia, i18n],
      stubs: {
        SPopselect: {
          props: ["modelValue", "options"],
          template: '<div><slot name="header" /><slot name="trigger" /></div>',
        },
        STooltip: {
          props: ["content"],
          template: '<div><slot /><div class="tooltip-content">{{ content }}</div></div>',
        },
      },
    },
  });
  await wrapper.vm.$nextTick();
  return wrapper;
};

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
});

describe("QualityControl 实际与请求对照", () => {
  it("弹层头部实际徽标与助手同参数一致，低于请求时渲染警示", async () => {
    const wrapper = await mountControl({
      selection: "netease:hires",
      platform: "netease",
      state: "below",
      actualLevel: "lossless",
    });
    const view = resolveQualityBadgeView(lossless, provenance, true);
    const actualLabel = qualityBadgeText(view, lossless).label;
    expect(actualLabel).toBe("Lossless");
    expect(wrapper.text()).toContain(actualLabel);
    expect(wrapper.text()).toContain("高解析度无损 Hi-Res");
    expect(wrapper.find(".text-amber-500").exists()).toBe(true);
    expect(wrapper.find(".tooltip-content").text()).toContain(
      i18n.global.t("quality.playback.below", {
        requested: "高解析度无损 Hi-Res",
        actual: qualityLevelLabel("lossless"),
      }),
    );
  });

  it("无对照或 met 时头部不显示警示，请求回落当前菜单选择", async () => {
    const wrapper = await mountControl();
    expect(wrapper.find(".text-amber-500").exists()).toBe(false);
    expect(wrapper.find(".tooltip-content").exists()).toBe(false);
    expect(wrapper.text()).toContain("高解析度无损 Hi-Res");

    const met = await mountControl({
      selection: "netease:hires",
      platform: "netease",
      state: "met",
    });
    expect(met.find(".text-amber-500").exists()).toBe(false);
  });
});
