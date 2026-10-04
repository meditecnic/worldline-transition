import { Renderer } from './engine/renderer';
import { Controller } from './show/controller';
import type { ControllerSnapshot } from './show/controller';
import { parseReading, T, MOCK_DELAY, scenarioDuration, formatCells } from './show/timeline';
import type { Scenario } from './show/timeline';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';

/**
 * The two directions of the transition, with the AMADEUS readings (SG = 1.048596 %,
 * β = 1.129848 %). The prototype is not connected to the app - these are only demo values.
 */
const READINGS = {
  sg2b: { label: 'SG → β', from: '1.048596', to: '1.129848', unit: '%' },
  b2sg: { label: 'β → SG', from: '1.129848', to: '1.048596', unit: '%' },
} as const;
type Dir = keyof typeof READINGS;
const isDir = (v: unknown): v is Dir => typeof v === 'string' && Object.prototype.hasOwnProperty.call(READINGS, v);
/** render scale relative to CSS pixels x devicePixelRatio (keep adjustable, default 1) */
const RENDER_SCALE = Math.min(2, Math.max(0.25, Number(params.get('rs') ?? '1') || 1));
/** cap on the drawing-buffer width (default 1920 = 1080p) */
const MAX_W = Math.min(3840, Math.max(320, Number(params.get('maxw') ?? '1920') || 1920));

const $ = <E extends HTMLElement>(id: string): E => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el as E;
};

const app = $('app');
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('gl');
const intro = $('intro');
const waitChip = $('waitChip');
const result = $('result');
const resultKind = $('resultKind');
const resultText = $('resultText');
const btnStart = $<HTMLButtonElement>('btnStart');
const btnStartLabel = $('btnStartLabel');
const introStart = $<HTMLButtonElement>('introStart');
const introCalm = $<HTMLButtonElement>('introCalm');
const btnPause = $<HTMLButtonElement>('btnPause');
const btnPauseLabel = $('btnPauseLabel');
const progressFill = $('progressFill');
const btnSkip = $<HTMLButtonElement>('btnSkip');
const btnFull = $<HTMLButtonElement>('btnFull');
const dirHint = $('dirHint');
const reduced = $<HTMLInputElement>('reduced');
const status = $('status');
const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="scenario"]'));
const dirRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="direction"]'));

function direction(): Dir {
  const v = dirRadios.find((r) => r.checked)?.value;
  return isDir(v) ? v : 'sg2b';
}
function readingsOf(d: Dir): { origin: number[]; target: number[]; unit: string } {
  const R = READINGS[d];
  return { origin: parseReading(R.from)!, target: parseReading(R.to)!, unit: R.unit };
}
/** the unit shown after readings in the UI text (the run's direction while it lasts) */
let unit: string = READINGS[direction()].unit;
function showDirection(): void {
  const R = READINGS[direction()];
  dirHint.textContent = `${R.from}${R.unit} → ${R.to}${R.unit}`;
}
showDirection();

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
reduced.checked = mq.matches;
mq.addEventListener('change', (e) => {
  if (ctl && snapshot.phase !== 'running') reduced.checked = e.matches;
});

if (TEST && params.get('ui') === '0') app.dataset.ui = 'off';

let snapshot: ControllerSnapshot;
let renderer: Renderer | null = null;
let ctl: Controller | null = null;

function scenario(): Scenario {
  return (radios.find((r) => r.checked)?.value as Scenario) ?? 'success';
}

function statusText(s: ControllerSnapshot): string {
  const rm = s.reduced ? '减少动态 · ' : '';
  const u = unit;
  if (s.phase === 'idle' || s.phase === 'harness') return `待机 · 读数 ${s.origin}${u}`;
  if (s.phase === 'ended') {
    return s.outcome === 'success'
      ? `模拟结果：成功，读数锁定为 ${s.target}${u}`
      : `模拟结果：失败，未锁定目标，读数保持 ${s.origin}${u}`;
  }
  if (s.paused) return `${rm}已暂停 · 空格继续`;
  if (s.outcome === 'success') return `${rm}模拟后端已确认 · 锁定 ${s.target}${u}`;
  if (s.outcome === 'fail') return `${rm}模拟后端拒绝切换 · 回到 ${s.origin}${u}`;
  if (s.skipRequested) return `${rm}已跳过演出 · 等待模拟结果`;
  if (s.waiting) return `${rm}等待模拟结果 · 尚未锁定`;
  return `${rm}演出中 · 模拟后端处理中`;
}

function sync(s: ControllerSnapshot): void {
  snapshot = s;
  const running = s.phase === 'running';
  const started = s.phase === 'running' || s.phase === 'ended';
  app.dataset.phase = s.phase;
  stage.dataset.phase = s.phase;
  stage.dataset.outcome = s.outcome ?? '';
  stage.dataset.shown = s.shown;
  stage.dataset.waiting = s.waiting ? 'true' : 'false';
  intro.hidden = started;
  btnStart.dataset.mode = started ? 'replay' : 'start';
  btnStartLabel.textContent = started ? '重播' : '开始';
  btnPause.disabled = !running;
  btnPause.dataset.paused = s.paused ? 'true' : 'false';
  btnPauseLabel.textContent = s.paused ? '继续' : '暂停';
  btnSkip.disabled = !running || s.skipRequested;
  radios.forEach((r) => (r.disabled = running));
  dirRadios.forEach((r) => (r.disabled = running));
  reduced.disabled = running;
  waitChip.hidden = !(running && s.waiting && !s.paused);
  if (s.phase === 'ended') {
    result.hidden = false;
    result.dataset.outcome = s.outcome ?? '';
    resultKind.textContent = s.outcome === 'success' ? '模拟结果 · 成功' : '模拟结果 · 失败';
    resultText.textContent = s.outcome === 'success' ? `${s.target}${unit} 已锁定` : `未锁定目标，保持 ${s.origin}${unit}`;
  } else {
    result.hidden = true;
  }
  const txt = statusText(s);
  if (status.textContent !== txt) status.textContent = txt;
  canvas.setAttribute('aria-label', `世界线转场演出画面：${s.shot || '待机'}，读数 ${s.shown || s.origin}`);
  syncProgress(s);
  syncCalm();
}

// ------------------------------------------------------------ progress line (UI only; never drives the show)

let progressRaf = 0;
function progressOf(s: ControllerSnapshot): number {
  if (s.phase === 'ended') return 1;
  if (s.phase !== 'running' || !s.scenario) return 0;
  return Math.min(1, (s.showT + s.waitT) / scenarioDuration(s.scenario, false));
}
function syncProgress(s: ControllerSnapshot): void {
  // the reduced-motion path has its own clock that the snapshot does not expose
  app.dataset.progress = s.reduced || s.phase === 'idle' || s.phase === 'harness' ? 'off' : 'on';
  progressFill.style.transform = `scaleX(${progressOf(s)})`;
  if (s.phase === 'running' && !s.paused && !s.reduced && progressRaf === 0) progressRaf = requestAnimationFrame(progressTick);
}
function progressTick(): void {
  progressRaf = 0;
  if (!ctl) return;
  const s = ctl.snapshot();
  progressFill.style.transform = `scaleX(${progressOf(s)})`;
  if (s.phase === 'running' && !s.paused && !s.reduced) progressRaf = requestAnimationFrame(progressTick);
}

// ------------------------------------------------------------ calm mode: controls fade out while the show plays

const CALM_AFTER_MS = 2200;
let calmTimer = 0;
function syncCalm(): void {
  const playing = !!snapshot && snapshot.phase === 'running' && !snapshot.paused;
  if (!playing) {
    window.clearTimeout(calmTimer);
    calmTimer = 0;
    delete app.dataset.calm;
    return;
  }
  if (calmTimer === 0 && app.dataset.calm !== 'on') calmTimer = window.setTimeout(enterCalm, CALM_AFTER_MS);
}
function enterCalm(): void {
  calmTimer = 0;
  if (snapshot?.phase === 'running' && !snapshot.paused) app.dataset.calm = 'on';
}
function wake(): void {
  delete app.dataset.calm;
  window.clearTimeout(calmTimer);
  calmTimer = 0;
  syncCalm();
}
['pointermove', 'pointerdown', 'keydown', 'focusin'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));

function start(): void {
  if (!ctl) return;
  const d = direction();
  const R = readingsOf(d);
  unit = R.unit;
  ctl.start({ scenario: scenario(), reduced: reduced.checked, origin: R.origin, target: R.target });
}

// ------------------------------------------------------------ sizing

function resize(): void {
  if (!renderer || !ctl) return;
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  let w = rect.width * dpr * RENDER_SCALE;
  if (w > MAX_W) w = MAX_W;
  const h = (w * 9) / 16;
  const [cw, ch] = renderer.size;
  if (Math.round(w) !== cw || Math.round(h) !== ch) {
    renderer.resize(w, h);
    ctl.draw();
  }
}

// ------------------------------------------------------------ boot

try {
  renderer = new Renderer(canvas);
  ctl = new Controller(renderer, readingsOf(direction()).origin, { onChange: sync });
  renderer.onLost = () => {
    ctl?.exit();
    status.textContent = 'WebGL 上下文丢失，等待恢复…';
  };
  renderer.onRestored = () => {
    resize();
    ctl?.draw();
    if (ctl) sync(ctl.snapshot());
  };
  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  resize();
  ctl.draw();
  sync(ctl.snapshot());
  window.addEventListener('pagehide', () => {
    ro.disconnect();
    ctl?.dispose();
    renderer?.dispose();
  });
} catch (err) {
  console.error(err);
  $('glFail').hidden = false;
  intro.hidden = true;
  [btnStart, btnPause, btnSkip, introCalm].forEach((b) => (b.disabled = true));
  status.textContent = '无法启动 WebGL2';
}

btnStart.addEventListener('click', start);
introStart.addEventListener('click', start);
introCalm.addEventListener('click', () => {
  reduced.checked = true;
  start();
});
btnPause.addEventListener('click', () => ctl?.togglePause());
btnSkip.addEventListener('click', () => ctl?.skip());
dirRadios.forEach((r) =>
  r.addEventListener('change', () => {
    if (!ctl || snapshot.phase === 'running') return;
    showDirection();
    // standby shows the new source reading; an ended run keeps its result until the next start
    if (snapshot.phase !== 'ended') unit = READINGS[direction()].unit;
    ctl.setIdleOrigin(readingsOf(direction()).origin);
    sync(ctl.snapshot());
  }),
);

btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  if (app.dataset.theater === 'on') {
    setTheater(false);
    return;
  }
  if (FS_OK) {
    app.requestFullscreen().catch(() => setTheater(true));
  } else {
    setTheater(true);
  }
});
document.addEventListener('fullscreenchange', () => {
  labelFull();
});

// Embedded previews (iframes) usually forbid the Fullscreen API: fall back to an
// in-page theatre mode that gives the stage the whole viewport.
const FS_OK = document.fullscreenEnabled === true && typeof app.requestFullscreen === 'function';
function setTheater(on: boolean): void {
  if (on) app.dataset.theater = 'on';
  else delete app.dataset.theater;
  labelFull();
}
function labelFull(): void {
  const fs = !!document.fullscreenElement;
  const th = app.dataset.theater === 'on';
  const label = fs ? '退出全屏' : th ? '退出剧场模式' : FS_OK ? '全屏' : '剧场模式（此环境不允许全屏）';
  btnFull.setAttribute('aria-label', label);
  btnFull.title = label;
  btnFull.setAttribute('aria-pressed', fs || th ? 'true' : 'false');
}
labelFull();

window.addEventListener('keydown', (e) => {
  if (!ctl) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (e.key === 'Escape') {
    if (snapshot.phase === 'running' || snapshot.phase === 'ended') {
      ctl.exit();
      e.preventDefault();
    }
    return;
  }
  if ((e.key === ' ' || e.code === 'Space') && tag !== 'INPUT' && tag !== 'BUTTON' && snapshot.phase === 'running') {
    ctl.togglePause();
    e.preventDefault();
  }
});

// ------------------------------------------------------------ test hook (only with ?test=1)

declare global {
  interface Window {
    __amadeusDemo?: unknown;
  }
}

if (TEST && ctl && renderer) {
  const c = ctl;
  const r = renderer;
  type SeekOpts = { reducedMotion?: boolean; target?: string; origin?: string; dir?: string };
  const seek = (t: number, sc: Scenario = 'success', opts: SeekOpts = {}) => {
    // explicit origin/target win over the direction
    const R = readingsOf(isDir(opts.dir) ? opts.dir : direction());
    const tgt = (opts.target && parseReading(opts.target)) || R.target;
    const org = (opts.origin && parseReading(opts.origin)) || R.origin;
    const f = c.harnessSeek(t, sc, { reduced: !!opts.reducedMotion, origin: org, target: tgt });
    return { t, scenario: sc, shot: f.shot, shown: f.readout.shown, locked: f.readout.locked.slice(), target: formatCells(tgt), ro: f.readout.ro.slice() };
  };
  window.__amadeusDemo = {
    version: '0.1.0',
    timeline: { ...T },
    readings: READINGS,
    direction: () => direction(),
    mockDelay: { ...MOCK_DELAY },
    /** Deterministically render the frame `t` seconds after start for a scenario. */
    seek,
    /** Test only: seek and read the drawing buffer back in the same task (exact render size). */
    grab(t: number, sc: Scenario = 'success', opts: SeekOpts = {}) {
      const res = seek(t, sc, opts);
      return { ...res, png: canvas.toDataURL('image/png') };
    },
    duration(sc: Scenario = 'success', opts: { reducedMotion?: boolean } = {}) {
      return scenarioDuration(sc, !!opts.reducedMotion);
    },
    /** Resize the drawing buffer explicitly (e.g. 1920x1080 regardless of CSS size). */
    setRenderSize(w: number, h: number) {
      r.resize(w, h);
      c.draw();
      return r.size;
    },
    state() {
      return { ...c.snapshot(), rafScheduled: c.rafScheduled, ticks: c.ticks, hdr: r.hdr, size: r.size };
    },
    standby() {
      c.exit();
      return c.snapshot();
    },
  };
}
