// Starting patterns: a port of the initialisers in ca_core.py. Each returns
// a rows*cols Uint8Array with values 0..n-1, drawn from a seeded Rng.

import { Rng } from "./rng.js";

/** Independent random color per cell, optionally with relative weights. */
export function initRandom(rows, cols, n, rng, weights = null) {
  const out = new Uint8Array(rows * cols);
  if (!weights) {
    for (let i = 0; i < out.length; i++) out[i] = Math.floor(rng.random() * n);
    return out;
  }
  const total = weights.reduce((s, w) => s + w, 0);
  const cumulative = [];
  let acc = 0;
  for (const w of weights) { acc += w / total; cumulative.push(acc); }
  for (let i = 0; i < out.length; i++) {
    const x = rng.random();
    let c = 0;
    while (c < n - 1 && x >= cumulative[c]) c++;
    out[i] = c;
  }
  return out;
}

/** Random color per size x size block: larger uniform patches. */
export function initBlocks(rows, cols, n, rng, size) {
  size = Math.max(1, Math.floor(size));
  const sr = Math.ceil(rows / size), sc = Math.ceil(cols / size);
  const small = new Uint8Array(sr * sc);
  for (let i = 0; i < small.length; i++) small[i] = rng.int(0, n);
  const out = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const base = Math.floor(r / size) * sc;
    for (let c = 0; c < cols; c++) out[r * cols + c] = small[base + Math.floor(c / size)];
  }
  return out;
}

/** The colors as pie slices around the centre, in cycle order: the centre
 *  is a spiral seed. turns > 0 twists the slices into arms. */
export function initSectors(rows, cols, n, rng, turns = 0) {
  const out = new Uint8Array(rows * cols);
  const cy = (rows - 1) / 2, cx = (cols - 1) / 2, size = Math.max(rows, cols);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const angle = mod1(Math.atan2(y - cy, x - cx) / (2 * Math.PI)); // 0..1
      const radius = Math.hypot(y - cy, x - cx) / size;
      const phase = mod1(angle + turns * radius);
      out[y * cols + x] = Math.floor(phase * n) % n;
    }
  }
  return out;
}

/** `count` sector patterns (spiral seeds) scattered over a calm background:
 *  the first color with 35 % of cells set to other colors. (A fully random
 *  background forms spirals everywhere on its own and would drown the seeds;
 *  35 % is about the most noise that stays free of spirals of its own.) */
export function initSpiralSeeds(rows, cols, n, rng, count) {
  const out = initSprinkle(rows, cols, n, rng, 35);
  const r = Math.max(4, Math.floor(Math.min(rows, cols) / 25));
  const side = 2 * r + 1;
  const seed = initSectors(side, side, n, rng);
  for (let s = 0; s < Math.max(0, Math.floor(count)); s++) {
    const y0 = rng.int(0, Math.max(1, rows - side));
    const x0 = rng.int(0, Math.max(1, cols - side));
    for (let y = 0; y < side && y0 + y < rows; y++) {
      for (let x = 0; x < side && x0 + x < cols; x++) out[(y0 + y) * cols + x0 + x] = seed[y * side + x];
    }
  }
  return out;
}

/** Vertical bands of width `width`, colors in cycle order. */
export function initStripes(rows, cols, n, rng, width) {
  width = Math.max(1, Math.floor(width));
  const out = new Uint8Array(rows * cols);
  for (let c = 0; c < cols; c++) out[c] = Math.floor(c / width) % n;
  for (let r = 1; r < rows; r++) out.copyWithin(r * cols, 0, cols);
  return out;
}

/** First color everywhere, with `percent` % of cells set to random other colors. */
export function initSprinkle(rows, cols, n, rng, percent) {
  const out = new Uint8Array(rows * cols);
  if (n > 1) {
    const p = percent / 100;
    for (let i = 0; i < out.length; i++) if (rng.random() < p) out[i] = rng.int(1, n);
  }
  return out;
}

function mod1(x) {
  return ((x % 1) + 1) % 1;
}

/** name -> {make(rows, cols, n, rng, param), label, def, min, max}; label
 *  null = no parameter. Same names and ranges as the desktop app. */
export const PATTERNS = {
  "Random": { make: (r, c, n, rng) => initRandom(r, c, n, rng), label: null, def: 0, min: 0, max: 0 },
  "Blocks": { make: initBlocks, label: "Block size", def: 8, min: 1, max: 1000 },
  "Sectors (spiral seed)": { make: initSectors, label: "Twist", def: 0, min: 0, max: 50 },
  "Spiral seeds on noise": { make: initSpiralSeeds, label: "Seeds", def: 10, min: 0, max: 10000 },
  "Stripes": { make: initStripes, label: "Stripe width", def: 10, min: 1, max: 10000 },
  "Sprinkle": { make: initSprinkle, label: "Other colors %", def: 5, min: 0, max: 100 },
};

/** A starting board from a pattern name, its parameter and a seed. */
export function makeBoard(pattern, param, seed, rows, cols, n) {
  return PATTERNS[pattern].make(rows, cols, n, new Rng(seed), param);
}
