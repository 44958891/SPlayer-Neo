<script setup lang="ts" generic="T">
import { anchorScrollCompensation, recomputeTopsFrom } from "@/utils/virtualListLayout";

export interface SVirtualListExposed {
  wrapperRef: HTMLElement | null;
  /** 实际滚动容器 */
  scrollRef: HTMLElement | null;
  contentRef: HTMLElement | null;
  actualStartIndex: number;
  scrollTo: (top: number, behavior?: ScrollBehavior) => void;
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  getScrollTop: () => number;
  getItemTop: (index: number) => number;
  getDropInfoByOffset: (offsetY: number) => { index: number; position: "top" | "bottom" };
}

export interface SVirtualListProps<T> {
  /** 列表数据 */
  items: T[];
  /** 每项预估高度（定高模式下为精确高度） */
  itemHeight: number;
  /** 定高模式（跳过 DOM 测量，性能更佳） */
  itemFixed?: boolean;
  /** 容器高度，支持 CSS 值 */
  height?: number | string;
  /** 顶部内边距（px） */
  paddingTop?: number;
  /** 底部内边距（px） */
  paddingBottom?: number;
  /** 上下额外渲染的缓冲项数 */
  bufferSize?: number;
  /** 初始滚动到的索引 */
  defaultScrollIndex?: number;
  /** 获取唯一键 */
  getItemKey?: (item: T, index: number) => string | number;
  /** 隐藏滚动条 */
  hideScrollbar?: boolean;
  /** 封面主题色 */
  cover?: boolean;
}

const props = withDefaults(defineProps<SVirtualListProps<T>>(), {
  itemFixed: false,
  height: "100%",
  paddingTop: 0,
  paddingBottom: 0,
  bufferSize: 5,
  getItemKey: (_item: T, index: number) => index,
});

const emit = defineEmits<{
  scroll: [event: Event];
  reachBottom: [];
}>();

const wrapperRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const itemRefs = ref<HTMLElement[]>([]);

const scrollTop = ref(0);

// 测量滚动容器高度
const { height: scrollViewportHeight } = useElementSize(scrollRef);

const containerHeightStyle = computed(() =>
  typeof props.height === "number" ? `${props.height}px` : props.height,
);

const viewportHeight = computed(() => scrollViewportHeight.value || 0);

// 每项实际高度、累积顶部位置（仅动态高度模式）
const itemHeights = shallowRef<number[]>([]);
const itemTops = shallowRef<number[]>([]);

/** 初始化高度数组，复用已测量的值 */
const initializeHeights = (): void => {
  if (props.itemFixed) return;
  const length = props.items.length;
  if (itemHeights.value.length !== length) {
    const old = itemHeights.value;
    itemHeights.value = Array.from({ length }, (_, idx) => old[idx] || props.itemHeight);
  }
  updateTops();
};

/**
 * 从指定索引开始重算累积位置（增量，实现见 virtualListLayout）。
 *
 * 之前每次测量都从 0 全量重算（O(n)），长歌单滚动时每帧跑一遍是卡顿来源之一。
 */
const updateTops = (fromIndex = 0): void => {
  if (props.itemFixed) return;
  const heights = itemHeights.value;
  const tops =
    itemTops.value.length === heights.length ? itemTops.value : new Array<number>(heights.length);
  recomputeTopsFrom(tops, heights, fromIndex);
  itemTops.value = tops;
};

const totalHeight = computed(() => {
  if (props.itemFixed) {
    return props.items.length * props.itemHeight + props.paddingTop;
  }
  if (itemTops.value.length === 0) return props.paddingTop;
  const last = itemTops.value.length - 1;
  return itemTops.value[last] + itemHeights.value[last] + props.paddingTop;
});

const actualStartIndex = ref(0);
const actualEndIndex = ref(0);

/** 根据滚动位置计算可见范围，动态高度使用二分查找 */
const calculateVisibleRange = (currentScrollTop: number): void => {
  if (props.items.length === 0) {
    actualStartIndex.value = 0;
    actualEndIndex.value = -1;
    return;
  }
  const vHeight = viewportHeight.value;
  if (!vHeight) return;

  // 扣掉顶部 padding 后再换算项索引（itemTops 不含 paddingTop 偏移）
  const effectiveScroll = Math.max(0, currentScrollTop - props.paddingTop);

  let startIndex = 0;
  let endIndex = 0;

  if (props.itemFixed) {
    startIndex = Math.floor(effectiveScroll / props.itemHeight);
    endIndex = startIndex + Math.ceil(vHeight / props.itemHeight);
  } else {
    const tops = itemTops.value;
    const heights = itemHeights.value;
    const len = tops.length;

    let lo = 0;
    let hi = len - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (tops[mid] + heights[mid] > effectiveScroll) {
        startIndex = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const viewportBottom = effectiveScroll + vHeight;
    lo = startIndex;
    hi = len - 1;
    endIndex = startIndex;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (tops[mid] <= viewportBottom) {
        endIndex = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }

  const newStart = Math.max(0, startIndex - props.bufferSize);
  const newEnd = Math.min(props.items.length - 1, endIndex + props.bufferSize);
  if (newStart !== actualStartIndex.value || newEnd !== actualEndIndex.value) {
    actualStartIndex.value = newStart;
    actualEndIndex.value = newEnd;
  }
};

const visibleItems = computed(() => {
  if (actualStartIndex.value > actualEndIndex.value) return [];
  return props.items.slice(actualStartIndex.value, actualEndIndex.value + 1);
});

/**
 * 测量可见项的真实 DOM 高度，允许 0.5px 误差。
 *
 * 长列表卡顿/乱跳的三个修正点都在这里：
 * 1. 只从「最早发生变化的那一项」增量重算累积位置，不再全量 updateTops()
 * 2. 高度修正后做滚动锚定补偿：以视口顶部那一项为锚，按偏移差修正 scrollTop，
 *    否则前面某项高度被修正会让整个坐标系平移，表现为「列表突然跳一下」
 * 3. 测量过程中临时关掉高度过渡（见模板中的 transition），避免长列表
 *    几十万像素的高度动画持续把内容推走
 */
const measureItemHeights = (): void => {
  if (suppressMeasure) return;
  if (props.itemFixed || !itemRefs.value.length || props.items.length === 0) return;

  /** 最早发生高度变化的索引，用于增量重算起点 */
  let firstChanged = Number.POSITIVE_INFINITY;
  itemRefs.value.forEach((element) => {
    if (!element) return;
    const actualIndex = Number(element.dataset.index);
    if (!Number.isInteger(actualIndex) || actualIndex < 0 || actualIndex >= props.items.length)
      return;
    const height = element.getBoundingClientRect().height;
    if (height > 0 && Math.abs(height - itemHeights.value[actualIndex]) > 0.5) {
      itemHeights.value[actualIndex] = height;
      if (actualIndex < firstChanged) firstChanged = actualIndex;
    }
  });

  if (firstChanged === Number.POSITIVE_INFINITY) return;

  /** 索引项顶部偏移（含 paddingTop）；内联一份避免依赖下方 getItemTop 的定义顺序 */
  const topOf = (index: number): number =>
    props.itemFixed
      ? index * props.itemHeight + props.paddingTop
      : (itemTops.value[index] || 0) + props.paddingTop;

  // 锚点：视口顶部可见项及其在坐标系中的位移量（修正前后对比）
  const anchorIndex = actualStartIndex.value;
  const anchorTopBefore = topOf(anchorIndex);
  const scrollEl = scrollRef.value;
  const scrollBefore = scrollEl?.scrollTop ?? 0;

  triggerRef(itemHeights);
  // 只为受影响的尾部重算，长列表下可省掉绝大部分循环
  updateTops(firstChanged);

  // 锚点补偿：只有当变化发生在锚点之前，才需要通过 scrollTop 抵消位移
  if (scrollEl) {
    const delta = anchorScrollCompensation(
      firstChanged,
      anchorIndex,
      anchorTopBefore,
      topOf(anchorIndex),
    );
    if (delta !== 0) {
      scrollEl.scrollTop = scrollBefore + delta;
      scrollTop.value = scrollEl.scrollTop;
    }
  }

  calculateVisibleRange(scrollTop.value);
};

const debouncedMeasure = useDebounceFn(measureItemHeights, 50);

let rafId: number | null = null;
let pendingScrollTarget: HTMLElement | null = null;

const processScroll = (): void => {
  rafId = null;
  const target = pendingScrollTarget;
  if (!target) return;
  const { scrollTop: st, scrollHeight, clientHeight } = target;
  scrollTop.value = st;
  calculateVisibleRange(st);
  if (scrollHeight - st - clientHeight < 50) {
    emit("reachBottom");
  }
};

const handleScroll = (event: Event): void => {
  const target = event.target as HTMLElement;
  if (!target) return;
  emit("scroll", event);
  pendingScrollTarget = target;
  if (rafId === null) {
    rafId = requestAnimationFrame(processScroll);
  }
};

/** 获取指定索引项的顶部偏移（含 paddingTop） */
const getItemTop = (index: number): number => {
  if (props.itemFixed) return index * props.itemHeight + props.paddingTop;
  return (itemTops.value[index] || 0) + props.paddingTop;
};

/** 根据 Y 轴偏移量计算放置位置（供拖拽排序使用） */
const getDropInfoByOffset = (offsetY: number): { index: number; position: "top" | "bottom" } => {
  const len = props.items.length;
  if (len === 0) return { index: 0, position: "top" };
  // 扣掉 paddingTop，落到 itemTops 坐标系
  const adjusted = offsetY - props.paddingTop;
  if (props.itemFixed) {
    const index = Math.floor(adjusted / props.itemHeight);
    const remainder = ((adjusted % props.itemHeight) + props.itemHeight) % props.itemHeight;
    const position = remainder < props.itemHeight / 2 ? "top" : "bottom";
    return { index: Math.max(0, Math.min(index, len - 1)), position };
  }
  const tops = itemTops.value;
  const heights = itemHeights.value;
  if (adjusted <= 0) return { index: 0, position: "top" };
  if (adjusted >= tops[len - 1] + heights[len - 1]) return { index: len - 1, position: "bottom" };

  let low = 0;
  let high = len - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const top = tops[mid];
    const bottom = top + heights[mid];
    if (adjusted >= top && adjusted < bottom) {
      const position = adjusted - top < heights[mid] / 2 ? "top" : "bottom";
      return { index: mid, position };
    } else if (adjusted < top) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return { index: len - 1, position: "bottom" };
};

/** 滚动到指定像素位置 */
const scrollToPosition = (top: number, behavior: ScrollBehavior = "auto"): void => {
  scrollRef.value?.scrollTo({ top, behavior });
};

/** 滚动到指定索引项 */
const scrollToIndex = (index: number, behavior: ScrollBehavior = "auto"): void => {
  if (props.items.length === 0) return;
  const targetIndex = Math.max(0, Math.min(index, props.items.length - 1));
  let top = 0;
  if (props.itemFixed) {
    top = targetIndex * props.itemHeight;
  } else {
    if (itemTops.value.length <= targetIndex) initializeHeights();
    top = itemTops.value[targetIndex] || 0;
  }
  scrollToPosition(top, behavior);
};

/** 获取当前滚动位置 */
const getScrollTop = (): number => scrollTop.value;

watch(
  () => props.items,
  () => {
    initializeHeights();
    calculateVisibleRange(scrollTop.value);
    nextTick(debouncedMeasure);
  },
  { deep: false },
);

watch(
  () => props.items.length,
  () => {
    initializeHeights();
    calculateVisibleRange(scrollTop.value);
  },
);

watch(viewportHeight, () => {
  calculateVisibleRange(scrollTop.value);
});

watch(
  () => [actualStartIndex.value, actualEndIndex.value],
  () => {
    if (!props.itemFixed) nextTick(debouncedMeasure);
  },
  { flush: "post" },
);

onMounted(() => {
  initializeHeights();
  calculateVisibleRange(0);
  if (props.defaultScrollIndex) scrollToIndex(props.defaultScrollIndex);
  nextTick(() => {
    if (!props.itemFixed) measureItemHeights();
    // 重新计算
    if (viewportHeight.value > 0) calculateVisibleRange(scrollTop.value);
  });
});

/** 滚动位置 */
let savedScrollTop = 0;

/**
 * 恢复滚动位置期间抑制高度测量。
 *
 * KeepAlive 重新激活时，DOM 刚挂回、字体/图片尚未回流，此时测出的高度不可靠；
 * 若照常测量并做锚点补偿，会与下面的 scrollTo 互相拉扯，表现为「切回来先跳一下」。
 * 用两帧窗口跳过这段不稳定期。
 */
let suppressMeasure = false;

onDeactivated(() => {
  const domTop = scrollRef.value?.scrollTop;
  savedScrollTop = domTop && domTop > 0 ? domTop : scrollTop.value;
});

/** 恢复滚动位置并重算可见范围 */
onActivated(() => {
  const targetTop = savedScrollTop > 0 ? savedScrollTop : scrollTop.value;
  if (targetTop <= 0) return;
  suppressMeasure = true;
  scrollTop.value = targetTop;
  calculateVisibleRange(targetTop);
  nextTick(() => {
    scrollRef.value?.scrollTo({ top: targetTop });
    calculateVisibleRange(targetTop);
    // 两帧后恢复测量：此时布局已稳定，锚点补偿不会与恢复动作冲突
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressMeasure = false;
        if (!props.itemFixed) measureItemHeights();
      });
    });
  });
});

onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
});

defineExpose({
  wrapperRef,
  scrollRef,
  contentRef,
  actualStartIndex,
  scrollTo: scrollToPosition,
  scrollToIndex,
  getScrollTop,
  getItemTop,
  getDropInfoByOffset,
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="w-full flex flex-col [overflow-anchor:none] contain-[layout_paint]"
    :style="{ height: containerHeightStyle }"
  >
    <div v-if="items.length === 0 && $slots.empty" class="flex-1 flex items-center justify-center">
      <slot name="empty" />
    </div>
    <template v-else>
      <div v-if="$slots.header" class="shrink-0">
        <slot name="header" />
      </div>
      <div
        ref="scrollRef"
        class="flex-1 min-h-0 overflow-y-auto"
        :class="[
          hideScrollbar ? '[&::-webkit-scrollbar]:hidden' : '',
          cover
            ? '[&::-webkit-scrollbar-thumb]:bg-cover/25 [&::-webkit-scrollbar-thumb:hover]:bg-cover/45'
            : '',
        ]"
        @scroll="handleScroll"
      >
        <div
          v-show="items.length > 0"
          :style="{
            height: `${totalHeight}px`,
            position: 'relative',
          }"
        >
          <div ref="contentRef" class="absolute inset-x-0 top-0">
            <div
              v-for="(item, visibleIdx) in visibleItems"
              :key="getItemKey(item, actualStartIndex + visibleIdx)"
              ref="itemRefs"
              :data-index="actualStartIndex + visibleIdx"
              class="absolute inset-x-0 top-0 contain-[layout_paint]"
              :style="{ transform: `translateY(${getItemTop(actualStartIndex + visibleIdx)}px)` }"
            >
              <slot :item="item" :index="actualStartIndex + visibleIdx" />
            </div>
          </div>
        </div>
        <div v-if="$slots.footer && items.length > 0" class="shrink-0">
          <slot name="footer" />
        </div>
        <!-- 底部 spacer -->
        <div v-if="paddingBottom > 0" class="shrink-0" :style="{ height: `${paddingBottom}px` }" />
      </div>
    </template>
  </div>
</template>
