import { describe, expect, it } from "vitest";
import {
  anchorScrollCompensation,
  findVisibleRange,
  recomputeTopsFrom,
} from "@/utils/virtualListLayout";

/**
 * 虚拟列表布局计算：长歌单翻页卡顿/乱跳的两处核心逻辑。
 * 这些函数被 SVirtualList 直接使用，测试与实现同源。
 */

const buildTops = (heights: readonly number[]): number[] => {
  const tops = new Array<number>(heights.length);
  recomputeTopsFrom(tops, heights, 0);
  return tops;
};

describe("recomputeTopsFrom：增量重算", () => {
  it("从 0 开始得到完整累积位置", () => {
    const heights = [88, 88, 120, 88];
    expect(buildTops(heights)).toEqual([0, 88, 176, 296]);
  });

  it("只从 fromIndex 往后重算，之前的值保持不变（增量语义）", () => {
    const heights = [88, 88, 88, 88];
    const tops = buildTops(heights);
    // 中途把第 2 项高度改成 200
    heights[2] = 200;
    recomputeTopsFrom(tops, heights, 2);
    expect(tops).toEqual([0, 88, 176, 376]);
    // 前两项未被触碰
    expect(tops[0]).toBe(0);
    expect(tops[1]).toBe(88);
  });

  it("增量重算的尾部结果与全量重算一致（正确性不受增量影响）", () => {
    const N = 5000;
    const heights = Array.from({ length: N }, (_, i) => 88 + (i % 7) * 3);
    // 全量基准
    const full = buildTops(heights);

    // 增量：先把前 from 段的值算好（与全量一致），再让 recomputeTopsFrom
    // 从 from 开始接管后面所有项
    const from = Math.floor(N / 2);
    const partial = buildTops(heights);
    for (let i = from; i < N; i++) partial[i] = -1; // 标记为待重算
    recomputeTopsFrom(partial, heights, from);

    expect(partial).toEqual(full);
  });

  it("fromIndex 越界时安全处理", () => {
    const heights = [10, 10];
    const tops = [0, 0];
    recomputeTopsFrom(tops, heights, 99);
    expect(tops).toEqual([0, 0]);
    recomputeTopsFrom(tops, heights, -5);
    expect(tops).toEqual([0, 10]);
  });
});

describe("findVisibleRange：可见区间", () => {
  const heights = Array.from({ length: 100 }, () => 88);
  const tops = buildTops(heights);

  it("顶部时从 0 开始", () => {
    const r = findVisibleRange(tops, heights, 0, 800, 0, 100);
    expect(r.start).toBe(0);
    expect(r.end).toBe(Math.floor(800 / 88));
  });

  it("滚动到中部时区间正确平移", () => {
    const scrollTop = 88 * 50; // 第 50 项顶部
    const r = findVisibleRange(tops, heights, scrollTop, 800, 0, 100);
    expect(r.start).toBe(50);
    expect(r.end).toBe(50 + Math.floor(800 / 88));
  });

  it("缓冲项向两侧扩展并夹紧边界", () => {
    const r = findVisibleRange(tops, heights, 88 * 50, 800, 5, 100);
    expect(r.start).toBe(45);
    expect(r.end).toBeLessThanOrEqual(99);
  });

  it("空列表返回 end = -1（上层据此渲染空态）", () => {
    expect(findVisibleRange([], [], 0, 800, 5, 0)).toEqual({ start: 0, end: -1 });
  });

  it("滚动到列表末尾时不越界", () => {
    const total = tops[99] + heights[99];
    const r = findVisibleRange(tops, heights, total, 800, 5, 100);
    expect(r.start).toBeLessThanOrEqual(99);
    expect(r.end).toBe(99);
  });
});

describe("anchorScrollCompensation：高度修正后的滚动锚定", () => {
  it("变更发生在锚点之后 → 无需补偿", () => {
    expect(anchorScrollCompensation(20, 10, 880, 880)).toBe(0);
  });

  it("变更发生在锚点之前 → 按位移量补偿，视觉内容不跳", () => {
    // 锚点项原 top=880，因前面某项变高移到 920 → 需要把 scrollTop 也 +40
    expect(anchorScrollCompensation(3, 10, 880, 920)).toBe(40);
  });

  it("变更恰在锚点项本身时不补偿（该项自身高度变化不应推动视口）", () => {
    expect(anchorScrollCompensation(10, 10, 880, 950)).toBe(0);
  });

  it("负位移（某项变矮）同样正确补偿", () => {
    expect(anchorScrollCompensation(1, 10, 880, 850)).toBe(-30);
  });
});
