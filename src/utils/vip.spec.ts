import { describe, expect, it } from "vitest";
import { vipBadgeLabel } from "./vip";

describe("vipBadgeLabel 会员徽标三态", () => {
  it("无会员（0 / 缺失）不显示徽标", () => {
    expect(vipBadgeLabel(0)).toBeNull();
    expect(vipBadgeLabel(undefined)).toBeNull();
  });

  it("普通会员显示 CVIP（含旧编码 10 / 新编码 100 及未知档位）", () => {
    expect(vipBadgeLabel(10)).toBe("CVIP");
    expect(vipBadgeLabel(100)).toBe("CVIP");
    expect(vipBadgeLabel(21)).toBe("CVIP");
  });

  it("超级会员显示 SVIP（旧编码 11 / 新编码 110）", () => {
    expect(vipBadgeLabel(11)).toBe("SVIP");
    expect(vipBadgeLabel(110)).toBe("SVIP");
  });
});
