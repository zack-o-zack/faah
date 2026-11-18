// The spiral line: geometry and the four states.
// Store how much the line turns per step; motion changes curl, wave or visible spans.
const PHI = (1 + Math.sqrt(5)) / 2;
const N = 300;
const TAU = Math.PI * 2;
const QUARTERS = 6;
const FULL: readonly [number, number][] = [[0, 1]];
export const STATES = ['static', 'thinking', 'hold', 'error'] as const;
export type SpiralState = (typeof STATES)[number];
interface Base {
  psi: number[];
  ds: number;
  p0: [number, number];
}
interface Motion {
  curl: (u: number) => number;
  wave: (u: number) => number;
  spans: readonly [number, number][];
}
// The sampling loops below always address populated points.
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError('Missing spiral sample');
  return value;
}
export function baseSpiral(): Base {
  const R = 50;
  const A0 = (20 * Math.PI) / 180;
  const M = 3000;
  const pts: [number, number][] = [];
  const cum = [0];
  for (let i = 0; i <= M; i++) {
    const q = (QUARTERS * i) / M;
    const a = A0 - (q * Math.PI) / 2;
    const r = R * Math.pow(PHI, -q);
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
    if (i) {
      const point = at(pts, i);
      const previous = at(pts, i - 1);
      cum.push(at(cum, i - 1) + Math.hypot(point[0] - previous[0], point[1] - previous[1]));
    }
  }
  const L = at(cum, M);
  const even: [number, number][] = [];
  for (let i = 0, j = 0; i <= N; i++) {
    const s = (L * i) / N;
    while (j < M - 1 && at(cum, j + 1) < s) j++;
    const f = (s - at(cum, j)) / (at(cum, j + 1) - at(cum, j) || 1);
    const point = at(pts, j);
    const next = at(pts, j + 1);
    even.push([point[0] + (next[0] - point[0]) * f, point[1] + (next[1] - point[1]) * f]);
  }
  const psi: number[] = [];
  for (let i = 0; i < N; i++) {
    const point = at(even, i);
    const next = at(even, i + 1);
    let a = Math.atan2(next[1] - point[1], next[0] - point[0]);
    if (i) {
      while (a - at(psi, i - 1) > Math.PI) a -= TAU;
      while (a - at(psi, i - 1) < -Math.PI) a += TAU;
    }
    psi.push(a);
  }
  return { psi, ds: L / N, p0: at(even, 0) };
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (t: number) => {
  if (t < 0.5) return 2 * t * t;
  return 1 - Math.pow(-2 * t + 2, 2) / 2;
};
const elasticOut = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -9 * t) * Math.sin(((t * 8 - 0.75) * TAU) / 3) + 1;
};
// Along the line, u runs from 0 (mouth) to 1 (inner tip). Time is seconds.
export const MOTION: Record<SpiralState, (t: number) => Motion> = {
  static: () => ({ curl: () => 1, wave: () => 0, spans: FULL }),
  // The whole line wriggles, with a bigger shimmy now and then.
  thinking(t) {
    const beat = Math.sin((TAU * t) / 2.2);
    const amp = 0.1 + 0.16 * Math.pow(0.5 + 0.5 * beat, 2);
    return {
      curl: (u) => 1 + 0.08 * beat * Math.pow(u, 1.5),
      wave: (u) => amp * Math.sin(TAU * (2.2 * u - t * 1.8)) * Math.pow(u, 1.2),
      spans: FULL,
    };
  },
  // Hangs loose, tip wags slowly.
  hold(t) {
    const m = -0.38 + 0.08 * Math.sin((TAU * t) / 3.4);
    const wag = 0.42 * Math.sin((TAU * t) / 1.7);
    return { curl: (u) => 1 + m * Math.pow(u, 1.5), wave: (u) => wag * u * u, spans: FULL };
  },
  // Springs open, rattles, recoils. The scheduler limits this motion to one cycle.
  error(t) {
    const x = (t % 2.8) / 2.8;
    let m = -0.5;
    if (x < 0.45) m = -0.5 * elasticOut(x / 0.45);
    else if (x >= 0.62) m = -0.5 * (1 - easeInOut((x - 0.62) / 0.38));
    return {
      curl: (u) => 1 + m * Math.pow(u, 1.2),
      wave: (u) => 0.42 * Math.exp(-x * 8) * Math.sin(TAU * (4 * u - t * 8)) * u,
      spans: FULL,
    };
  },
};
export function shape(base: Base, { curl, wave, spans }: Motion): string {
  const xs = [base.p0[0]];
  const ys = [base.p0[1]];
  for (let i = 0, turn = at(base.psi, 0); i < N; i++) {
    const u = (i + 0.5) / N;
    if (i) turn += (at(base.psi, i) - at(base.psi, i - 1)) * curl(u);
    const a = turn + wave(u);
    xs.push(at(xs, i) + base.ds * Math.cos(a));
    ys.push(at(ys, i) + base.ds * Math.sin(a));
  }
  const pointAt = (f: number) => {
    const i = Math.min(N - 1, Math.floor(f));
    const r = f - i;
    return (
      (at(xs, i) + (at(xs, i + 1) - at(xs, i)) * r).toFixed(2) +
      ' ' +
      (at(ys, i) + (at(ys, i + 1) - at(ys, i)) * r).toFixed(2)
    );
  };
  let d = '';
  for (const [from, to] of spans) {
    const a = clamp01(from) * N;
    const b = clamp01(to) * N;
    d += 'M' + pointAt(a);
    for (let i = Math.floor(a) + 1; i < b; i++)
      d += 'L' + at(xs, i).toFixed(2) + ' ' + at(ys, i).toFixed(2);
    d += 'L' + pointAt(b);
  }
  return d;
}
let base: Base | undefined;
let rest: string | undefined;
function geometry(): Base {
  return (base ??= baseSpiral());
}
export function restShape(): string {
  return (rest ??= shape(geometry(), MOTION.static(0)));
}
interface LiveSpiral {
  el: SVGSVGElement;
  path: SVGPathElement;
  state: SpiralState;
  start: number;
}
const live = new Set<LiveSpiral>();
let frame = 0;
function remove(handle: LiveSpiral): void {
  live.delete(handle);
  if (!live.size && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}
function tick(now: number): void {
  frame = 0;
  for (const handle of live) {
    if (!handle.el.isConnected) {
      live.delete(handle);
      continue;
    }
    const elapsed = (now - handle.start) / 1000;
    if (handle.state === 'error' && elapsed >= 2.8) {
      handle.path.setAttribute('d', restShape());
      live.delete(handle);
      continue;
    }
    handle.path.setAttribute('d', shape(geometry(), MOTION[handle.state](elapsed)));
  }
  if (live.size) frame = requestAnimationFrame(tick);
}
// All instances share one frame loop and one sampled geometry.
export function attachSpiral(el: SVGSVGElement, path: SVGPathElement, visible = true) {
  const handle: LiveSpiral = { el, path, state: 'static', start: performance.now() };
  let reduced = false;
  let inView = visible;
  function update(): void {
    remove(handle);
    const finished = handle.state === 'error' && performance.now() - handle.start >= 2800;
    if (handle.state === 'static' || reduced || !inView || finished) {
      if (reduced || finished || handle.state === 'static') path.setAttribute('d', restShape());
      return;
    }
    live.add(handle);
    if (!frame) frame = requestAnimationFrame(tick);
  }
  return {
    set(state: SpiralState) {
      handle.state = state;
      handle.start = performance.now();
      path.setAttribute('d', restShape());
      update();
    },
    setReducedMotion(value: boolean) {
      reduced = value;
      update();
    },
    setVisible(value: boolean) {
      inView = value;
      update();
    },
    destroy: () => remove(handle),
  };
}
