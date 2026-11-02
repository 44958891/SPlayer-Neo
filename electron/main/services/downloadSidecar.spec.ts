import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 音质升级替换原文件时的侧文件清理规则
 *
 * 升级只换扩展名，新旧文件同基名；若按基名无条件删附档，
 * 会把刚为新文件写好的 .lrc/.ttml 一起删掉。
 */

/** 与 downloadManager 内的判断保持一致 */
const shouldDeleteSidecars = (oldAudio: string, newAudio: string): boolean => {
  const base = (p: string): string => p.slice(0, p.length - path.extname(p).length);
  return base(oldAudio) !== base(newAudio);
};

describe("音质升级侧文件清理", () => {
  it("同基名（只换扩展名）时不删，避免删掉新写的歌词", () => {
    expect(shouldDeleteSidecars(path.join("m", "a.mp3"), path.join("m", "a.flac"))).toBe(false);
    expect(shouldDeleteSidecars("/m/a.flac", "/m/a.flac")).toBe(false);
  });

  it("不同曲目名时才清理旧附档", () => {
    expect(shouldDeleteSidecars(path.join("m", "old.mp3"), path.join("m", "new.flac"))).toBe(true);
  });
});
