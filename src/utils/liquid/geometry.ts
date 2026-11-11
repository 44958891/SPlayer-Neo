import type { LiquidOptions, LiquidPhase } from "./types";
import { clamp, easeInOut, easeOut, lerp, makeRng } from "./math";

/**
 * 液体几何引擎
 *
 * 一到四阶段的配方（全部拼成一条闭合 path，交给 CSS clip-path）：
 *
 *  pour   细长液柱：中心线随高度做正弦摆动（越靠近底部摆幅越大），
 *         柱宽沿高度收细并周期性膨胀；柱身外侧挂 2~3 颗分离液滴。
 *  splash 液柱触底：仍保留柱体，液面出现第一小摊，柱脚两侧甩出 4 条
 *         飞溅弧线（外扩 + 回落）+ 4 颗上行小液滴 + 两道涟漪。
 *  wave   柱体收细退场，底部液面上升：液面用 3 个不同频率/相位的正弦
 *         叠加成起伏轮廓，两端贴住视口侧壁；飞溅渐隐。
 *  done   液面越过视口顶部：路径退化成整屏矩形，随后由调用方提交主题。
 *
 * 所有随机量都由 seed 决定，同一 seed 两帧之间连续，切换窗口尺寸也不会跳。
 */

export interface Geometry {
  /** 联合轮廓（clip-path 用） */
  path: string;
  /** 液面基准 y（视口坐标） */
  surfaceY: number;
  phase: LiquidPhase;
  /** 进度 0..1 */
  progress: number;
}

const TAU = Math.PI * 2;

/** 时间轴分段（占总进度的比例） */
export const TIMELINE = {
  pour: 0.22,
  splash: 0.34,
  wave: 0.94,
  done: 1,
} as const;

export function phaseAt(p: number): LiquidPhase {
  if (p <= 0) return "pour";
  if (p < TIMELINE.pour) return "pour";
  if (p < TIMELINE.splash) return "splash";
  if (p < TIMELINE.wave) return "wave";
  return "done";
}

const n2 = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

/**
 * 液柱中心线 x 偏移：随归一化高度 h（0=顶部起点，1=底部）摆动。
 * 摆动随时间轻微游走，形成"流淌"而不是静止的弯管。
 */
function columnBend(h: number, t: number, seed: number, amp: number): number {
  const a = amp * h * h; // 越靠下摆幅越大（悬垂感）
  return (
    (Math.sin(h * 5.2 - t * 7.4 + seed) * 0.62 +
      Math.sin(h * 11.3 + t * 4.1 + seed * 1.7) * 0.26 +
      Math.sin(h * 2.1 - t * 2.6 + seed * 2.9) * 0.12) *
    a
  );
}

/** 液柱半宽：向底部收细，并叠加沿高度的脉动（粗细变化） */
function columnHalfWidth(h: number, t: number, base: number): number {
  const taper = lerp(1, 0.42, easeInOut(clamp(h * 1.15, 0, 1)));
  const pulse = 1 + Math.sin(h * 9.1 + t * 6.3) * 0.16 + Math.sin(h * 3.7 - t * 4.2) * 0.1;
  // 柱脚略微鼓胀（积液的连接处）
  const root = 1 + Math.pow(clamp((h - 0.86) / 0.14, 0, 1), 2) * 0.55;
  return base * taper * pulse * root;
}

/** 采样液柱左/右轮廓点 */
function columnEdges(
  opts: LiquidOptions,
  t: number,
  length: number,
  baseWidth: number,
): { left: Array<[number, number]>; right: Array<[number, number]> } {
  const { originX, originY, seed = 7 } = opts;
  const N = 26;
  const amp = clamp(baseWidth * 1.15, 6, 30);
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const h = i / N;
    const y = originY + h * length;
    const cx = originX + columnBend(h, t, seed * 0.7, amp);
    const hw = columnHalfWidth(h, t, baseWidth);
    left.push([cx - hw, y]);
    right.push([cx + hw, y]);
  }
  return { left, right };
}

/**
 * 用平滑二次贝塞尔串起一串点（减少锯齿、path 更短）。
 * startWithMove=false 时不写 M 指令，直接接续到已有路径（用于拼左右轮廓）。
 */
function smoothPolyline(pts: Array<[number, number]>, startWithMove = true): string {
  if (pts.length === 0) return "";
  let d = "";
  let i = 0;
  if (startWithMove) {
    d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
    i = 1;
  } else {
    d = `L${n2(pts[0][0])} ${n2(pts[0][1])}`;
    i = 1;
  }
  for (; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    d += `Q${n2(x0)} ${n2(y0)} ${n2(mx)} ${n2(my)}`;
  }
  const last = pts[pts.length - 1];
  d += `L${n2(last[0])} ${n2(last[1])}`;
  return d;
}

/** 单个液滴：以 (cx,cy) 为中心、半径 r 的圆，用两段弧近似 */
function dropPath(cx: number, cy: number, r: number, stretch = 1): string {
  if (r <= 0.15) return "";
  const ry = r * stretch;
  return (
    `M${n2(cx - r)} ${n2(cy)}` +
    `A${n2(r)} ${n2(ry)} 0 1 0 ${n2(cx + r)} ${n2(cy)}` +
    `A${n2(r)} ${n2(ry)} 0 1 0 ${n2(cx - r)} ${n2(cy)}Z`
  );
}

/**
 * 底部液面：波浪轮廓 + 左右壁 + 底部矩形收口。
 * level：液面基准 y；rising：0..1 上涨进度（决定波浪幅度渐强）。
 */
function poolPath(
  width: number,
  height: number,
  level: number,
  t: number,
  seed: number,
  amp: number,
): string {
  const N = 34;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = u * width;
    // 三个不同波长叠加，再乘上「靠中间幅度略大」的包络，避免像弹簧一样均匀
    const envelope = 0.55 + 0.45 * Math.sin(u * Math.PI);
    const w =
      Math.sin(u * TAU * 1.35 + t * 3.4 + seed) * 0.52 +
      Math.sin(u * TAU * 2.7 - t * 2.2 + seed * 1.9) * 0.3 +
      Math.sin(u * TAU * 0.62 + t * 1.35 + seed * 2.7) * 0.18;
    pts.push([x, level + w * amp * envelope]);
  }
  let d = `M0 ${n2(height)}L${n2(pts[0][0])} ${n2(pts[0][1])}`;
  d += smoothPolyline(pts.slice(1), false);
  d += `L${n2(width)} ${n2(height)}Z`;
  return d;
}

/**
 * 主入口：按进度计算几何。
 * 只做纯计算，不读 DOM、不分配大对象，可直接在 rAF 里每帧调用。
 */
export function computeGeometry(opts: LiquidOptions, progress: number, timeMs: number): Geometry {
  const { width, height, originX, originY, seed = 7 } = opts;
  const p = clamp(progress, 0, 1);
  const t = timeMs / 1000;
  const phase = phaseAt(p);

  // 液柱行长：从按钮下缘一路长到视口底部
  const reach = Math.max(60, height - originY);
  const baseWidth = clamp(Math.min(width, height) * 0.016, 5, 13);

  if (phase === "pour") {
    const u = p / TIMELINE.pour;
    const len = reach * easeOut(clamp(u, 0, 1));
    const { left, right } = columnEdges(opts, t, len, baseWidth * lerp(0.72, 1, u));
    // 柱身右侧挂 3 颗分离液滴（随流淌下落，不能越出视口/柱长）
    const drops: string[] = [];
    for (let i = 0; i < 3; i++) {
      const seedI = seed + i * 13.7;
      const cycle = (t * (0.55 + i * 0.18) + i * 0.37) % 1; // 0..1 下落相位
      const hy = clamp(0.18 + i * 0.26 + cycle * 0.22, 0.08, 0.94);
      const dy = originY + hy * len;
      // 液滴必须落在视口内，否则会被裁掉（还会把包围盒撑到视口外）
      if (dy > opts.height - baseWidth) continue;
      const cx =
        originX +
        columnBend(hy, t, seed * 0.7, clamp(baseWidth * 1.15, 6, 30)) +
        baseWidth * (1.25 + 0.6 * Math.sin(seedI + t * 2.1));
      const r = baseWidth * (0.24 + 0.1 * Math.sin(seedI * 1.3));
      drops.push(dropPath(cx, dy, r, 1.35 + 0.25 * Math.sin(seedI + t)));
    }
    const body = smoothPolyline(left) + smoothPolyline([...right].reverse(), false);
    const path = `${body}Z${drops.join("")}`;
    return { path, surfaceY: originY + len, phase, progress: p };
  }

  if (phase === "splash") {
    const u = (p - TIMELINE.pour) / (TIMELINE.splash - TIMELINE.pour);
    // 柱体快速收细但保留，作为"仍在倾倒"的连接
    const colLen = reach * 0.94;
    const widthScale = lerp(1, 0.34, easeOut(u));
    const { left, right } = columnEdges(opts, t, colLen, baseWidth * widthScale);
    // 底部积液先小后大
    const poolRise = easeOut(cadence(u)) * reach * 0.11;
    const level = height - poolRise;
    // 飞溅：4 条向外甩出的弧 + 4 颗上行液滴 + 两道涟漪
    const rng = makeRng(seed * 977 + 13);
    const splashes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      const outward = baseWidth * (2.2 + i * 0.55) * (0.75 + rng() * 0.5);
      const upH = baseWidth * (2.6 + rng() * 2.2);
      const bx = originX + dir * baseWidth * 0.6;
      const by = height - poolRise * 0.75;
      const tipX = bx + dir * outward * easeOut(clamp(u * 1.5, 0, 1));
      const tipY = by - upH * Math.sin(clamp(u, 0, 1) * Math.PI) * 0.9;
      const ctrlX = bx + dir * outward * 0.45;
      const ctrlY = by - upH * 0.95;
      const w = baseWidth * 0.13;
      splashes.push(
        `M${n2(bx)} ${n2(by)}Q${n2(ctrlX)} ${n2(ctrlY)} ${n2(tipX)} ${n2(tipY)}` +
          `Q${n2(ctrlX + dir * w)} ${n2(ctrlY + w)} ${n2(bx + dir * w)} ${n2(by)}Z`,
      );
    }
    const drops: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      const spread = baseWidth * (3.1 + i * 0.8);
      const fly = easeOut(clamp(u * 1.35, 0, 1));
      const arc = Math.sin(clamp(u, 0, 1) * Math.PI);
      const cx = originX + dir * spread * fly;
      const cy = height - poolRise * 0.5 - baseWidth * (3.4 + i * 0.5) * arc;
      if (cy < 0 || cy > height) continue;
      drops.push(dropPath(cx, cy, baseWidth * (0.2 + 0.06 * (i % 2)) * (1 - u * 0.35)));
    }
    // 涟漪：以落点为中心的两圈压扁椭圆
    const rings: string[] = [];
    for (let i = 0; i < 2; i++) {
      const rr = baseWidth * (2.4 + i * 2.1) * (0.35 + easeOut(u) * 0.9);
      const ry = rr * 0.26;
      const cy = height - poolRise * 0.6;
      const cx = originX;
      rings.push(
        `M${n2(cx - rr)} ${n2(cy)}` +
          `A${n2(rr)} ${n2(Math.max(1, ry))} 0 1 0 ${n2(cx + rr)} ${n2(cy)}` +
          `A${n2(rr)} ${n2(Math.max(1, ry))} 0 1 0 ${n2(cx - rr)} ${n2(cy)}Z`,
      );
    }
    const body = smoothPolyline(left) + smoothPolyline([...right].reverse(), false);
    const path =
      `${body}Z` +
      poolPath(width, height, level, t, seed, baseWidth * 1.1) +
      splashes.join("") +
      drops.join("") +
      rings.join("");
    return { path, surfaceY: level, phase, progress: p };
  }

  if (phase === "wave") {
    const u = cadence((p - TIMELINE.splash) / (TIMELINE.wave - TIMELINE.splash));
    // 液面从底部 11% 处一路涨到顶部之上
    const from = height * 0.89;
    const to = -height * 0.06; // 略微越过顶部，保证完全覆盖
    const level = lerp(from, to, easeInOut(u));
    // 柱体在上涨的前 25% 内退场
    const colFade = clamp(1 - u / 0.25, 0, 1);
    let col = "";
    if (colFade > 0.02) {
      const len = Math.max(0, level - originY);
      if (len > 4) {
        const { left, right } = columnEdges(opts, t, len, baseWidth * colFade * 0.9);
        col = smoothPolyline(left) + smoothPolyline([...right].reverse(), false) + "Z";
      }
    }
    const amp = baseWidth * lerp(1.15, 2.3, u);
    const path = col + poolPath(width, height, level, t, seed, amp);
    return { path, surfaceY: level, phase, progress: p };
  }

  // done：整屏覆盖，留一点上边余量避免抗锯齿缝
  const rect = `M0 0H${n2(width)}V${n2(height)}H0Z`;
  return { path: rect, surfaceY: -1, phase: "done", progress: p };
}

/** splash/wave 的节奏曲线：先快后慢，模拟液体黏性 */
function cadence(u: number): number {
  const c = clamp(u, 0, 1);
  return 1 - Math.pow(1 - c, 2.2);
}
