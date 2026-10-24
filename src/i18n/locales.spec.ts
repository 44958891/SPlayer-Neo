import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

/**
 * i18n 键完整性守卫
 *
 * 新增弹窗/页面时最容易漏的一步是往语言包里补文案：vue-i18n 找不到键会直接
 * 把 `library.upgrade.title` 这类裸 key 渲染到界面上，只在打开那个弹窗时才暴露。
 * 这个测试静态扫描全仓用到的键，缺一个就失败，把「打开界面才发现」提前到 CI。
 */

/** 仓库根目录（vitest 从仓库根启动） */
const ROOT = process.cwd();

/** 参与扫描的目录 */
const SCAN_DIRS = ["src", "windows", "electron", "shared"];

/** 跳过的目录与文件 */
const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".git", "build", "target"]);

/** 键的使用形式：t("a.b") / $t('a.b') / i18n.global.t(`a.${x}`) / labelKey: "a.b" */
const PATTERNS: RegExp[] = [
  /\bt\(\s*(["'])([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)\1/g,
  /\$t\(\s*(["'])([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)\1/g,
  /\b(?:labelKey|titleKey|descKey|placeholderKey|hintKey)\s*:\s*(["'])([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)\1/g,
];

/** 动态键：t(`player.repeatMode.${mode}`)，只校验静态前缀是个存在的命名空间 */
const DYNAMIC_PATTERN = /\bt\(\s*`([^`$]*)\$\{/g;

type Messages = Record<string, unknown>;

/** 取出全部叶子键路径 */
const leafKeys = (messages: Messages, prefix = "", out = new Set<string>()): Set<string> => {
  for (const [key, value] of Object.entries(messages)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      leafKeys(value as Messages, full, out);
    } else {
      out.add(full);
    }
  }
  return out;
};

/** 键是否存在（叶子） */
const hasKey = (messages: Messages, key: string): boolean =>
  key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Messages)[part];
  }, messages) !== undefined;

/** 该路径下是否至少有一个叶子（用于动态键的静态前缀） */
const hasNamespace = (messages: Messages, prefix: string): boolean => {
  const node = prefix.split(".").reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Messages)[part];
  }, messages);
  if (node === undefined) return false;
  if (typeof node !== "object" || node === null) return true;
  return leafKeys(node as Messages).size > 0;
};

/** 递归收集待扫描文件 */
const collectFiles = (dir: string, out: string[] = []): string[] => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), out);
    } else if (/\.(vue|ts)$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name)) {
      out.push(path.join(ROOT, dir, entry.name));
    }
  }
  return out;
};

interface Usage {
  key: string;
  file: string;
  line: number;
}

/** 扫描全部静态键用法 */
const scanUsages = (): { static: Usage[]; dynamic: Usage[] } => {
  const statics: Usage[] = [];
  const dynamics: Usage[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      lines.forEach((text, index) => {
        for (const pattern of PATTERNS) {
          pattern.lastIndex = 0;
          let match = pattern.exec(text);
          while (match) {
            statics.push({ key: match[2], file: rel, line: index + 1 });
            match = pattern.exec(text);
          }
        }
        DYNAMIC_PATTERN.lastIndex = 0;
        let dyn = DYNAMIC_PATTERN.exec(text);
        while (dyn) {
          // 静态前缀去掉结尾的点，作为命名空间校验
          const prefix = dyn[1].replace(/\.$/, "");
          if (prefix) dynamics.push({ key: prefix, file: rel, line: index + 1 });
          dyn = DYNAMIC_PATTERN.exec(text);
        }
      });
    }
  }
  return { static: statics, dynamic: dynamics };
};

/** 去重并格式化为「键 ← 首个引用位置」 */
const groupByKey = (usages: Usage[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const usage of usages) {
    if (!map.has(usage.key)) map.set(usage.key, `${usage.file}:${usage.line}`);
  }
  return map;
};

const zhMessages = zhCN as Messages;
const enMessages = enUS as Messages;
const zhLeaves = leafKeys(zhMessages);
const enLeaves = leafKeys(enMessages);
const { static: staticUsages, dynamic: dynamicUsages } = scanUsages();

describe("i18n 语言包", () => {
  it("中英文键集合一致（新增文案必须同时补两份）", () => {
    const onlyZh = [...zhLeaves].filter((key) => !enLeaves.has(key)).sort();
    const onlyEn = [...enLeaves].filter((key) => !zhLeaves.has(key)).sort();
    expect(
      { 仅中文有: onlyZh, 仅英文有: onlyEn },
      "语言包键集合不一致：缺的一方会被 fallback 到另一种语言，或直接显示英文",
    ).toEqual({ 仅中文有: [], 仅英文有: [] });
  });

  it("代码里用到的静态键在中文语言包中都存在", () => {
    const missing = [...groupByKey(staticUsages)]
      .filter(([key]) => !hasKey(zhMessages, key))
      .map(([key, where]) => `${key}  ← ${where}`)
      .sort();
    expect(missing, `中文语言包缺少 ${missing.length} 个键（界面会显示裸 key）`).toEqual([]);
  });

  it("代码里用到的静态键在英文语言包中都存在", () => {
    const missing = [...groupByKey(staticUsages)]
      .filter(([key]) => !hasKey(enMessages, key))
      .map(([key, where]) => `${key}  ← ${where}`)
      .sort();
    expect(missing, `英文语言包缺少 ${missing.length} 个键`).toEqual([]);
  });

  it("动态键的静态前缀是存在的命名空间", () => {
    const missing = [...groupByKey(dynamicUsages)]
      .filter(([prefix]) => !hasNamespace(zhMessages, prefix))
      .map(([prefix, where]) => `${prefix}.*  ← ${where}`)
      .sort();
    expect(missing, "动态键前缀不存在，拼接后会渲染成裸 key").toEqual([]);
  });
});
