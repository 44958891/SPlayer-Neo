#!/usr/bin/env tsx

/**
 * SPlayer Neo 版本号推进
 *
 * 版本策略：正式版之间用 beta 累积，累积够了再提升为正式版。
 * - `beta`         1.0.0 → 1.1.0-beta.1，1.1.0-beta.1 → 1.1.0-beta.2
 * - `beta --patch` 1.0.0 → 1.0.1-beta.1（仅修 bug、不引入新功能的补丁线）
 * - `promote`      1.1.0-beta.10 → 1.1.0（发布正式版，去掉 beta 后缀）
 *
 * 只改 package.json 的 version，不动 CHANGELOG；改完请手动补一条更新记录。
 */

import fs from "node:fs";
import path from "node:path";

/** 包描述文件绝对路径 */
const pkgPath = path.join(process.cwd(), "package.json");

/** 匹配 主.次.修订 或 主.次.修订-beta.N */
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

interface ParsedVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

/**
 * 读取并解析当前版本
 * @returns 解析后的版本号
 */
const readVersion = (): ParsedVersion => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
  const match = VERSION_RE.exec(pkg.version);
  if (!match) {
    console.error(`无法识别的版本号: ${pkg.version}（只支持 x.y.z 或 x.y.z-beta.N）`);
    process.exit(1);
  }
  return {
    raw: pkg.version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    beta: match[4] === undefined ? null : Number(match[4]),
  };
};

/**
 * 写回版本号（保持原有缩进与结尾换行）
 * @param version - 新版本号
 */
const writeVersion = (version: string): void => {
  const raw = fs.readFileSync(pkgPath, "utf8");
  const next = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  if (next === raw) throw new Error("package.json 中未找到 version 字段");
  fs.writeFileSync(pkgPath, next);
};

const args = process.argv.slice(2);
const command = args[0];
const current = readVersion();
let next: string;

if (command === "beta") {
  const patchLine = args.includes("--patch");
  if (current.beta !== null) {
    // 已在 beta 线上：只递增 beta 序号
    next = `${current.major}.${current.minor}.${current.patch}-beta.${current.beta + 1}`;
  } else if (patchLine) {
    next = `${current.major}.${current.minor}.${current.patch + 1}-beta.1`;
  } else {
    next = `${current.major}.${current.minor + 1}.0-beta.1`;
  }
} else if (command === "promote") {
  if (current.beta === null) {
    console.error(`当前已是正式版 ${current.raw}，无需提升`);
    process.exit(1);
  }
  next = `${current.major}.${current.minor}.${current.patch}`;
} else {
  console.error("用法: pnpm version:beta | pnpm version:beta:patch | pnpm version:promote");
  process.exit(1);
}

writeVersion(next);
console.log(`${current.raw} → ${next}`);
