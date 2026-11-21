import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import type { PlaybackQualityStatus } from "@shared/types/playbackQuality";
import i18n from "@/i18n";
import { qualityLevelLabel } from "@/utils/qualityBadge";
import QualityStatusIndicator from "./QualityStatusIndicator.vue";

const below: PlaybackQualityStatus = {
  selection: "netease:hires",
  platform: "netease",
  state: "below",
  actualLevel: "lossless",
};

/**
 * 挂载状态指示组件，工具提示内容内联渲染便于断言
 * @param status - 主进程回传的请求对照
 */
const mountIndicator = (status?: PlaybackQualityStatus) =>
  mount(QualityStatusIndicator, {
    props: { status },
    global: {
      stubs: {
        STooltip: {
          props: ["content"],
          template: '<div><slot /><div class="tooltip-content">{{ content }}</div></div>',
        },
      },
    },
  });

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
});

describe("QualityStatusIndicator 播放音质对照", () => {
  it("met 与缺失对照不渲染警示", () => {
    const met = mountIndicator({ ...below, state: "met" });
    expect(met.find(".text-amber-500").exists()).toBe(false);
    expect(met.find(".tooltip-content").exists()).toBe(false);

    const absent = mountIndicator(undefined);
    expect(absent.find(".text-amber-500").exists()).toBe(false);
    expect(absent.find(".tooltip-content").exists()).toBe(false);
  });

  it("below 渲染警示并提示请求与实际档位，实际名称与助手同参数", () => {
    const wrapper = mountIndicator(below);
    expect(wrapper.find(".text-amber-500").exists()).toBe(true);
    const tooltip = wrapper.find(".tooltip-content").text();
    expect(tooltip).toContain("高解析度无损 Hi-Res");
    expect(tooltip).toContain(qualityLevelLabel("lossless"));
    expect(tooltip).toContain(
      i18n.global.t("quality.playback.below", {
        requested: "高解析度无损 Hi-Res",
        actual: qualityLevelLabel("lossless"),
      }),
    );
  });

  it("unconfirmed 渲染警示并给出未确认提示", () => {
    const wrapper = mountIndicator({ ...below, state: "unconfirmed" });
    expect(wrapper.find(".text-amber-500").exists()).toBe(true);
    expect(wrapper.find(".tooltip-content").text()).toContain(
      i18n.global.t("quality.playback.unconfirmed", {
        requested: "高解析度无损 Hi-Res",
        actual: qualityLevelLabel("lossless"),
      }),
    );
  });

  it("未知选择提示目标不可用，不展示原始键", () => {
    const wrapper = mountIndicator({ ...below, selection: "netease:ghost" });
    const tooltip = wrapper.find(".tooltip-content").text();
    expect(tooltip).toContain(i18n.global.t("quality.playback.targetUnavailable"));
    expect(tooltip).not.toContain("netease:ghost");
    expect(tooltip).toContain(
      i18n.global.t("quality.playback.below", {
        requested: i18n.global.t("quality.playback.targetUnavailable"),
        actual: qualityLevelLabel("lossless"),
      }),
    );
  });
});
