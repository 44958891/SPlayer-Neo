import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * 下载落位路径决策
 *
 * 关键约束：升级任务可以覆盖「被替换的那个文件」，但不能误伤同目录同基名的
 * 另一个文件（典型场景：用户同时保留了 a.mp3 与原版 a.flac）。
 */

/** 与 downloadManager 内的决策保持一致（dedupePath 仅在冲突时追加序号） */
const decideFinalPath = (
  finalNoExt: string,
  finalExt: string,
  policy: string,
  replaceSource: string | null,
  exists: (p: string) => boolean,
): string => {
  const desired = `${finalNoExt}${finalExt}`;
  const mustRename = policy !== "overwrite" || (desired !== replaceSource && exists(desired));
  if (!mustRename) return desired;
  let target = desired;
  for (let seq = 2; exists(target); seq++) target = `${finalNoExt} (${seq})${finalExt}`;
  return target;
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-path-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const touch = (name: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "x");
  return p;
};

describe("下载落位路径", () => {
  it("普通下载空目录直接用目标名", () => {
    const target = path.join(dir, "a");
    expect(decideFinalPath(target, ".flac", "rename", null, (p) => fs.existsSync(p))).toBe(
      `${target}.flac`,
    );
  });

  it("普通下载遇到同名文件时追加序号", () => {
    const target = path.join(dir, "a");
    touch("a.flac");
    expect(decideFinalPath(target, ".flac", "rename", null, (p) => fs.existsSync(p))).toBe(
      `${target} (2).flac`,
    );
  });

  it("升级任务可以覆盖被替换的那个文件", () => {
    const target = path.join(dir, "a");
    const old = touch("a.flac");
    expect(decideFinalPath(target, ".flac", "overwrite", old, (p) => fs.existsSync(p))).toBe(old);
  });

  it("升级任务不改扩展名时同样覆盖原文件", () => {
    const target = path.join(dir, "a");
    const old = touch("a.mp3");
    expect(decideFinalPath(target, ".mp3", "overwrite", old, (p) => fs.existsSync(p))).toBe(old);
  });

  it("升级导致扩展名变化且已存在同基名文件时不覆盖它", () => {
    const target = path.join(dir, "a");
    touch("a.flac"); // 用户保留的另一版本
    const old = touch("a.mp3"); // 被升级的那个
    const picked = decideFinalPath(target, ".flac", "overwrite", old, (p) => fs.existsSync(p));
    expect(picked).toBe(`${target} (2).flac`);
    expect(fs.existsSync(old)).toBe(true);
  });
});
