// Activity histogram panel: how many cells changed color 0, 1, 2… times,
// each bar in the heat-map color those cells get in the Activity panel, with
// the S-curve that maps counts to brightness drawn on top (right axis) and
// the median marked. Drawn on the page thread: a few hundred rectangles.

import { heatLut32 } from "../core/render.js";

/** Heat-map LUT as CSS colors (pixels are 0xAABBGGRR). */
const HEAT = Array.from(heatLut32(), (p) => `rgb(${p & 255},${(p >>> 8) & 255},${(p >>> 16) & 255})`);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{hist: Int32Array, levels: Uint8Array, median: number, sigma: number} | null} data
 */
export function drawActivityHistogram(canvas, data) {
  const dpr = devicePixelRatio || 1;
  const box = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width * dpr));
  const h = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = box.width, H = box.height;
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);
  if (!data) return;

  const { hist, levels, median } = data;
  const n = hist.length; // counts 0..n-1
  const left = 34, right = W - 34, top = 10, bottom = H - 22;
  const plotW = Math.max(1, right - left), plotH = Math.max(1, bottom - top);
  const slot = plotW / n;
  const x = (v) => left + (v + 0.5) * slot; // centre of count v's bar

  let tallest = 1;
  for (let v = 0; v < n; v++) if (hist[v] > tallest) tallest = hist[v];

  // Plot area slightly lighter than the panel, so black (0) bars show.
  ctx.fillStyle = "#222";
  ctx.fillRect(left, top, plotW, plotH);

  // Gridlines at 25 % steps (shared by both axes).
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) {
    const y = Math.round(bottom - f * plotH) + 0.5;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }

  // Bars: cells per count, colored as in the Activity panel.
  const gap = slot > 4 ? 1 : 0;
  for (let v = 0; v < n; v++) {
    if (!hist[v]) continue;
    const bh = Math.max(1, (hist[v] / tallest) * plotH);
    ctx.fillStyle = HEAT[levels[v]];
    ctx.fillRect(left + v * slot + gap / 2, bottom - bh, Math.max(1, slot - gap), bh);
  }

  // Median marker.
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(Math.round(x(median)) + 0.5, top); ctx.lineTo(Math.round(x(median)) + 0.5, bottom); ctx.stroke();
  ctx.setLineDash([]);

  // S-curve: brightness (0..255) of each count, on the right axis. Drawn
  // through the exact levels used for the pixels, with a dark halo so it
  // reads over the bars.
  const curve = () => {
    ctx.beginPath();
    for (let v = 0; v < n; v++) {
      const y = bottom - (levels[v] / 255) * plotH;
      if (v === 0) ctx.moveTo(x(v), y); else ctx.lineTo(x(v), y);
    }
    ctx.stroke();
  };
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 4; curve();
  ctx.strokeStyle = "#7fdcff"; ctx.lineWidth = 2; curve();

  // Axes and labels.
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "#a0a0a0";
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const ticks = [...new Set([0, median, n - 1])].sort((a, b) => a - b);
  for (const v of ticks) {
    ctx.fillStyle = v === median ? "#dcdcdc" : "#a0a0a0";
    ctx.fillText(v === median ? `${v} (median)` : String(v), Math.min(right - 20, Math.max(left + 8, x(v))), bottom + 5);
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillStyle = "#a0a0a0";
  ctx.fillText(compact(tallest), left - 4, top + 5);
  ctx.fillText("0", left - 4, bottom);
  ctx.textAlign = "left";
  ctx.fillStyle = "#7fdcff";
  ctx.fillText("255", right + 4, top + 5);
  ctx.fillText("0", right + 4, bottom);
}

function compact(k) {
  return k >= 10000 ? `${Math.round(k / 1000)}k` : k >= 1000 ? `${(k / 1000).toFixed(1)}k` : String(k);
}
