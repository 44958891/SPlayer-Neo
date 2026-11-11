import { computeGeometry, phaseAt } from "./geometry";
import type {
  LiquidController,
  LiquidFrame,
  LiquidOptions,
  LiquidPhase,
  LiquidSoundAdapter,
  ThemeMode,
} from "./types";

/**
 * 液体揭示驱动器（Vue 版，与 React 版同逻辑）
 *  - 时间基准 performance.now() 差值，掉帧不拉长动画
 *  - 不碰 DOM：只产出 LiquidFrame，由调用方写 SVG 属性
 *  - 阶段去重派发 onPhase；wave 阶段每帧 setWaveLevel
 *  - cancel 停 rAF + stopAll，不误播 done
 */
export function createLiquidController(): LiquidController {
  let opts: LiquidOptions | null = null;
  let raf = 0;
  let startedAt = 0;
  let running = false;
  let sound: LiquidSoundAdapter | null = null;
  let target: ThemeMode = "dark";
  let lastPhase: LiquidPhase = "idle";
  let frame: LiquidFrame = { phase: "idle", progress: 0, path: "", surfaceY: 0, visible: false };
  const listeners = new Set<(f: LiquidFrame) => void>();
  let finishCb: (() => void) | undefined;

  const emit = (f: LiquidFrame): void => {
    frame = f;
    listeners.forEach((cb) => {
      try {
        cb(f);
      } catch {
        /* 忽略 */
      }
    });
  };

  const dispatchPhase = (phase: LiquidPhase): void => {
    if (!sound?.enabled || phase === lastPhase) {
      lastPhase = phase;
      return;
    }
    lastPhase = phase;
    try {
      if (phase === "pour") sound.onPhase("pour", target);
      else if (phase === "splash") sound.onPhase("splash", target);
    } catch {
      /* 忽略 */
    }
  };

  const syncWave = (phase: LiquidPhase, progress: number): void => {
    if (!sound?.enabled) return;
    try {
      if (phase === "wave") {
        const u = Math.min(1, Math.max(0, (progress - 0.34) / 0.6));
        const level = Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.85) * 0.85;
        sound.setWaveLevel(level, target);
      } else {
        sound.setWaveLevel(0, target);
      }
    } catch {
      /* 忽略 */
    }
  };

  const tick = (now: number): void => {
    if (!running || !opts) return;
    const p = Math.min(1, (now - startedAt) / opts.duration);
    const phase = phaseAt(p);
    const geo = computeGeometry(opts, p, now - startedAt);
    dispatchPhase(phase);
    syncWave(phase, p);
    emit({ phase: geo.phase, progress: p, path: geo.path, surfaceY: geo.surfaceY, visible: p < 1 });
    if (p >= 1) {
      running = false;
      try {
        if (sound?.enabled) sound.onPhase("done", target);
        sound?.setWaveLevel(0, target);
      } catch {
        /* 忽略 */
      }
      raf = 0;
      finishCb?.();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const controller: LiquidController = {
    start(o: LiquidOptions, s?: LiquidSoundAdapter | null, to: ThemeMode = "dark") {
      if (running) return false;
      if (typeof requestAnimationFrame !== "function") return false;
      opts = o;
      sound = s ?? null;
      target = to;
      lastPhase = "idle";
      startedAt = performance.now();
      running = true;
      const first = computeGeometry(opts, 0, 0);
      dispatchPhase("pour");
      emit({
        phase: first.phase,
        progress: 0,
        path: first.path,
        surfaceY: first.surfaceY,
        visible: true,
      });
      raf = requestAnimationFrame(tick);
      return true;
    },
    cancel() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const was = running;
      running = false;
      try {
        sound?.setWaveLevel(0, target);
        if (was) sound?.stopAll();
      } catch {
        /* 忽略 */
      }
      lastPhase = "idle";
      emit({ phase: "idle", progress: 0, path: "", surfaceY: 0, visible: false });
    },
    get frame() {
      return frame;
    },
    get running() {
      return running;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get onFinish() {
      return finishCb;
    },
    set onFinish(fn: (() => void) | undefined) {
      finishCb = fn;
    },
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (running) controller.cancel();
        else {
          try {
            sound?.stopAll();
          } catch {
            /* 忽略 */
          }
        }
      }
    });
  }
  return controller;
}
