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
   * 预热：在空闲时造一个 1×1 的离屏快照 + 一次 clip-path，让浏览器提前编译
   * 相关合成路径、加载 SVG clip 的绘制实现。
   * 不做这一步，冷启动后的第一次切换会多出一次 50ms 级的首次合成开销。
   */
  let warmed = false;
  const warmup = (): void => {
    if (warmed) return;
    warmed = true;
    if (typeof requestIdleCallback !== "function") return;
    requestIdleCallback(
      () => {
        try {
          const id = `ltr-warm-${++uid}`;
          const svg = document.createElementNS(SVG_NS, "svg");
          svg.setAttribute("width", "0");
          svg.setAttribute("height", "0");
          svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
          const cp = document.createElementNS(SVG_NS, "clipPath");
          cp.setAttribute("id", id);
          cp.setAttribute("clipPathUnits", "userSpaceOnUse");
          const p = document.createElementNS(SVG_NS, "path");
          p.setAttribute("clip-rule", "evenodd");
          p.setAttribute("d", "M0 0H1V1H0Z");
          cp.appendChild(p);
          const defs = document.createElementNS(SVG_NS, "defs");
          defs.appendChild(cp);
          svg.appendChild(defs);
          const probe = document.createElement("div");
          probe.style.cssText =
            `position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;` +
            `clip-path:url(#${id});will-change:clip-path;backface-visibility:hidden`;
          document.body.appendChild(svg);
          document.body.appendChild(probe);
          void probe.offsetHeight;
          probe.remove();
          svg.remove();
        } catch {
          /* 预热失败不影响功能 */
        }
      },
      { timeout: 2000 },
    );
  };

  /**
   * 冻结一棵克隆树为「旧主题快照」。
   *
   * 性能要点（决定动画是否掉帧）：
   *  - 不逐元素写 inline style：几千个元素各写 4 条样式会摧毁样式共享，
   *    让克隆树无法走合成快速路径。改用一条 <style> 规则批量禁用动画/过渡。
   *  - 只对真正滚动过的容器内联 overflow:hidden（数量很少）。
   *  - inert 本身已阻断焦点，不再逐个改 tabIndex。
   */
  const freezeClone = (clone: HTMLElement): void => {
    const root = document.documentElement;
    // 拷贝 root.style 里全部自定义属性（--s-* 色板/封面/内联主题变量）。
    // 只拷 --s-* 前缀，避免把无关内联属性带进快照。
    const vars: string[] = [];
    for (let i = 0; i < root.style.length; i++) {
      const name = root.style[i];
      if (name.startsWith("--s-")) {
        vars.push(`${name}:${root.style.getPropertyValue(name)}`);
      }
    }
    // --s-app-bg 定义在样式表的 html{} 上，克隆根不是 html 拿不到——显式补上
    if (!vars.some((v) => v.startsWith("--s-app-bg:"))) {
      vars.push(
        `--s-app-bg:${
          root.dataset.appearanceStyle === "image" ? "transparent" : "rgb(var(--s-surface))"
        }`,
      );
    }
    clone.style.cssText = vars.join(";");

    // 明暗 class（".dark .x" 选择器在克隆根内同样生效）
    if (root.classList.contains("dark")) clone.classList.add("dark");
    if (root.classList.contains("light")) clone.classList.add("light");
    if (root.dataset.appearanceStyle) {
      clone.dataset.appearanceStyle = root.dataset.appearanceStyle;
    }
    clone.setAttribute("inert", "");
    clone.setAttribute("aria-hidden", "true");

    // 一条 CSS 规则覆盖整棵克隆树：禁动画/过渡/交互。
    // 比逐元素写 inline style 快两个数量级，且保留样式共享。
    const kill = document.createElement("style");
    kill.textContent =
      "*{animation:none!important;transition:none!important}" +
      "*,*::before,*::after{pointer-events:none!important;user-select:none!important}";
    clone.appendChild(kill);

    // 只处理真正滚动过的容器（通常 0~3 个），把滚动偏移冻结在快照里
    const scrollables = clone.querySelectorAll<HTMLElement>("*");
    for (let i = 0; i < scrollables.length; i++) {
      const el = scrollables[i];
      if (el.scrollTop || el.scrollLeft) {
        el.style.overflow = "hidden";
      }
    }
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
      // 关键：提前把图层提升到合成层，clip-path 每帧变化时不触发重排/重绘。
      // 没有这一条，每帧裁剪都要重新光栅化整屏，是掉帧主因。
      "will-change:clip-path",
      "backface-visibility:hidden",
    ].join(";");
    // 注意：不用 contain:strict —— 它会在 clip-path 变化时反复重算包含块
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

    // 2) 让快照先上屏一帧，避免「克隆 + 挂载 + 全量重算样式」挤在同一帧造成长卡顿
    const rectD = `M0 0H${vw}V${vh}H0Z`;
    let lastD = "";
    unsubscribe = ctl.subscribe((f) => {
      const p = pathEl;
      if (!p) return;
      const liquid = f.visible && f.path ? f.path : "";
      const d = liquid ? rectD + liquid : rectD;
      if (d === lastD) return;
      lastD = d;
      p.setAttribute("d", d);
    });

    ctl.onFinish = () => {
      running = false;
      cleanup();
      onDoneCb?.();
    };

    const begin = (): void => {
      // 3) 提交新主题到真实 DOM（调用方改 store/data-theme）
      try {
        o.onThemeApplied?.();
      } catch {
        /* 主题提交失败也不留脏快照 */
      }
      // 4) 启动液体动画
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
      }
    };

    running = true;
    onDoneCb = o.onDone;
    // 双 rAF：确保快照已完成首次布局与合成，再切换主题
    requestAnimationFrame(() => {
      if (!running) return;
      requestAnimationFrame(() => {
        if (!running) return;
        begin();
      });
    });
    return true;
  };

  const cancel = (): void => {
    ctl.cancel();
    cleanup();
  };

  // 空闲时预热合成路径，消掉首次切换的额外卡顿
  warmup();

  return {
    start,
    cancel,
    get running() {
      return running;
    },
  };
};
