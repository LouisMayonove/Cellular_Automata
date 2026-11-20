// The simulation thread: owns the automaton, its statistics and the run
// loop, and draws the image panels straight into canvases handed over by the
// page (OffscreenCanvas). The page only sends commands and receives a small
// report per drawn frame, so it stays responsive however fast this runs.
//
// Port of the Simulation class and SimulationWindow._tick / render from
// ca_app.py.

import { CyclicAutomaton } from "./core/automaton.js";
import { makeBoard } from "./core/patterns.js";
import { WindowStats, CycleRecorder, colorCounts, histogram, quantile } from "./core/stats.js";
import { palette32, heatLut32, renderPalette, renderMean, activityLevels, renderActivity } from "./core/render.js";
import { SPEEDS, WINDOW_PANELS } from "./config.js";

const SLICE = 12;           // ms of simulation per tick when running flat out
const MIN_FRAME = 1000 / 60; // never redraw more often than this
const IMAGE_PANELS = ["board", "average", "activity"];

// --- Simulation model ---------------------------------------------------------

class Simulation {
  constructor(config, palette, pattern) {
    this.config = config;
    this.palette = palette;
    this.pattern = pattern; // {name, param, seed}
    this.statsWanted = true;
    this._buildAutomaton();
    this.initialise(pattern);
  }

  _buildAutomaton() {
    const c = this.config;
    this.pal32 = palette32(this.palette);
    this.ca = new CyclicAutomaton(c.rows, c.cols, c.colors.length, {
      connectivity: c.connectivity, threshold: c.threshold, surround: c.surround, wrap: c.wrap,
    });
  }

  /** New starting board from a pattern; back to step 0. */
  initialise(pattern) {
    this.pattern = pattern;
    const c = this.config;
    this.initial = makeBoard(pattern.name, pattern.param, pattern.seed, c.rows, c.cols, c.colors.length);
    this.reset();
  }

  /** Back to the starting board (the Stop button). */
  reset() {
    this.ca.setGrid(this.initial);
    this.stats = null;
    this._ensureStats();
    this.recorder = null;     // collects one cycle once detected
    this.cycleResult = null;  // completed CycleRecorder, shown in the panels
    this.cycleHandled = false;
  }

  _ensureStats() {
    if (this.statsWanted && this.stats === null) {
      this.stats = new WindowStats(this.ca.grid, this.palette, this.config.window);
    } else if (!this.statsWanted) {
      this.stats = null;
    }
  }

  /** Track window statistics only while a panel shows them. */
  setStatsWanted(wanted) {
    this.statsWanted = wanted;
    this._ensureStats();
  }

  /** Switch to new settings. Returns true if the board was restarted (new
   *  size or number of colors), false if the run continues. */
  applyConfig(config, palette) {
    const old = this.config;
    this.config = config;
    if (config.rows !== old.rows || config.cols !== old.cols || config.colors.length !== old.colors.length) {
      this.palette = palette;
      this._buildAutomaton();
      this.initialise(this.pattern);
      return true;
    }
    if (config.connectivity !== old.connectivity || config.threshold !== old.threshold
        || config.surround !== old.surround || config.wrap !== old.wrap) {
      this.ca.setRules(config.connectivity, config.threshold, config.surround, config.wrap);
      this.recorder = null; this.cycleResult = null; this.cycleHandled = false;
    }
    const colorsChanged = config.colors.some((c, i) => c !== old.colors[i]);
    if (colorsChanged || config.window !== old.window) {
      this.palette = palette;
      this.pal32 = palette32(palette);
      this.stats = null; // restart statistics from the current board
      this._ensureStats();
      this.recorder = null; this.cycleResult = null;
    }
    return false;
  }

  /** One step. Returns true if the run should pause now (a cycle has just
   *  been fully recorded, with stop-on-cycle on). */
  step() {
    const ca = this.ca;
    ca.step();
    if (this.stats !== null) this.stats.push(ca.grid);
    if (this.cycleResult !== null) this.cycleResult = null; // running again after a cycle stop
    if (ca.cycle === null || this.cycleHandled || !this.config.stopOnCycle) return false;
    if (this.recorder === null) this.recorder = new CycleRecorder(ca.grid, this.palette, ca.cycle.period);
    else this.recorder.add(ca.grid);
    if (this.recorder.complete) {
      this.cycleResult = this.recorder;
      this.recorder = null;
      this.cycleHandled = true;
      return true;
    }
    return false;
  }

  cycleText() {
    const cycle = this.ca.cycle;
    if (cycle === null) return "";
    const kind = cycle.period === 1 ? "fixed point" : `cycle of period ${cycle.period}`;
    let text = `${kind} (first seen at step ${cycle.first})`;
    if (this.recorder !== null) text += `, recording cycle ${this.recorder.seen}/${cycle.period}`;
    else if (this.cycleResult !== null) text += ", panels show the exact cycle";
    return text;
  }
}

// --- Worker state ---------------------------------------------------------------

let sim = null;
let panels = [];          // visible panels
let speedIndex = SPEEDS.length - 1;
let running = false;
let pacedOrigin = null;   // [time, step] the speed limit counts from
let lastFrame = 0;
let history = [];         // [time, step] per drawn frame while running (speed readout)
let timer = null;         // pending setTimeout when paced
let generation = 0;       // bumped on every start/stop: stale ticks drop out
const heat32 = heatLut32();

// Image output: OffscreenCanvas contexts (preferred) or, without
// OffscreenCanvas support, pixel buffers posted to the page.
let contexts = null;      // {board: ctx, ...} or null in "pixels" mode
const images = {};        // panel -> ImageData of the current grid size

// Zero-delay rescheduling: setTimeout(0) is clamped to 4 ms once nested,
// which would leave this thread idle a quarter of the time.
const channel = new MessageChannel();
channel.port1.onmessage = (e) => tick(e.data);
const scheduleNow = () => channel.port2.postMessage(generation);
const scheduleIn = (ms) => { const g = generation; timer = setTimeout(() => tick(g), ms); };

// --- Run loop -----------------------------------------------------------------

function setRunning(on) {
  running = on;
  generation++;
  pacedOrigin = null;
  history = [];
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (running) scheduleNow();
}

/** Run steps for one time slice (or as many as the speed limit allows),
 *  then redraw at most once per MIN_FRAME. */
function tick(g) {
  if (g !== generation || !running) return;
  timer = null;
  const start = performance.now();
  const limit = SPEEDS[speedIndex];
  let budget = Infinity;
  if (limit !== null) {
    if (pacedOrigin === null) pacedOrigin = [start, sim.ca.stepCount];
    const [t0, s0] = pacedOrigin;
    budget = Math.floor((start - t0) / 1000 * limit) - (sim.ca.stepCount - s0);
  }
  let stepped = 0;
  while (stepped < budget) {
    stepped++;
    if (sim.step()) { // cycle recorded: pause on it
      setRunning(false);
      render();
      return;
    }
    if (performance.now() - start > SLICE) break;
  }
  if (stepped > 0 && performance.now() - lastFrame >= MIN_FRAME) render();
  if (limit !== null) {
    // Sleep until the next step is due instead of spinning.
    const [t0, s0] = pacedOrigin;
    const due = t0 + (sim.ca.stepCount - s0 + 1) / limit * 1000;
    const delay = due - performance.now();
    if (delay > 1) scheduleIn(delay);
    else scheduleNow();
  } else {
    scheduleNow();
  }
}

// --- Rendering ----------------------------------------------------------------

function imageFor(name) {
  const { rows, cols } = sim.config;
  let img = images[name];
  if (!img || img.width !== cols || img.height !== rows) {
    img = images[name] = new ImageData(cols, rows);
    img.u32 = new Uint32Array(img.data.buffer);
    if (contexts) {
      const canvas = contexts[name].canvas;
      canvas.width = cols;
      canvas.height = rows;
    }
  }
  return img;
}

function render() {
  const subs = {};
  const pixels = {};
  const visible = new Set(panels);
  const result = sim.cycleResult;
  const ca = sim.ca;

  if (visible.has("board")) {
    const img = imageFor("board");
    renderPalette(ca.grid, sim.pal32, img.u32);
    subs.board = `step ${ca.stepCount}`;
  }
  if (visible.has("average")) {
    const img = imageFor("average");
    if (result !== null) {
      renderMean(result.sumR, result.sumG, result.sumB, result.period, img.u32);
      subs.average = `exact average over one cycle (${result.period} steps)`;
    } else {
      const s = sim.stats;
      renderMean(s.sumR, s.sumG, s.sumB, s.size, img.u32);
      subs.average = `last ${s.size}/${s.window} steps`;
    }
  }
  if (visible.has("activity")) {
    const img = imageFor("activity");
    const changes = result !== null ? result.changes : sim.stats.changes;
    // S-curve centred on the median cell, as wide as the spread of the
    // middle half of the cells: most contrast where most cells are, no
    // threshold. 0 (never changed) is black, the most active cell brightest.
    const hist = histogram(changes);
    const max = hist.length - 1;
    const median = quantile(hist, 0.5);
    const width = Math.max(1, (quantile(hist, 0.75) - quantile(hist, 0.25)) / 2);
    renderActivity(changes, activityLevels(max, median, width), heat32, img.u32);
    const what = result !== null ? "one cycle" : `last ${sim.stats.size} steps`;
    subs.activity = `color changes over ${what}: black = 0, median = ${median}, brightest = ${max}`;
  }
  for (const name of IMAGE_PANELS) {
    if (!visible.has(name)) continue;
    if (contexts) contexts[name].putImageData(images[name], 0, 0);
    else pixels[name] = images[name].data.slice().buffer;
  }

  const now = performance.now();
  lastFrame = now;
  if (running) {
    history.push([now, ca.stepCount]);
    if (history.length > 30) history.shift();
  }
  let stepsPerSec = null, fps = null;
  if (running && history.length >= 2) {
    const [t0, s0] = history[0], [t1, s1] = history.at(-1);
    if (t1 > t0) {
      stepsPerSec = (s1 - s0) / (t1 - t0) * 1000;
      fps = (history.length - 1) / (t1 - t0) * 1000;
    }
  }
  const c = sim.config;
  postMessage({
    type: "frame",
    step: ca.stepCount,
    running,
    stepsPerSec,
    fps,
    rows: c.rows,
    cols: c.cols,
    nColors: c.colors.length,
    cycleText: sim.cycleText(),
    subs,
    counts: visible.has("histogram") ? colorCounts(ca.grid, c.colors.length) : null,
    pixels: contexts ? null : pixels,
  }, contexts ? [] : Object.values(pixels));
}

// --- Commands from the page ------------------------------------------------------

function setPanels(list) {
  panels = list;
  sim.setStatsWanted(list.some((p) => WINDOW_PANELS.includes(p)));
}

const handlers = {
  init(msg) {
    contexts = msg.canvases
      ? Object.fromEntries(Object.entries(msg.canvases).map(([k, c]) => [k, c.getContext("2d", { alpha: false })]))
      : null;
    sim = new Simulation(msg.config, msg.palette, msg.pattern);
    speedIndex = msg.speedIndex;
    setPanels(msg.panels);
    render();
  },
  toggle() { setRunning(!running); if (!running) render(); },
  pause() { if (running) { setRunning(false); render(); } },
  step() { setRunning(false); sim.step(); render(); },
  stop() { setRunning(false); sim.reset(); render(); },
  create(msg) { setRunning(false); sim.initialise(msg.pattern); render(); },
  speed(msg) {
    speedIndex = msg.index;
    pacedOrigin = null; // restart the pacing from now
    if (running && timer !== null) { // asleep until a step that may now be sooner
      clearTimeout(timer); timer = null;
      scheduleNow();
    }
  },
  panels(msg) { setPanels(msg.panels); render(); },
  config(msg) {
    const restarted = sim.applyConfig(msg.config, msg.palette);
    if (restarted) setRunning(false);
    render();
  },
};

onmessage = (e) => {
  try {
    handlers[e.data.type](e.data);
  } catch (err) {
    setRunning(false);
    postMessage({ type: "error", message: String(err && err.message || err) });
  }
};
