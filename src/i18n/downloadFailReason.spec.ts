import { describe, expect, it } from "vitest";
import zh from "@/i18n/locales/zh-CN.json";
import en from "@/i18n/locales/en-US.json";

/**
 * 下载页失败原因展示：验证每个可能出现的 errorCode 都有对应文案。
 * 未覆盖的码会退化成「未知原因」，用户在下载页看不到具体失败原因。
 */

/** 下载链路可能产生的全部错误码 */
const DOWNLOAD_ERROR_CODES = [
  "DOWNLOAD_QUALITY_NOT_MET",
  "DOWNLOAD_INVALID_FILE",
  "SOURCE_PROBE_REJECTED",
  "NO_PLUGIN_AVAILABLE",
  "URL_RESOLVE_FAILED",
  "NETWORK_ERROR",
  "NETWORK_TIMEOUT",
  "NETEASE_VIP_REQUIRED",
  "NETEASE_TRIAL_DISABLED",
  "NETEASE_UNAVAILABLE",
  "NETEASE_LOGIN_EXPIRED",
  "FILE_NOT_FOUND",
  "FILE_NO_AUDIO_STREAM",
  "FILE_DECODE_ERROR",
  "TAG_WRITE_FAILED",
  "DEVICE_NOT_FOUND",
  "DEVICE_INIT_FAILED",
  "UNKNOWN",
] as const;

const zhReasons = (zh as unknown as { download: { failReason: Record<string, string> } }).download
  .failReason;
const enReasons = (en as unknown as { download: { failReason: Record<string, string> } }).download
  .failReason;

describe("下载失败原因文案", () => {
  it.each(DOWNLOAD_ERROR_CODES)("zh-CN 覆盖 %s", (code) => {
    expect(zhReasons[code], `缺少 download.failReason.${code}`).toBeTruthy();
    expect(zhReasons[code].length).toBeGreaterThan(3);
  });

  it.each(DOWNLOAD_ERROR_CODES)("en-US 覆盖 %s", (code) => {
    expect(enReasons[code], `缺少 download.failReason.${code}`).toBeTruthy();
  });

  it("中英文键集合一致", () => {
    expect(Object.keys(zhReasons).sort()).toEqual(Object.keys(enReasons).sort());
  });

  it("音质不达标文案明确说明「未保存文件」，避免误解为已降级下载", () => {
    expect(zhReasons.DOWNLOAD_QUALITY_NOT_MET).toContain("未保存");
    expect(enReasons.DOWNLOAD_QUALITY_NOT_MET.toLowerCase()).toContain("not saved");
  });

  it("所有文案都不是占位符或原始键名", () => {
    for (const [code, text] of Object.entries(zhReasons)) {
      expect(text).not.toBe(code);
      expect(text).not.toMatch(/^\s*$/);
    }
  });
});
