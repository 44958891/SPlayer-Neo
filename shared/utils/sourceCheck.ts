/**
 * 音源手动体检（共享纯函数）
 *
 * 体检 = 对"插件 × 平台源 × 音质档"逐个用固定测试曲取链 + 探针，
 * 得出该组合「能不能拿到链接」「拿到的链接是不是真音频」「实测码率与声明档位是否相符」。
 *
 * 与下载链路的自动探针（audioProbe.ts）共用判定规则，但多一层
 * 「声明档位 → 期望码率」对照：插件声明母带却给 128k mp3 这类虚报会被标出。
 */

import type { PluginQuality } from "../types/plugin";
import { QUALITY_ORDER } from "./quality";

/** 体检用测试曲（固定曲目保证结果可复现、可跨次比对） */
export interface CheckSong {
  /** 插件侧源 key（wy/tx/kg/kw/mg/sd），用于调用插件取链 */
  source: string;
  /**
   * 宿主侧平台 key（netease/qqmusic/kugou/kuwo/migu/soda），用于组装曲目键
   *
   * 必须与 `resolveByPluginBest` 里的 `${track.source}:${track.id}` 同口径，
   * 否则手动体检写下的结论与自动取链查询的键对不上（两套命名空间各自积累记录）。
   */
  platform: string;
  /** 平台内曲目 ID（不同平台字段名不同，插件要求 songmid / hash / copyrightId 等全带） */
  songmid: string;
  /** kugou 特有的 hash（部分插件只认 hash） */
  hash?: string;
  /** migu 特有的版权 ID */
  copyrightId?: string;
  name: string;
  singer: string;
  /** "mm:ss"，插件按此声明歌曲时长 */
  interval: string;
  /** 歌曲秒数，用于体积 / 码率反推 */
  durationSec: number;
}

/**
 * 各平台测试曲
 *
 * 选取原则：各插件都覆盖到的常见曲目，且实测能取到链接（否则体检全红无参考价值）。
 * 已实测可用（2026-10-14）：wy 起风了 / tx 晴天 / kg 演员 / kw 晴天 / mg 晴天。
 */
export const CHECK_SONGS: Record<string, CheckSong> = {
  wy: {
    source: "wy",
    platform: "netease",
    songmid: "1330348068",
    name: "起风了",
    singer: "买辣椒也用券",
    interval: "05:25",
    durationSec: 325,
  },
  tx: {
    source: "tx",
    platform: "qqmusic",
    songmid: "0039MnYb0qxYhV",
    name: "晴天",
    singer: "周杰伦",
    interval: "04:29",
    durationSec: 269,
  },
  kg: {
    source: "kg",
    platform: "kugou",
    songmid: "097e777171f692855eae98b6965f9477",
    hash: "097e777171f692855eae98b6965f9477",
    name: "演员",
    singer: "薛之谦",
    interval: "04:21",
    durationSec: 261,
  },
  kw: {
    source: "kw",
    platform: "kuwo",
    songmid: "228908",
    name: "晴天",
    singer: "周杰伦",
    interval: "04:29",
    durationSec: 269,
  },
  mg: {
    source: "mg",
    platform: "migu",
    songmid: "600902000006889366",
    copyrightId: "60054701923",
    name: "晴天",
    singer: "周杰伦",
    interval: "04:29",
    durationSec: 269,
  },
  sd: {
    source: "sd",
    platform: "soda",
    songmid: "7677974949729945634",
    hash: "7677974949729945634",
    name: "晴天",
    singer: "周杰伦",
    interval: "02:35",
    durationSec: 155,
  },
};

/**
 * 组装体检曲目键（与取链路径同口径）
 * @param song - 测试曲
 */
export const checkSongKey = (song: CheckSong): string => `${song.platform}:${song.songmid}`;

/**
 * 选定某源要体检的档位：最高档 + 无损档（若声明的档位多于 2 个）
 *
 * 只测两个代表档位而非全档，避免体检过慢（全档 60+ 点需 20s+）；
 * 最高档能暴露"虚报"问题，无损档能反映常见下载档位的可用性。
 *
 * 按档位真实高低排序取值，不依赖插件声明数组的顺序
 * （实测有插件把 sq 写在列表末尾，按位置取会把最低档当最高档）。
 * @param qualitys - 插件为该源声明的档位列表
 * @returns 去重后的待测档位（最多 2 个）
 */
export const pickCheckQualities = (qualitys: PluginQuality[]): PluginQuality[] => {
  const ranked = [...new Set((qualitys ?? []).filter(Boolean))].sort(
    (a, b) => QUALITY_ORDER.indexOf(b) - QUALITY_ORDER.indexOf(a),
  );
  if (ranked.length <= 2) return ranked;
  const out: PluginQuality[] = [ranked[0]];
  const lossless = ranked.find((q) => q === "lossless");
  if (lossless && lossless !== ranked[0]) out.push(lossless);
  // 声明的档位里没有 lossless（如仅 lq/hq）时取次高档，保证有第二个测试点
  else if (ranked[1]) out.push(ranked[1]);
  return out;
};

/** 平台源展示名（体检报告用） */
export const SOURCE_LABELS: Record<string, string> = {
  wy: "网易云",
  tx: "QQ音乐",
  kg: "酷狗",
  kw: "酷我",
  mg: "咪咕",
  sd: "汽水",
  git: "GitHub",
};

/**
 * 各声明档位的期望最低码率（bps）
 *
 * 仅用于报告里标"疑似虚报"，不参与下载拒绝判定——阈值取得保守，
 * 只抓明显降档（声明无损却给 128k/320k mp3 这类）。
 */
export const MIN_BPS_BY_QUALITY: Record<PluginQuality, number> = {
  lq: 32_000,
  sq: 96_000,
  hq: 160_000,
  lossless: 400_000,
  "hi-res": 400_000,
  jyeffect: 400_000,
  sky: 400_000,
  jymaster: 400_000,
};

/** 单点体检结论 */
export type CheckPointStatus = "ok" | "mismatch" | "hard" | "soft" | "unsupported";

/** 单点体检结果 */
export interface CheckPointResult {
  pluginId: string;
  source: string;
  quality: PluginQuality;
  status: CheckPointStatus;
  /** 人类可读说明（ok 时为空） */
  message: string;
  /** 实测完整体积（字节）；未知为 0 */
  sizeBytes: number;
  /** 由体积与时长反推的平均码率（bps）；无法反推为 0 */
  probedBps: number;
  /** 取链耗时（毫秒） */
  linkMs: number;
  /** 探针耗时（毫秒） */
  probeMs: number;
}

/**
 * 由体积与时长反推平均码率
 * @param sizeBytes - 完整体积
 * @param durationSec - 歌曲秒数
 * @returns 码率（bps），无法计算返回 0
 */
export const estimateBps = (sizeBytes: number, durationSec: number): number => {
  if (sizeBytes <= 0 || durationSec <= 0) return 0;
  return Math.round((sizeBytes * 8) / durationSec);
};

/**
 * 判定实测码率与声明档位是否相符
 * @param declared - 插件声明的档位
 * @param probedBps - 实测反推码率；0 表示无法反推（跳过判定）
 * @returns 不相符时返回提示文案，相符返回空串
 */
export const judgeBitrateMismatch = (declared: PluginQuality, probedBps: number): string => {
  if (probedBps <= 0) return "";
  const floor = MIN_BPS_BY_QUALITY[declared] ?? 0;
  if (floor <= 0 || probedBps >= floor) return "";
  const kbps = Math.round(probedBps / 1000);
  const floorKbps = Math.round(floor / 1000);
  return `声明 ${declared}（应 ≥${floorKbps}kbps），实测约 ${kbps}kbps`;
};

/** 体检整体统计 */
export interface CheckSummary {
  total: number;
  ok: number;
  mismatch: number;
  hard: number;
  soft: number;
  unsupported: number;
}

/**
 * 汇总体检点结果
 * @param points - 单点结果列表
 */
export const summarizeChecks = (points: CheckPointResult[]): CheckSummary => {
  const summary: CheckSummary = {
    total: points.length,
    ok: 0,
    mismatch: 0,
    hard: 0,
    soft: 0,
    unsupported: 0,
  };
  for (const point of points ?? []) {
    if (point.status in summary) summary[point.status]++;
  }
  return summary;
};
