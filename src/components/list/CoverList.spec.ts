import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import type { CoverItem } from "@/types/artist";
import CoverCard from "./CoverCard.vue";
import CoverList from "./CoverList.vue";

vi.mock("@/composables/useFloatingPlayerBar", () => ({
  useFloatingPlayerBar: () => ({ isFloatingBar: false, PLAYER_BAR_GAP: 100 }),
}));

const sameId: CoverItem[] = [
  { id: "1", title: "QQ playlist", source: "qqmusic", trackCount: 10 },
  { id: "1", title: "Kuwo playlist", source: "kuwo", trackCount: 20 },
];

describe("跨平台封面列表", () => {
  it("跨平台同 ID 卡片换序后仍保留正确的来源、内容和点击对象", async () => {
    const warn = vi.spyOn(console, "warn");
    const wrapper = mount(CoverList, {
      props: { items: sameId, virtual: false, showSource: true },
      global: {
        plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: {} })],
        components: { CoverCard },
        stubs: {
          SImg: true,
          IconLucidePlay: true,
          IconLucideUser: true,
          SVirtualList: true,
          SLoading: true,
        },
      },
    });
    await wrapper.setProps({ items: [...sameId].reverse() });
    const cards = wrapper.findAllComponents(CoverCard);
    expect(cards.map((card) => card.props("item").source)).toEqual(["kuwo", "qqmusic"]);
    expect(cards[0].text()).toContain("Kuwo playlist");
    expect(cards[0].find('[title="酷我音乐"]').text()).toBe("KW");
    await cards[0].trigger("click");
    expect(wrapper.emitted("click")?.[0]).toEqual([sameId[1]]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("Duplicate keys");
    wrapper.unmount();
  });

  it("来源标识仅在显式启用时出现，旧卡片仍可渲染", () => {
    const wrapper = mount(CoverCard, {
      props: { item: sameId[0] },
      global: { stubs: { SImg: true, IconLucidePlay: true, IconLucideUser: true } },
    });
    expect(wrapper.find('[title="QQ音乐"]').exists()).toBe(false);
    wrapper.unmount();
    const legacy = mount(CoverCard, {
      props: { item: { id: "old", title: "Legacy", trackCount: 0 }, showSource: true },
      global: { stubs: { SImg: true, IconLucidePlay: true, IconLucideUser: true } },
    });
    expect(legacy.text()).toBe("Legacy");
    legacy.unmount();
  });
});
