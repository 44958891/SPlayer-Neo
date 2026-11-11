/** 主题模式 */
export type ThemeMode = "light" | "dark";

/** 动画阶段，与音效触发点一一对应 */
export type LiquidPhase =
  | "idle"
  | "pour" // 液柱流出
  | "splash" // 落底飞溅
  | "wave" // 底部积聚并上涨
  | "done"; // 覆盖完成

/** 引擎每帧输出给消费方的状态 */
export interface LiquidFrame {
  phase: LiquidPhase;
  /** 0..1 总进度 */
  progress: number;
  /** 当前用于 clip-path 的 SVG path 数据 */
  path: string;
  /** 液面基准 y（px，viewport 坐标） */
  surfaceY: number;
  /** 是否还有可见液体 */
  visible: boolean;
}

export interface LiquidOptions {
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** 总时长 ms */
  duration: number;
  seed?: number;
}

/** 音效适配接口：调用方可用自己的实现替换 */
export interface LiquidSoundAdapter {
  /** 阶段进入时触发一次。phase ∈ pour | splash | done */
  onPhase(phase: "pour" | "splash" | "done", to: ThemeMode): void;
  /** wave 阶段连续流水强度 0..1，0 表示停止 */
  setWaveLevel(level: number, to: ThemeMode): void;
  /** 立即停止所有声音（中断/卸载/后台） */
  stopAll(): void;
  readonly enabled: boolean;
}

export interface LiquidController {
  start(opts: LiquidOptions, sound?: LiquidSoundAdapter | null, to?: ThemeMode): boolean;
  cancel(): void;
  readonly frame: LiquidFrame;
  readonly running: boolean;
  subscribe(cb: (f: LiquidFrame) => void): () => void;
  onFinish?: () => void;
}
