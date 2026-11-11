import { createLiquidController } from "@/utils/liquid/driver";
import type { LiquidSoundAdapter, ThemeMode } from "@/utils/liquid/types";

/**
 * 液体主题揭示（SPlayer Neo 适配：反向快照法）
 *
 * 与 React 版「双树同构 + clip-path 揭示新层」不同，这里用反向思路，
 * 因为 Vue + IPC + 全局副作用的主树无法安全地整棵克隆重渲染：
 *
 *   底层（z 低）  实时 DOM —— 提交后的【新】主题（立即应用，全程可交互）
 *   顶层（z 高）  克隆快照 —— 动画前的【旧】主题（冻结、inert、不可交互）
 *
 * 液体形状用 clip-path 作用在快照层上，但裁剪的是【它的补集】：
 *   clip-path: evenodd(整屏 rect, 液体 path)
 * → 液体轮廓内的旧主题被剪掉，露出底下的新主题；液体经过哪里哪里先变。
 * 等价视觉效果，但只有一份真实交互树、零重复 ID、零事件/IPC 重复绑定。
 *
 * 生命周期：
 *   start()  克隆 root（冻结旧主题）→ onThemeApplied()（调用方切主题）→ 启动 rAF
 *   done     移除克隆层与 svg defs
 *   cancel   中断即移除覆盖层（新主题已在实时 DOM 上，天然落定）
 */
export interface LiquidRevealOptions {
  /** 切换按钮元素（液柱从其底缘中心流出） */
  origin: HTMLElement | { x: number; y: number };
  /** 目标主题（仅用于音色方向与日志） */
  to: ThemeMode;
  /** 总时长 ms，默认 1900 */
  duration?: number;
  /** 覆盖的根容器（默认 document.documentElement 可视根） */
  host?: HTMLElement;
  /** 克隆哪棵子树做旧主题快照；默认克隆 host 第一个子元素，否则整 host */
  snapshotTarget?: HTMLElement;
  /** 可选音效适配器 */
  sound?: LiquidSoundAdapter | null;
  /** 快照就绪后、动画启动前回调：调用方在此提交主题（改 store / data-theme） */
  onThemeApplied?: () => void;
  /** 全部清理完成后回调 */
  onDone?: () => void;
}

export interface LiquidReveal {
  start(opts: LiquidRevealOptions): boolean;
  cancel(): void;
  readonly running: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
let uid = 0;

const supportsClip = (): boolean =>
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  (CSS.supports("clip-path", "url(#a)") || CSS.supports("-webkit-clip-path", "url(#a)"));

export const createLiquidReveal = (): LiquidReveal => {
  const ctl = createLiquidController();
  let overlay: HTMLElement | null = null;
  let svgDefs: SVGSVGElement | null = null;
  let pathEl: SVGPathElement | null = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;
  let onDoneCb: (() => void) | undefined;

  const cleanup = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    overlay?.remove();
    svgDefs?.remove();
    overlay = null;
    svgDefs = null;
    pathEl = null;
    running = false;
  };

  /**
   * 冻结一棵克隆树为「旧主题快照」。
   * 主题完全由 :root 内联的 --s-* 变量 + .dark/.light class + data-appearance-style
   * 驱动；克隆树仍是 :root 的后代，切主题后会跟着变。所以在克隆根上：
   *   - 把 root.style 里所有 --s-* 内联变量原样拷贝（克隆根覆盖继承）
   *   - 复制 dark/light class（选择器 ".dark .x" 在克隆根同样命中）
   *   - 复制 data-appearance-style（选择器是 html[...]，这里退化为克隆根自身的 [data-...]，
   *     配合下面注入的局部补丁选择器生效）
   * 之后 :root 怎么改都不影响快照。
   */
  const freezeClone = (clone: HTMLElement): void => {
    const root = document.documentElement;
    // 拷贝 root.style 里全部自定义属性（--s-* 色板/封面/其他内联主题变量）
    for (let i = 0; i < root.style.length; i++) {
      const name = root.style[i];
      if (name.startsWith("--")) {
        clone.style.setProperty(name, root.style.getPropertyValue(name));
      }
    }
    // --s-app-bg 定义在样式表的 html{} 上，克隆根不是 html 拿不到——显式补上
    if (!clone.style.getPropertyValue("--s-app-bg")) {
      clone.style.setProperty(
        "--s-app-bg",
        root.dataset.appearanceStyle === "image" ? "transparent" : "rgb(var(--s-surface))",
      );
    }
    // 明暗 class（".dark .x" 选择器在克隆根内同样生效）
    if (root.classList.contains("dark")) clone.classList.add("dark");
    if (root.classList.contains("light")) clone.classList.add("light");
    // 外观风格：真实选择器是 html[data-appearance-style]，克隆根不是 html，
    // 故给克隆根挂同名属性并靠下方 <style> 补丁把 html[...] 选择器平移到克隆根
    if (root.dataset.appearanceStyle) {
      clone.dataset.appearanceStyle = root.dataset.appearanceStyle;
    }

    clone.setAttribute("inert", "");
    clone.setAttribute("aria-hidden", "true");
    clone.style.pointerEvents = "none";
    clone.style.userSelect = "none";
    // 内层滚动容器冻结在当前位置 + 禁动画
    clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
      el.style.animation = "none";
      el.style.transition = "none";
      if (el.scrollTop || el.scrollLeft) el.style.overflow = "hidden";
      if (el.tabIndex >= 0) el.tabIndex = -1;
    });
  };

  const buildOverlay = (target: HTMLElement): void => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 克隆目标（旧主题外观，此刻 DOM 仍是旧主题）
    const clone = target.cloneNode(true) as HTMLElement;
    freezeClone(clone);
    const targetRect = target.getBoundingClientRect();

    // overlay 覆盖整个视口；内部按视口坐标绝对定位克隆树
    overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483000",
      "pointer-events:none",
      "overflow:hidden",
      "contain:strict",
    ].join(";");
    clone.style.position = "absolute";
    clone.style.left = `${targetRect.left}px`;
    clone.style.top = `${targetRect.top}px`;
    clone.style.width = `${targetRect.width}px`;
    clone.style.height = `${targetRect.height}px`;
    clone.style.margin = "0";
    overlay.appendChild(clone);

    // html[data-appearance-style] 选择器在克隆树里失配（克隆根不是 html）。
    // 克隆根已带 data-appearance-style；把 global.css 里那条 html-scoped 的
    // "image 外观"规则原样平移到克隆根（选择器降级为 [data-appearance-style]），
    // 让玻璃面板的半透明覆盖在快照里同样生效。
    if (clone.dataset.appearanceStyle === "image") {
      const sel = `[data-appearance-style="image"]`;
      const patch = document.createElement("style");
      patch.textContent = [
        `${sel} { --s-app-bg: transparent }`,
        `${sel} .bg-surface { background-color: transparent }`,
        `${sel} .bg-surface-panel, ${sel} .bg-surface-alt, ${sel} .glass-panel`,
        `{ background-color: rgb(var(--s-surface-bright) / 0.22) }`,
        `${sel} footer.bg-surface-panel, ${sel} footer.glass-panel`,
        `{ background-color: rgb(var(--s-surface-bright) / 0.7); backdrop-filter: blur(16px) saturate(1.4) }`,
        `${sel} [role="dialog"].bg-surface-panel, ${sel} [role="dialog"].bg-surface-alt,`,
        `${sel} [role="alertdialog"].bg-surface-panel, ${sel} [role="alertdialog"].bg-surface-alt`,
        `{ backdrop-filter: blur(16px) saturate(1.4) }`,
        `${sel} [role="dialog"] .bg-surface-panel, ${sel} [role="alertdialog"] .bg-surface-panel`,
        `{ background-color: rgb(var(--s-surface-panel) / 0.35) }`,
        `${sel} .bg-surface-bright, ${sel} .bg-field`,
        `{ background-color: rgb(var(--s-surface-bright) / 0.55); backdrop-filter: blur(10px) saturate(1.3) }`,
        `${sel} [role="dialog"] .bg-field, ${sel} [role="alertdialog"] .bg-field`,
        `{ backdrop-filter: none }`,
      ].join("\n");
      overlay.appendChild(patch);
    }

    // SVG defs：clipPath = evenodd(整屏, 液体 path)。液体处被剪掉→露出新主题
    const id = `ltr-clip-${++uid}`;
    svgDefs = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svgDefs.setAttribute("width", "0");
    svgDefs.setAttribute("height", "0");
    svgDefs.setAttribute("aria-hidden", "true");
    svgDefs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    const clip = document.createElementNS(SVG_NS, "clipPath");
    clip.setAttribute("id", id);
    clip.setAttribute("clipPathUnits", "userSpaceOnUse");
    pathEl = document.createElementNS(SVG_NS, "path");
    pathEl.setAttribute("clip-rule", "evenodd");
    pathEl.setAttribute("d", `M0 0H${vw}V${vh}H0Z`);
    clip.appendChild(pathEl);
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.appendChild(clip);
    svgDefs.appendChild(defs);

    overlay.style.clipPath = `url(#${id})`;
    (overlay.style as CSSStyleDeclaration & { webkitClipPath?: string }).webkitClipPath =
      `url(#${id})`;

    document.body.appendChild(svgDefs);
    document.body.appendChild(overlay);
  };

  const start = (o: LiquidRevealOptions): boolean => {
    if (running || !supportsClip()) return false;
    // target = 克隆的旧主题子树。App.vue 是片段根（AppBackground + RouterView），
    // 所以克隆整个 #app 容器，才能覆盖侧栏/顶栏/内容/播放栏全部。
    const target =
      o.snapshotTarget ??
      (document.getElementById("app") as HTMLElement | null) ??
      document.documentElement;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 2 || vh < 2) return false;

    const originRect = o.origin instanceof HTMLElement ? o.origin.getBoundingClientRect() : null;
    // 视口坐标：overlay inset:0 + clipPath userSpaceOnUse 同坐标系
    const ox =
      originRect != null ? originRect.left + originRect.width / 2 : (o.origin as { x: number }).x;
    const oy = originRect != null ? originRect.bottom : (o.origin as { x: number; y: number }).y;

    // 1) 克隆旧主题（此刻真实 DOM 还是旧主题）
    buildOverlay(target);

    // 2) 提交新主题到真实 DOM（调用方改 store/data-theme）
    try {
      o.onThemeApplied?.();
    } catch {
      /* 主题提交失败也不留脏快照 */
    }

    running = true;
    onDoneCb = o.onDone;

    // 3) 每帧更新 clip-path：液体 path 与整屏 rect 用 evenodd 合成"补集"
    unsubscribe = ctl.subscribe((f) => {
      if (!pathEl) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const rect = `M0 0H${w}V${h}H0Z`;
      const liquid = f.visible && f.path ? f.path : "";
      // evenodd：整屏挖掉液体轮廓 → 液体处剪开旧快照、露新主题
      pathEl.setAttribute("d", liquid ? `${rect}${liquid}` : rect);
    });

    ctl.onFinish = () => {
      running = false;
      cleanup();
      onDoneCb?.();
    };

    const ok = ctl.start(
      {
        originX: ox,
        originY: Math.max(0, oy),
        width: vw,
        height: vh,
        duration: Math.max(600, o.duration ?? 1900),
        seed: 17,
      },
      o.sound ?? null,
      o.to,
    );
    if (!ok) {
      cleanup();
      return false;
    }
    return true;
  };

  const cancel = (): void => {
    ctl.cancel();
    cleanup();
  };

  return {
    start,
    cancel,
    get running() {
      return running;
    },
  };
};
