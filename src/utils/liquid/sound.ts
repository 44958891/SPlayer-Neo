import type { LiquidSoundAdapter, ThemeMode } from "./types";

/**
 * 液体音效（Web Audio 本地合成，无外部音频文件）
 *
 * 四个阶段的声音设计：
 *  - pour   滴落：短促带下滑音的正弦 + 高通噪声"唇齿"感，40~120ms
 *  - splash 水花：短噪声爆发 + 带通扫频，制造"啪—哗"的瞬时质感
 *  - wave   流水：白噪声 → 带通 + 慢速 LFO 调制的连续底噪，音量随进度
 *  - done   收尾：两个柔和正弦（纯五度）做 180ms 衰减
 *
 * 深浅方向不同音色：
 *  - 转深色（light→dark）低沉：整体降一个八度，低通更重
 *  - 转浅色（dark→light）清亮：升高五度左右，噪声带通上移
 *
 * 实现约束（全部遵守）：
 *  - 构造时不建 AudioContext，只在首次交互后 resume（浏览器策略）
 *  - 所有节点用完即 disconnect，避免碎片累积
 *  - 静音/音量 0/后台/卸载都走 stopAll()，不留长音
 *  - 任何异常都被吞掉：主题切换不依赖音频成功
 */

export interface SoundSettings {
  enabled: boolean;
  /** 0..1 主音量 */
  volume: number;
}

const STORAGE_KEY = "ltr.sound";

export function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SoundSettings>;
      return {
        enabled: p.enabled === true,
        volume: typeof p.volume === "number" ? clamp01(p.volume) : 0.5,
      };
    }
  } catch {
    /* 忽略 */
  }
  // 默认关闭
  return { enabled: false, volume: 0.5 };
}

export function saveSoundSettings(s: SoundSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class LiquidSynth implements LiquidSoundAdapter {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private waveSource: AudioBufferSourceNode | null = null;
  private waveGain: GainNode | null = null;
  private waveFilter: BiquadFilterNode | null = null;
  private waveLfo: OscillatorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: SoundSettings;
  private waveStarted = false;
  private lastWaveLevel = -1;
  private disposed = false;

  constructor(settings: SoundSettings) {
    this.settings = { ...settings };
  }

  get enabled(): boolean {
    return this.settings.enabled && this.settings.volume > 0;
  }

  /** 更新设置（开关/音量）。音量变化实时反映到 master */
  update(settings: SoundSettings): void {
    this.settings = { ...settings };
    if (!this.enabled) this.stopAll();
    else if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.settings.volume * 0.55, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * 必须在用户手势里调用（按钮点击/键盘）。
   * 走 resume() 而不是每次 new AudioContext，避免多个上下文。
   */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.settings.volume * 0.55;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoise(this.ctx, 2);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  onPhase(phase: "pour" | "splash" | "done", to: ThemeMode): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    try {
      if (phase === "pour") this.playPour(ctx, to);
      else if (phase === "splash") this.playSplash(ctx, to);
      else if (phase === "done") this.playDone(ctx, to);
    } catch {
      /* 音频失败不影响主题 */
    }
  }

  setWaveLevel(level: number, to: ThemeMode): void {
    if (!this.enabled) {
      this.stopWave();
      return;
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const target = clamp01(level);
    if (target <= 0.001) {
      this.stopWave();
      return;
    }
    // 每帧都调 setTargetAtTime 会在音频线程排队大量自动化事件，反而造成卡顿。
    // 只在响度真的变化超过 1.5% 时才下发；听感无差别，开销降到 1/5 以下。
    if (this.waveStarted && Math.abs(target - this.lastWaveLevel) < 0.015) return;
    this.lastWaveLevel = target;
    try {
      if (!this.waveStarted) this.startWave(ctx, to);
      const base = to === "dark" ? 520 : 1250; // 深色更闷
      const t = ctx.currentTime;
      this.waveGain?.gain.setTargetAtTime(target * 0.055, t, 0.12);
      this.waveFilter?.frequency.setTargetAtTime(base * (0.82 + target * 0.4), t, 0.15);
    } catch {
      /* 忽略 */
    }
  }

  stopAll(): void {
    this.stopWave();
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
    try {
      this.master?.disconnect();
    } catch {
      /* 忽略 */
    }
    this.master = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.noiseBuffer = null;
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        /* 忽略 */
      }
    }
  }

  // ---------------- 具体音色 ----------------

  /** 滴落：带下滑音的正弦 + 极短噪声瞬态 */
  private playPour(ctx: AudioContext, to: ThemeMode): void {
    const t = ctx.currentTime;
    const f0 = to === "dark" ? 360 : 620;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 200;
    osc.type = "sine";
    osc.frequency.setValueAtTime(f0 * 1.9, t);
    osc.frequency.exponentialRampToValueAtTime(f0, t + 0.16);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
    osc.connect(hp).connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.26);
    osc.onended = () => {
      try {
        osc.disconnect();
        hp.disconnect();
        g.disconnect();
      } catch {
        /* 忽略 */
      }
    };

    // 唇齿：短噪声
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = to === "dark" ? 900 : 1800;
      bp.Q.value = 1.4;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.16, t);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      src.connect(bp).connect(ng).connect(this.master!);
      src.start(t);
      src.stop(t + 0.1);
      src.onended = () => {
        try {
          src.disconnect();
          bp.disconnect();
          ng.disconnect();
        } catch {
          /* 忽略 */
        }
      };
    }
  }

  /** 水花：噪声爆发 + 带通中心下扫 */
  private playSplash(ctx: AudioContext, to: ThemeMode): void {
    if (!this.noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    const c0 = to === "dark" ? 1500 : 2600;
    bp.frequency.setValueAtTime(c0, t);
    bp.frequency.exponentialRampToValueAtTime(c0 * 0.35, t + 0.34);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.4);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.42);
    src.onended = () => {
      try {
        src.disconnect();
        bp.disconnect();
        g.disconnect();
      } catch {
        /* 忽略 */
      }
    };
  }

  /** 收尾：两个柔和音（纯五度）短衰减 */
  private playDone(ctx: AudioContext, to: ThemeMode): void {
    const t = ctx.currentTime;
    const base = to === "dark" ? 196 : 392; // G3 / G4
    [1, 1.5].forEach((mul, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = base * mul * 4;
      osc.type = "sine";
      osc.frequency.value = base * mul;
      const start = t + i * 0.045;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.16 / (i + 1), start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, start + 0.5);
      osc.connect(lp).connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.55);
      osc.onended = () => {
        try {
          osc.disconnect();
          lp.disconnect();
          g.disconnect();
        } catch {
          /* 忽略 */
        }
      };
    });
  }

  /** 连续流水：循环噪声 → 带通（LFO 微调）→ gain */
  private startWave(ctx: AudioContext, to: ThemeMode): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.55;
    bp.frequency.value = to === "dark" ? 520 : 1250;
    const g = ctx.createGain();
    g.gain.value = 0;
    // 慢速 LFO 让"水在流"而不是死噪声
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = to === "dark" ? 0.55 : 0.8;
    lfoGain.gain.value = to === "dark" ? 130 : 240;
    lfo.connect(lfoGain).connect(bp.frequency);
    src.connect(bp).connect(g).connect(this.master!);
    src.start();
    lfo.start();
    this.waveSource = src;
    this.waveGain = g;
    this.waveFilter = bp;
    this.waveLfo = lfo;
    this.waveStarted = true;
    // LFO 用一个独立 gain 节点接在 filter 上，停止时要一起清理
    const cleanupLfoGain = lfoGain;
    (this as unknown as { _lfoGain?: GainNode })._lfoGain = cleanupLfoGain;
  }

  private stopWave(): void {
    this.waveStarted = false;
    // 复位去重阈值，下次 wave 开始时一定能重新下发
    this.lastWaveLevel = -1;
    const src = this.waveSource;
    const g = this.waveGain;
    const f = this.waveFilter;
    const lfo = this.waveLfo;
    const lfoGain = (this as unknown as { _lfoGain?: GainNode })._lfoGain;
    this.waveSource = null;
    this.waveGain = null;
    this.waveFilter = null;
    this.waveLfo = null;
    (this as unknown as { _lfoGain?: GainNode })._lfoGain = undefined;
    if (g && this.ctx) {
      try {
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      } catch {
        /* 忽略 */
      }
    }
    // 给淡出一点时间再断开
    setTimeout(() => {
      try {
        src?.stop();
      } catch {
        /* 忽略 */
      }
      try {
        src?.disconnect();
        g?.disconnect();
        f?.disconnect();
        lfo?.stop();
        lfo?.disconnect();
        lfoGain?.disconnect();
      } catch {
        /* 忽略 */
      }
    }, 120);
  }

  /** 2 秒白噪声（循环用；生成一次复用） */
  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // 简单一阶低通塑形，避免纯白噪声过于刺耳
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      prev = prev * 0.72 + white * 0.28;
      // 首尾交叉淡化，循环接缝无爆音
      const fade = Math.min(1, Math.min(i, len - 1 - i) / 512);
      data[i] = prev * fade;
    }
    return buf;
  }
}
