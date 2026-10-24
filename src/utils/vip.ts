/**
 * 网易云会员徽标映射
 *
 * vipType 取自账号接口 profile.vipType，三态显示：
 * - 0 / 缺失：未开通会员，不显示徽标
 * - 11 / 110：超级会员 → SVIP
 * - 其余非 0（10 / 100 / 未知新档位）：普通会员 → CVIP
 */

/** 超级会员 vipType 集合 */
const SVIP_TYPES: ReadonlySet<number> = new Set([11, 110]);

/**
 * 由 vipType 得到会员徽标文案
 * @param vipType - profile.vipType
 * @returns SVIP / CVIP；未开通会员返回 null
 */
export const vipBadgeLabel = (vipType?: number): string | null => {
  if (!vipType) return null;
  return SVIP_TYPES.has(vipType) ? "SVIP" : "CVIP";
};
