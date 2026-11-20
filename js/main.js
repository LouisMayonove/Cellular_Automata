// Page entry point: starts the simulation worker, hands it the panel
// canvases and wires the controls. Everything heavy happens in the worker;
// this thread only sends commands and shows the per-frame reports.

import { SPEEDS, PANELS, defaultConfig, cssToRgb } from "./config.js";
import { drawHistogram } from "./ui/histogram.js";
import { PATTERNS } from "./core/patterns.js";
import { randomSeed } from "./core/rng.js";

const $ = (id) => document.getElementById(id);

const state = {
  config: defaultConfig(),
  pattern: { name: "Random", param: 0, seed: 0 },
  panels: [], // visible panels, from the checkboxes
  running: false,
  frame: null, // last report from the worker
};

const panelEls = Object.fromEntries(
  [...document.querySelectorAll(".panel")].map((el) => [el.dataset.panel, el]));

// --- Worker ---------------------------------------------------------------------

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const send = (msg, transfer = []) => worker.postMessage(msg, transfer);

const offscreen = "transferControlToOffscreen" in HTMLCanvasElement.prototype;
const imageCanvases = {};
for (const name of ["board", "average", "activity"]) {
  imageCanvases[name] = panelEls[name].querySelector("canvas");
}

function palette(config) {
  return config.colors.map(cssToRgb);
}

function startWorker() {
  let canvases = null;
  if (offscreen) {
    canvases = Object.fromEntries(
      Object.entries(imageCanvases).map(([k, c]) => [k, c.transferControlToOffscreen()]));
  }
  send({
    type: "init",
    canvases,
    config: state.config,
    palette: palette(state.config),
    pattern: state.pattern,
    panels: state.panels,
    speedIndex: Number($("speed").value),
  }, canvases ? Object.values(canvases) : []);
}

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "frame") onFrame(msg);
  else if (msg.type === "error") showError(msg.message);
};
worker.onerror = (e) => showError(e.message || "the simulation stopped unexpectedly");

// --- Frames -----------------------------------------------------------------------

function onFrame(f) {
  const resized = !state.frame || state.frame.rows !== f.rows || state.frame.cols !== f.cols;
  state.frame = f;
  if (f.running !== state.running) setRunningUi(f.running);
  for (const [name, text] of Object.entries(f.subs)) {
    panelEls[name].querySelector(".sub").textContent = text;
  }
  if (f.pixels) drawPixels(f);
  if (f.counts) redrawHistogram();
  if (resized) updatePixelation();
  updateStatus();
}

/** Fallback without OffscreenCanvas: the worker posts raw pixels. */
function drawPixels(f) {
  for (const [name, buffer] of Object.entries(f.pixels)) {
    const canvas = imageCanvases[name];
    if (canvas.width !== f.cols || canvas.height !== f.rows) {
      canvas.width = f.cols;
      canvas.height = f.rows;
    }
    const img = new ImageData(new Uint8ClampedArray(buffer), f.cols, f.rows);
    canvas.getContext("2d").putImageData(img, 0, 0);
  }
}

function updateStatus() {
  const f = state.frame;
  if (!f) return;
  const parts = [`Step ${f.step}`, `${f.rows}×${f.cols}, ${f.nColors} colors`];
  if (f.running && f.stepsPerSec !== null) {
    parts.push(`${f.stepsPerSec.toFixed(0)} steps/s, ${f.fps.toFixed(0)} fps`);
  } else if (!f.running) {
    parts.push("paused");
  }
  if (f.cycleText) parts.push(f.cycleText);
  $("status").textContent = parts.join("   |   ");
}

function showError(message) {
  $("status").textContent = `Error: ${message}`;
}

// --- Crisp or smooth scaling --------------------------------------------------------
// Enlarged boards show crisp squares (pixelated); shrunk ones are smoothed,
// like the desktop app. The GPU does the scaling via CSS.

function updatePixelation() {
  const f = state.frame;
  if (!f) return;
  for (const canvas of Object.values(imageCanvases)) {
    const box = canvas.parentElement.getBoundingClientRect();
    const scale = Math.min(box.width / f.cols, box.height / f.rows) * devicePixelRatio;
    canvas.classList.toggle("pixelated", scale >= 1);
  }
}

new ResizeObserver(updatePixelation).observe($("panels"));

// --- Run controls -----------------------------------------------------------------

function setRunningUi(running) {
  state.running = running;
  $("btn-run").textContent = running ? "❚❚ Pause" : "▶ Start";
}

function toggleRun() { send({ type: "toggle" }); setRunningUi(!state.running); }
function stepOnce() { send({ type: "step" }); setRunningUi(false); }
function stop() { send({ type: "stop" }); setRunningUi(false); }

$("btn-run").addEventListener("click", toggleRun);
$("btn-step").addEventListener("click", stepOnce);
$("btn-stop").addEventListener("click", stop);

function speedChanged() {
  const s = SPEEDS[Number($("speed").value)];
  $("speed-label").textContent = s === null ? "Speed: as fast as possible" : `Speed: at most ${s} steps/s`;
}

$("speed").addEventListener("input", () => {
  speedChanged();
  send({ type: "speed", index: Number($("speed").value) });
});

// --- Starting board ---------------------------------------------------------------

const patternSelect = $("pattern");
for (const name of Object.keys(PATTERNS)) patternSelect.add(new Option(name, name));

function patternChanged() {
  const p = PATTERNS[patternSelect.value];
  const hasParam = p.label !== null;
  $("param-label").hidden = !hasParam;
  $("param").hidden = !hasParam;
  if (hasParam) {
    $("param-label").textContent = p.label;
    Object.assign($("param"), { min: p.min, max: p.max, value: p.def });
  }
}

/** Clamp a number input to its range (and to an integer). */
function inputValue(input) {
  const v = Math.round(Number(input.value) || 0);
  const clamped = Math.min(Number(input.max), Math.max(Number(input.min), v));
  input.value = clamped;
  return clamped;
}

function createBoard() {
  if ($("new-seed").checked) $("seed").value = randomSeed();
  const name = patternSelect.value;
  state.pattern = {
    name,
    param: PATTERNS[name].label !== null ? inputValue($("param")) : 0,
    seed: inputValue($("seed")),
  };
  send({ type: "create", pattern: state.pattern });
  setRunningUi(false);
}

patternSelect.addEventListener("change", patternChanged);
$("btn-create").addEventListener("click", createBoard);

// --- Panels -----------------------------------------------------------------------

const panelChecks = Object.fromEntries(
  [...document.querySelectorAll("input[data-panel]")].map((cb) => [cb.dataset.panel, cb]));

/** [columns, rows] of the most compact layout: up to 3 panels in a line,
 *  then a near-square grid (4 -> 2x2, ...), as in the desktop app. */
function gridShape(n) {
  if (n <= 3) return [Math.max(n, 1), 1];
  const cols = Math.ceil(Math.sqrt(n));
  return [cols, Math.ceil(n / cols)];
}

function visiblePanels() {
  return PANELS.filter((name) => panelChecks[name].checked);
}

function layoutPanels() {
  state.panels = visiblePanels();
  const [cols, rows] = gridShape(state.panels.length);
  // Keep panel order: hidden ones drop out of the grid.
  for (const name of PANELS) panelEls[name].hidden = !state.panels.includes(name);
  const grid = $("panels");
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  updatePixelation();
  redrawHistogram();
}

function panelsChanged(e) {
  if (visiblePanels().length === 0) { // keep at least one panel
    e.target.checked = true;
    return;
  }
  layoutPanels();
  send({ type: "panels", panels: state.panels });
}

for (const cb of Object.values(panelChecks)) cb.addEventListener("change", panelsChanged);

function redrawHistogram() {
  const f = state.frame;
  if (!state.panels.includes("histogram")) return;
  drawHistogram(panelEls.histogram.querySelector("canvas"), f && f.counts, state.config.colors);
}

new ResizeObserver(redrawHistogram).observe(panelEls.histogram);

// --- Start ------------------------------------------------------------------------

patternChanged();
layoutPanels();
speedChanged();
startWorker();
