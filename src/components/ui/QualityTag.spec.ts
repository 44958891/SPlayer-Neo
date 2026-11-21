import { mount } from "@vue/test-utils";
import type { DOMWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import type { AudioQuality } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { QualityProvenance } from "@shared/types/quality";
import { qualityArtworkForFamily } from "@/utils/qualityArtwork";
import i18n from "@/i18n";
import QualityTag from "./QualityTag.vue";

/** 构造有损规格文件
 * @param bitRate - 比特率
 * @returns MP3 音频参数
 */
const mp3 = (bitRate: number): AudioQuality => ({
  codec: "mp3",
  sampleRate: 44100,
  bitsPerSample: 16,
  bitRate,
  channels: 2,
});

/** 构造无损规格文件
 * @param sampleRate - 采样率
 * @param bitsPerSample - 位深
 * @returns FLAC 音频参数
 */
const flac = (sampleRate: number, bitsPerSample: number): AudioQuality => ({
  codec: "flac",
  sampleRate,
  bitsPerSample,
  bitRate: 1000000,
  channels: 2,
});

/** 官方响应确认的 QQ 臻品母带历史 4.0 回执，归一后仍展示通用母带文案 */
const qqMasterProvenance: QualityProvenance = {
  provider: "official",
  platform: "qqmusic",
  nativeTier: "臻品母带4.0",
  evidence: "response",
};

/** 构造 QQ 全景声插件来源证据，附带 2.0 请求对照
 * @param nativeTier - 实际回执的原生档位，缺省时只保留请求回显
 * @returns 带请求对照的来源证据
 */
const qqSpatialProvenance = (nativeTier?: string): QualityProvenance => ({
  provider: "plugin",
  platform: "qqmusic",
  level: "sky",
  evidence: "plugin",
  ...(nativeTier ? { nativeTier } : {}),
  requestedTier: "atmos_plus",
  requestedSelection: "qqmusic:qq-spatial-2.0",
});

/** 读取徽标内矢量图形的路径数据
 * @param wrapper - 已挂载组件
 * @returns 各 path 的 d 属性列表
 */
const emblemPaths = (wrapper: { findAll: (selector: string) => DOMWrapper<Element>[] }) =>
  wrapper.findAll("svg.quality-emblem path").map((path) => path.attributes("d"));

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
});

describe("QualityTag 渲染", () => {
  it("品牌母带显示平台标签与统一矢量图形，不再渲染图片", () => {
    const wrapper = mount(QualityTag, {
      props: { quality: flac(192000, 24), provenance: qqMasterProvenance, measured: true },
    });
    expect(wrapper.findAll("img")).toHaveLength(0);
    expect(wrapper.findAll("svg")).toHaveLength(1);
    expect(wrapper.find("svg.quality-emblem").attributes("aria-hidden")).toBe("true");
    expect(emblemPaths(wrapper)).toEqual([...qualityArtworkForFamily("master").paths]);
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(["quality-tag", "quality-tone", "quality-tone--master"]),
    );
    expect(wrapper.classes()).not.toContain("quality-tone--warning");
    expect(wrapper.classes()).not.toContain("quality-tone--cover");
    expect(wrapper.text()).toBe("臻品母带");
    expect(wrapper.find(".quality-name").text()).toBe("臻品母带");
    const tooltip = wrapper.find("span[title]").attributes("title") ?? "";
    expect(tooltip).toContain("QQ音乐");
    expect(tooltip).toContain("FLAC · 24bit · 192.0kHz");
    expect(tooltip).toContain("音源接口响应已确认");
  });

  it("真实回执档位与请求对照分开提示，版本只出现在请求行", () => {
    const wrapper = mount(QualityTag, {
      props: { quality: flac(44100, 16), provenance: qqSpatialProvenance("atmos"), measured: true },
    });
    expect(wrapper.text()).toBe("臻品全景声");
    expect(wrapper.classes()).toContain("quality-tone--spatial");
    expect(wrapper.classes()).not.toContain("quality-tone--spatial-plus");
    const tooltip = wrapper.find("span[title]").attributes("title") ?? "";
    expect(tooltip).toContain("目标档位：臻品全景声 2.0");
    expect(tooltip).toContain("来源档位：atmos");
    expect(tooltip).toContain("音源插件声明档位，未经解码独立验证");
  });

  it("仅请求回显不点亮品牌档位，按文件实际规格回退通用档", () => {
    const wrapper = mount(QualityTag, {
      props: { quality: flac(44100, 16), provenance: qqSpatialProvenance(), measured: true },
    });
    expect(wrapper.text()).not.toContain("臻品全景声");
    expect(wrapper.text()).not.toContain("2.0");
    expect(wrapper.classes()).not.toContain("quality-tone--spatial-plus");
    expect(wrapper.classes()).not.toContain("quality-tone--premium");
    expect(wrapper.classes()).toContain("quality-tone--lossless");
  });

  it("版本在中文与英文下都只渲染一次", () => {
    const make = () =>
      mount(QualityTag, {
        props: {
          quality: flac(44100, 16),
          provenance: qqSpatialProvenance("qq-spatial-2.0"),
          measured: true,
        },
      });
    const zh = make();
    expect(zh.text()).toBe("臻品全景声 2.0");
    expect(zh.text().match(/2\.0/g)).toHaveLength(1);
    i18n.global.locale.value = "en-US";
    const en = make();
    expect(en.text()).toBe("Premium Spatial Audio 2.0");
    expect(en.text().match(/2\.0/g)).toHaveLength(1);
    expect(emblemPaths(en)).toEqual([...qualityArtworkForFamily("spatial-plus").paths]);
  });

  it("封面模式沿用类别色并保持单一矢量图形", () => {
    const wrapper = mount(QualityTag, {
      props: {
        quality: flac(44100, 16),
        provenance: qqSpatialProvenance("qq-spatial-2.0"),
        measured: true,
        cover: true,
      },
    });
    expect(wrapper.classes()).toContain("quality-tone--cover");
    expect(wrapper.classes()).toContain("quality-tone--spatial-plus");
    expect(wrapper.findAll("img")).toHaveLength(0);
    expect(wrapper.findAll("svg")).toHaveLength(1);
    expect(emblemPaths(wrapper)).toEqual([...qualityArtworkForFamily("spatial").paths]);
    expect(wrapper.text().match(/2\.0/g)).toHaveLength(1);
  });

  it("臻品音质使用 premium 类别统一图标", () => {
    const wrapper = mount(QualityTag, {
      props: {
        quality: flac(96000, 24),
        measured: true,
        provenance: {
          provider: "plugin",
          platform: "qqmusic",
          nativeTier: "qq-premium-2.0",
          level: "sky",
          evidence: "plugin",
        },
      },
    });
    expect(wrapper.findAll("img")).toHaveLength(0);
    expect(wrapper.classes()).toContain("quality-tone--premium");
    expect(wrapper.find(".quality-name").text()).toBe("臻品音质 2.0");
    expect(emblemPaths(wrapper)).toEqual([...qualityArtworkForFamily("premium").paths]);
  });

  it("通用档位按偏好目标渲染短码与本地化提示", () => {
    const master = mount(QualityTag, { props: { level: "jymaster" } });
    expect(master.text()).toBe("Master");
    expect(master.find("span[title]").attributes("title")).toBe("超清母带");
    expect(master.classes()).toContain("quality-tone--master");
    expect(emblemPaths(master)).toEqual([...qualityArtworkForFamily("master").paths]);

    const hq = mount(QualityTag, { props: { level: "hq" } });
    expect(hq.text()).toBe("HQ");
    expect(hq.classes()).toContain("quality-tone--hq");
  });

  it("编码未知或无任何输入时显示占位，不伪造 LQ", () => {
    const unknown = mount(QualityTag, {
      props: {
        quality: { codec: "unknown", sampleRate: 0, bitsPerSample: 0, bitRate: 0, channels: 2 },
      },
    });
    expect(unknown.find(".quality-tag").exists()).toBe(false);
    expect(unknown.find(".quality-placeholder").text()).toBe("—");

    const empty = mount(QualityTag, { props: {} });
    expect(empty.find(".quality-placeholder").text()).toBe("—");
    expect(empty.find("svg").exists()).toBe(false);
  });

  it("实测与声明矛盾时用警示类别并保留通用档位", () => {
    const wrapper = mount(QualityTag, {
      props: {
        quality: mp3(128000),
        provenance: {
          provider: "official",
          platform: "netease",
          nativeTier: "jymaster",
          evidence: "response",
        },
        measured: true,
      },
    });
    expect(wrapper.classes()).toContain("quality-tone--warning");
    expect(wrapper.classes()).toContain("quality-tone--standard");
    expect(wrapper.classes()).not.toContain("quality-tone--master");
    expect(wrapper.text()).toContain("LQ");
    expect(wrapper.find("span[title]").attributes("title")).toContain("实测参数与声明档位不符");
    expect(wrapper.findAll("img")).toHaveLength(0);
  });

  it("无来源本地母带按实测规格渲染通用 Master", () => {
    const wrapper = mount(QualityTag, { props: { quality: flac(192000, 24), measured: true } });
    expect(wrapper.text()).toBe("Master");
    expect(wrapper.classes()).toContain("quality-tone--master");
    expect(wrapper.find("span[title]").attributes("title")).toContain("超清母带");
    expect(emblemPaths(wrapper)).toEqual([...qualityArtworkForFamily("master").paths]);
  });

  it("各平台无损共用同一类别样式与图形", () => {
    const platforms: readonly Platform[] = ["netease", "qqmusic", "kugou", "kuwo", "migu"];
    for (const platform of platforms) {
      const wrapper = mount(QualityTag, {
        props: {
          quality: flac(44100, 16),
          provenance: { provider: "plugin", platform, level: "lossless", evidence: "plugin" },
          measured: true,
        },
      });
      expect(wrapper.classes(), platform).toContain("quality-tone--lossless");
      expect(emblemPaths(wrapper), platform).toEqual([
        ...qualityArtworkForFamily("lossless").paths,
      ]);
      expect(wrapper.text(), platform).toBe("Lossless");
    }
  });

  it("各平台母带共用同一图形，本地标签各自保留", () => {
    const cases: readonly (readonly [QualityProvenance, string])[] = [
      [
        { provider: "official", platform: "netease", nativeTier: "jymaster", evidence: "response" },
        "超清母带",
      ],
      [
        {
          provider: "official",
          platform: "qqmusic",
          nativeTier: "master",
          evidence: "response",
        },
        "臻品母带",
      ],
      [
        {
          provider: "plugin",
          platform: "kugou",
          nativeTier: "kugou-master",
          level: "jymaster",
          evidence: "plugin",
        },
        "蝰蛇超清",
      ],
      [
        {
          provider: "plugin",
          platform: "kuwo",
          nativeTier: "kuwo-master",
          level: "jymaster",
          evidence: "plugin",
        },
        "至臻母带",
      ],
      [
        {
          provider: "plugin",
          platform: "kuwo",
          nativeTier: "master",
          level: "jymaster",
          evidence: "plugin",
        },
        "至臻母带",
      ],
    ];
    for (const [provenance, label] of cases) {
      const wrapper = mount(QualityTag, {
        props: { quality: flac(192000, 24), provenance, measured: true },
      });
      expect(wrapper.classes(), label).toContain("quality-tone--master");
      expect(emblemPaths(wrapper), label).toEqual([...qualityArtworkForFamily("master").paths]);
      expect(wrapper.find(".quality-name").text(), label).toBe(label);
    }
    const kugou = mount(QualityTag, {
      props: { quality: flac(192000, 24), provenance: cases[2][0], measured: true },
    });
    const tooltip = kugou.find("span[title]").attributes("title") ?? "";
    expect(tooltip).toContain("酷狗音乐");
    expect(tooltip).toContain("来源档位：kugou-master");
  });
});
