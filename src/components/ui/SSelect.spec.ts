import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, markRaw, nextTick } from "vue";
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";
import type { SSelectOption } from "./SSelect.vue";
import SSelect from "./SSelect.vue";

/** 桩件装饰图标，模拟 QualityIcon 的 aria-hidden svg 形态 */
const FakeIcon = defineComponent({
  name: "FakeIcon",
  render: () =>
    h("svg", { class: "fake-quality-icon", viewBox: "0 0 24 24", "aria-hidden": "true" }, [
      h("path", { d: "M4 12h16" }),
    ]),
});

/** 测试环境缺失 unplugin-icons 解析，补原生替身避免告警 */
const iconStubs = {
  IconLucideChevronDown: { template: "<svg />" },
  IconLucideCheck: { template: "<svg />" },
};

/** 挂载 SSelect 并注册 reka Select 家族（测试环境不走全局组件注册） */
const mountSelect = (props: { modelValue: string; options: SSelectOption[] }) =>
  mount(SSelect, {
    props,
    global: {
      components: {
        SelectRoot,
        SelectTrigger,
        SelectValue,
        SelectIcon,
        SelectPortal,
        SelectContent,
        SelectViewport,
        SelectItem,
        SelectItemText,
        SelectItemIndicator,
        ...iconStubs,
      },
    },
  });

/** 打开下拉浮层（键盘触发），等浮层传送完成后返回 document.body */
const openDropdown = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.find('[role="combobox"]').trigger("keydown", { key: "Enter" });
  await nextTick();
  await nextTick();
  return document.body;
};

/** 向选项派发 pointerup 触发 reka 的选中处理 */
const pickOption = async (item: Element) => {
  item.dispatchEvent(new Event("pointerup", { bubbles: true }));
  await nextTick();
  await nextTick();
};

enableAutoUnmount(afterEach);

describe("SSelect 装饰图标", () => {
  it("选中值展示图标与纯文本标签，无图标选项保持原行为", () => {
    const wrapper = mountSelect({
      modelValue: "master",
      options: [{ value: "master", label: "臻品母带", icon: markRaw(FakeIcon) }],
    });
    const trigger = wrapper.find('[role="combobox"]');
    expect(trigger.find("svg.fake-quality-icon").exists()).toBe(true);
    expect(trigger.text()).toContain("臻品母带");
    // 浮层未打开时组件树内仅选中值一个图标节点
    expect(wrapper.findAll("svg.fake-quality-icon")).toHaveLength(1);
  });

  it("菜单项在纯文本标签前渲染图标，可访问文本仍为标签本身", async () => {
    const wrapper = mountSelect({
      modelValue: "master",
      options: [
        { value: "master", label: "臻品母带", icon: markRaw(FakeIcon) },
        { value: "lossless", label: "无损" },
      ],
    });
    const body = await openDropdown(wrapper);
    const items = Array.from(body.querySelectorAll('[role="option"]'));
    expect(items).toHaveLength(2);
    const [iconed, plain] = items;
    expect(iconed.getAttribute("title")).toBe("臻品母带");
    const icon = iconed.querySelector("svg.fake-quality-icon");
    expect(icon).not.toBeNull();
    expect(icon?.previousElementSibling).toBeNull();
    // svg 不参与文本内容，textContent 即纯文本标签
    expect(iconed.textContent).toBe("臻品母带");
    // 无图标菜单项无 svg，文本不变
    expect(plain.querySelector("svg.fake-quality-icon")).toBeNull();
    expect(plain.textContent).toBe("无损");
  });

  it("选择逻辑不变：普通选项正常回传，禁用选项不触发", async () => {
    const wrapper = mountSelect({
      modelValue: "master",
      options: [
        { value: "master", label: "臻品母带", icon: markRaw(FakeIcon) },
        { value: "lossless", label: "无损" },
        { value: "sky", label: "空间音频", icon: markRaw(FakeIcon), disabled: true },
      ],
    });
    const body = await openDropdown(wrapper);
    const items = Array.from(body.querySelectorAll('[role="option"]'));
    expect(items).toHaveLength(3);
    await pickOption(items[1]);
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["lossless"]);
    await pickOption(items[2]);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });
});
