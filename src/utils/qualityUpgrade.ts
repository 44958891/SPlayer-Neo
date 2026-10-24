/**
 * 本地音乐音质升级的纯函数工具
 * 匹配规则与路径处理独立成模块，便于单测
 *
 * 匹配算法借鉴 GZ Music 的跨平台候选打分与版本词黑名单：
 * - 版本词（live/cover/remix/伴奏…）候选在本地曲名不含版本词时直接排除，
 *   避免"本地原版被换成 Live 版/翻唱版"
 * - 分层打分：标题完全一致 + 艺术家全匹配 > 标题去括号一致 + 全匹配 >
 *   标题一致 + 部分包含 > 去括号一致 + 部分包含，同分按时长差排序取最优
 */
import type { Track } from "@shared/types/player";

/** 标点归一：去掉除字母/数字/汉字外的一切，转小写 */
export const normalizeBase = (value: string): string =>
  (value ?? "")
    .replace(/[^\w\u4e00-\u9fff]/g, "")
    .toLowerCase()
    .trim();

/** 标题归一：去括号/方括号内容与空白后转小写（用于同曲判定） */
export const normalizeTitle = (value: string): string =>
  (value ?? "")
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/[【[][^】]]*[】]]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();

/**
 * 版本词黑名单正则：候选标题命中即视为"非原版演绎"
 *
 * 两种形态：
 * 1. 括号内含版本词（长度不限，如 `(Live版)` `（伴奏）` `(Cover 蓝心羽)` `(Remix)`）
 * 2. 裸写的 cover / 翻唱 / 翻自
 * 拉丁词用前后非字母界定，避免 Alive/Remixer 之类误伤
 */
const LATIN_VERSION_RE = /(?<![a-z])(live|demo|dj|remix|mix|cover|karaoke|instrumental)(?![a-z])/i;
const CN_VERSION_RE = /(伴奏|纯音乐|背景音乐|铃声|现场|翻唱|翻自|重制|重置|加速|降速|卡拉ok)/;
const BRACKET_RE = /[（(][^）)]*[）)]/g;

/** 标题是否含版本词 */
export const hasVersionWord = (title: string): boolean => {
  const value = title ?? "";
  if (/\b(cover|翻唱|翻自)\b/i.test(value.replace(/[（(][^）)]*[）)]/g, ""))) return true;
  const brackets = value.match(BRACKET_RE) ?? [];
  for (const bracket of brackets) {
    if (LATIN_VERSION_RE.test(bracket) || CN_VERSION_RE.test(bracket)) return true;
  }
  return false;
};

/** 拆分艺术家名并归一（按 / 、 , & 等分隔符切开） */
const artistTokens = (artists: { name: string }[]): string[] =>
  (artists ?? [])
    .flatMap((artist) => String(artist?.name ?? "").split(/[/、,&＋+]|\s+&\s+/))
    .map((name) => normalizeBase(name))
    .filter(Boolean);

/** 艺术家匹配等级：2=全匹配；1=一方包含另一方；0=不匹配 */
const artistLevel = (local: Track, online: Track): number => {
  const a = artistTokens(local.artists ?? []);
  const b = artistTokens(online.artists ?? []);
  if (a.length === 0 || b.length === 0) return 0;
  const allAHit = a.every((name) => b.includes(name));
  const allBHit = b.every((name) => a.includes(name));
  if (a.length === b.length && allAHit) return 2;
  if (allAHit || allBHit) return 1;
  return 0;
};

/** 时长窗口（毫秒）：超过视作不同版本 */
const DURATION_WINDOW_MS = 5_000;

/** 候选评分结果 */
export interface UpgradeMatchCandidate {
  online: Track;
  /** 分层得分：3 / 2 / 1.5 / 1.4（0 表示不合格，不出现在结果里） */
  score: number;
}

/**
 * 为本地曲目挑选最优在线升级候选
 * @param local - 本地曲目
 * @param candidates - 在线搜索结果
 * @returns 依得分、时长差排序的候选列表（已过滤不合格项）
 */
export const rankUpgradeCandidates = (
  local: Track,
  candidates: Track[],
): UpgradeMatchCandidate[] => {
  const localTitle = normalizeBase(local.title);
  const localBase = normalizeTitle(local.title);
  const localHasVersion = hasVersionWord(local.title);
  const out: UpgradeMatchCandidate[] = [];
  for (const online of candidates ?? []) {
    if (!online?.title) continue;
    // 时长门槛：任一方缺时长时放行（升级场景通常双方都有时长）
    if (local.duration > 0 && online.duration > 0) {
      if (Math.abs(local.duration - online.duration) > DURATION_WINDOW_MS) continue;
    }
    // 版本词黑名单：本地是原版而候选带版本词 → 排除（此前下错 Live/Cover 的根因）
    if (!localHasVersion && hasVersionWord(online.title)) continue;
    const titleExact = normalizeBase(online.title) === localTitle;
    const baseExact = normalizeTitle(online.title) === localBase;
    const level = artistLevel(local, online);
    let score = 0;
    if (titleExact && level === 2) score = 3;
    else if (baseExact && level === 2) score = 2;
    else if (titleExact && level === 1) score = 1.5;
    else if (baseExact && level === 1) score = 1.4;
    if (score === 0) continue;
    out.push({ online, score });
  }
  return out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = local.duration > 0 ? Math.abs(local.duration - a.online.duration) : 0;
    const db = local.duration > 0 ? Math.abs(local.duration - b.online.duration) : 0;
    return da - db;
  });
};

/**
 * 在线搜索结果中找出与本地曲目同曲的最优匹配项
 * 标题一致（忽略大小写/空白/括号）+ 歌手重合 + 时长 ±5s 内（缺时长视为通过）
 * @param local - 本地曲目
 * @param candidates - 在线搜索结果
 */
export const findUpgradeMatch = (local: Track, candidates: Track[]): Track | undefined =>
  rankUpgradeCandidates(local, candidates)[0]?.online;

/** 渲染层无 node:path，按分隔符取目录（盘符根目录保留分隔符） */
export const pathDirName = (filePath: string): string => {
  const idx = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  if (idx <= 0) return filePath;
  const dir = filePath.slice(0, idx);
  return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir;
};

/** 取小写扩展名（含点；无扩展名返回整串，调用方仅对含扩展名的路径使用） */
export const pathExt = (filePath: string): string =>
  filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
