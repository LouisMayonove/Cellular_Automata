// Page entry point: starts the simulation worker, hands it the panel
// canvases and wires the controls. Everything heavy happens in the worker;
// this thread only sends commands and shows the per-frame reports.

import { SPEEDS, defaultConfig, cssToRgb } from "./config.js";

const $ = (id) => document.getElementById(id);

const state = {
  config: defaultConfig(),
  pattern: { name: "Random", param: 0, seed: 0 },
  panels: ["board", "average", "activity"],
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

// --- Start ------------------------------------------------------------------------

for (const [name, el] of Object.entries(panelEls)) el.hidden = !state.panels.includes(name);
$("panels").style.gridTemplateColumns = `repeat(${state.panels.length}, 1fr)`;
speedChanged();
startWorker();
