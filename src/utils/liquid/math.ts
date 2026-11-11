/** 可复现随机 */
export const makeRng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** smoothstep */
export const easeInOut = (t: number): number => t * t * (3 - 2 * t);
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeIn = (t: number): number => t * t;

const TAU = Math.PI * 2;

/** 多正弦叠加的平滑噪声（用于液柱摆动/液面起伏），x 为空间坐标、t 为时间 */
export const wobble = (x: number, t: number, amp: number, seed: number): number => {
  return (
    (Math.sin(x * 0.021 + t * 6.1 + seed) * 0.5 +
      Math.sin(x * 0.043 - t * 9.7 + seed * 1.7) * 0.3 +
      Math.sin(x * 0.011 + t * 3.3 + seed * 2.3) * 0.2) *
    amp
  );
};

export { TAU };
