/**
 * 虚拟列表的累积位置计算（纯函数，便于单测）。
 *
 * 从 SVirtualList.vue 抽出：动态高度模式下每次测量都会修正某些项的高度，
 * 需要重算 top 数组。这里只做「从 fromIndex 往后」的增量重算，
 * 避免长列表（几千项）每次都从头跑一遍导致滚动卡顿。
 */

/**
 * 从指定索引开始重算累积位置（原地修改 tops）
 * @param tops - 累积顶部位置数组（会被写入）
 * @param heights - 每项高度
 * @param fromIndex - 起始索引，之前的项视为未变化
 */
export const recomputeTopsFrom = (
  tops: number[],
  heights: readonly number[],
  fromIndex: number,
): void => {
  const start = Math.max(0, Math.min(fromIndex, heights.length));
  let top = start > 0 ? tops[start - 1] + heights[start - 1] : 0;
  for (let idx = start; idx < heights.length; idx++) {
    tops[idx] = top;
    top += heights[idx];
  }
};

/**
 * 找出视口内的可见区间（含缓冲项）
 * @param tops - 累积顶部位置
 * @param heights - 每项高度
 * @param scrollTop - 当前滚动位置（已扣除 paddingTop）
 * @param viewportHeight - 视口高度
 * @param bufferSize - 上下缓冲项数
 * @returns 起止索引（闭区间）；空列表返回 -1
 */
export const findVisibleRange = (
  tops: readonly number[],
  heights: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  bufferSize: number,
  length: number,
): { start: number; end: number } => {
  if (length === 0) return { start: 0, end: -1 };

  // 二分找第一个「底部越过 scrollTop」的项
  let startIndex = 0;
  let lo = 0;
  let hi = length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (tops[mid] + heights[mid] > scrollTop) {
      startIndex = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // 二分找最后一个「顶部不超过视口底部」的项
  const viewportBottom = scrollTop + viewportHeight;
  let endIndex = startIndex;
  lo = startIndex;
  hi = length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (tops[mid] <= viewportBottom) {
      endIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return {
    start: Math.max(0, startIndex - bufferSize),
    end: Math.min(length - 1, endIndex + bufferSize),
  };
};

/**
 * 高度修正后的滚动锚定补偿量。
 *
 * 若变更项在锚点之前，锚点项整体位移了 delta，需要把 scrollTop 同步加上 delta，
 * 视觉上内容才停在原处（否则表现为列表突然跳一下）。
 * @returns 需要叠加到 scrollTop 的偏移量（0 表示无需补偿）
 */
export const anchorScrollCompensation = (
  firstChangedIndex: number,
  anchorIndex: number,
  anchorTopBefore: number,
  anchorTopAfter: number,
): number => {
  if (firstChangedIndex >= anchorIndex) return 0;
  return anchorTopAfter - anchorTopBefore;
};
