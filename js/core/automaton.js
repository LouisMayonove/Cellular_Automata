// Simulation engine for the cyclic ("rock-paper-scissors") cellular
// automaton: a port of CyclicAutomaton from ca_core.py.
//
// Each cell holds one of K colors arranged in a cycle where color i is beaten
// by color (i + 1) % K. All cells update simultaneously:
//
// - beating rule: if at least `threshold` neighbours (4- or 8-connectivity)
//   have the color that beats the cell, it takes that color;
// - surround rule (surround > 0): if at least that many neighbours share one
//   color other than the cell's own, it takes that color, whatever their
//   relationship. It overrides the beating rule and is skipped when two
//   colors tie. Without wrapping, off-grid cells don't count.

export const OFF = 255; // padded-border value: matches no color (off-grid)

const OFFSETS_4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const OFFSETS_8 = [...OFFSETS_4, [-1, -1], [-1, 1], [1, -1], [1, 1]];

/** A board buffer: one byte per cell, its length rounded up to a multiple
 *  of 4 (the tail stays 0) so it can also be read 4 cells at a time. */
export function newBoard(cells) {
  return new Uint8Array(new ArrayBuffer((cells + 3) & ~3), 0, cells);
}

export class CyclicAutomaton {
  /**
   * @param {number} rows
   * @param {number} cols
   * @param {number} nColors 2..255
   * @param {object} [opts] connectivity (4|8), threshold, surround (null:
   *   connectivity - 1, 0: off), wrap, grid (Uint8Array rows*cols)
   */
  constructor(rows, cols, nColors, opts = {}) {
    if (nColors < 2 || nColors > 255) throw new RangeError("between 2 and 255 colors are supported");
    this.rows = rows;
    this.cols = cols;
    this.nColors = nColors;
    this.predatorOf = new Uint8Array(256);
    for (let c = 0; c < nColors; c++) this.predatorOf[c] = (c + 1) % nColors;
    // The padded board has a 1-cell border: OFF (fixed edges) or the
    // opposite edge (wrapping). The next board is written into a second
    // buffer and the two are swapped each step.
    this.W = cols + 2;
    this.padded = new Uint8Array((rows + 2) * this.W).fill(OFF);
    this.grid = newBoard(rows * cols);
    this.next = newBoard(rows * cols);
    this.setRules(opts.connectivity ?? 4, opts.threshold ?? 1, opts.surround ?? null, opts.wrap ?? true);
    this.setGrid(opts.grid ?? new Uint8Array(rows * cols));
  }

  /** Change the update rules; can be called between steps. Restarts cycle
   *  detection, since states seen under the old rules say nothing about the
   *  new ones. */
  setRules(connectivity, threshold, surround, wrap) {
    if (connectivity !== 4 && connectivity !== 8) throw new RangeError("connectivity must be 4 or 8");
    if (!(threshold >= 1 && threshold <= connectivity)) {
      throw new RangeError(`threshold must be between 1 and ${connectivity}`);
    }
    if (surround === null || surround === undefined) surround = connectivity - 1;
    if (!(surround >= 0 && surround <= connectivity)) {
      throw new RangeError(`surround threshold must be between 0 (off) and ${connectivity}`);
    }
    this.connectivity = connectivity;
    this.threshold = threshold;
    this.surround = surround;
    this.wrap = wrap;
    const W = this.W;
    this.offsets = Int32Array.from(
      (connectivity === 4 ? OFFSETS_4 : OFFSETS_8).map(([dr, dc]) => dr * W + dc));
    if (!wrap) this._clearBorder(); // back to "off-grid" after a wrapping run
    if (this.seen) this.resetCycleDetection();
  }

  /** Load a board (values 0..nColors-1) and restart from step 0. */
  setGrid(grid) {
    if (grid.length !== this.rows * this.cols) throw new RangeError("grid size doesn't match the automaton");
    this.grid.set(grid);
    this.stepCount = 0;
    this.resetCycleDetection();
  }

  resetCycleDetection() {
    // Hash of every board seen so far -> step it occurred at. Storing hashes
    // instead of full boards keeps memory small.
    this.seen = new Map([[this._hash(), this.stepCount]]);
    this.cycle = null; // {first, period} once a repeated state is found
  }

  /** 53-bit hash of the board: two independent 32-bit hashes over 4 cells
   *  at a time, combined into one exact JS number (usable as a Map key). */
  _hash() {
    const g = this.grid;
    const words = new Uint32Array(g.buffer, g.byteOffset, g.buffer.byteLength >>> 2);
    let h1 = 0x2545f491, h2 = 0x9e3779b9;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      h1 = Math.imul(h1 ^ w, 0x85ebca6b);
      h1 = (h1 << 13) | (h1 >>> 19);
      h2 = Math.imul((h2 + w) | 0, 0xc2b2ae35);
      h2 ^= h2 >>> 15;
    }
    h1 = fmix32(h1 ^ words.length);
    h2 = fmix32(h2 ^ 0x5bd1e995);
    return (h1 >>> 0) * 2097152 + (h2 >>> 11);
  }

  _clearBorder() {
    const p = this.padded, W = this.W, R = this.rows + 1;
    p.fill(OFF, 0, W);
    p.fill(OFF, R * W, (R + 1) * W);
    for (let r = 1; r < R; r++) { p[r * W] = OFF; p[r * W + W - 1] = OFF; }
  }

  _fillPadded() {
    const p = this.padded, g = this.grid, W = this.W, rows = this.rows, cols = this.cols;
    for (let r = 0; r < rows; r++) p.set(g.subarray(r * cols, (r + 1) * cols), (r + 1) * W + 1);
    if (this.wrap) {
      // Toroidal boundary: copy opposite edges (and corners) into the border.
      p.set(g.subarray((rows - 1) * cols, rows * cols), 1);
      p.set(g.subarray(0, cols), (rows + 1) * W + 1);
      for (let r = 0; r < rows + 2; r++) {
        const base = r * W;
        p[base] = p[base + cols];
        p[base + cols + 1] = p[base + 1];
      }
    }
  }

  step() {
    this._fillPadded();
    stepKernel(this.padded, this.next, this.W, this.rows, this.cols, this.offsets,
               this.predatorOf, this.threshold, this.surround);
    const t = this.grid; this.grid = this.next; this.next = t;
    this.stepCount++;

    // The update rule is deterministic, so a repeated board means the
    // automaton loops forever from here. Once found, the cycle is kept as
    // first detected (stepping further only replays known states).
    if (this.cycle === null) {
      const h = this._hash();
      const first = this.seen.get(h);
      if (first !== undefined) this.cycle = { first, period: this.stepCount - first };
      else this.seen.set(h, this.stepCount);
    }
    return this.grid;
  }
}

function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

// --- Step kernels -------------------------------------------------------------
//
// One update of the whole board, read from `p` (padded), written to `out`.
// Written without data-dependent branches: on a noisy board a branch on the
// neighbours' colors is mispredicted about half the time, which made a
// straightforward version 3-4x slower. For byte values x, y:
//   eq(x, y) = ((x ^ y) - 1) >>> 31     is 1 if x === y, else 0
//   ne(x, y) = (-(x ^ y)) >>> 31        is 1 if x !== y, else 0
//   ge(n, t) = ((t - n - 1) >> 31) & 1  is 1 if n >= t, else 0
// and `v ^= (v ^ x) & mask` sets v to x where mask is -1, keeps it where 0.
//
// Surround rule, the most common color among the neighbours other than the
// cell's own (OFF never counts), taken if its count reaches `surround` and no
// other color ties with it:
// - "majority" (2 * surround > neighbours): at most one color can reach the
//   threshold, so no tie is possible, and that color must appear among the
//   first (neighbours - surround + 1) neighbours (pigeonhole). Only those
//   candidates are counted.
// - "general" (lower thresholds): count every neighbour's color, take the
//   maximum and check for a tie, still without branches.

const MODE_OFF = 0, MODE_MAJORITY = 1, MODE_GENERAL = 2;

function surroundMode(surround, nNb) {
  if (surround === 0) return MODE_OFF;
  return 2 * surround > nNb ? MODE_MAJORITY : MODE_GENERAL;
}

// Each rule combination gets its own small kernel: V8 inlines the helpers
// below only up to a per-function budget, and one big kernel handling every
// mode ran out of it (the fast paths got 2x slower).
function stepKernel(p, out, W, rows, cols, offsets, predatorOf, threshold, surround) {
  const mode = surroundMode(surround, offsets.length);
  const kernel = offsets.length === 8 ? KERNELS_8[mode] : KERNELS_4[mode];
  kernel(p, out, W, rows, cols, predatorOf, threshold, surround);
}

// Small branch-free helpers; V8 inlines them into the kernels.
function eq(x, y) { return ((x ^ y) - 1) >>> 31; }
function ne(x, y) { return (-(x ^ y)) >>> 31; }
function ge(n, t) { return ((t - n - 1) >> 31) & 1; }
/** max(x, y) for small integers. */
function mx(x, y) { return x - ((x - y) & ((x - y) >> 31)); }
/** x if flag is 1, else cur. */
function sel(cur, x, flag) { return cur ^ ((cur ^ x) & -flag); }
/** -1 if color x takes part in the surround rule (not own, not OFF), else 0. */
function other(x, own) { return -(ne(x, own) & ne(x, 255)); }

function cnt4(x, a, b, d, e) { return eq(x, a) + eq(x, b) + eq(x, d) + eq(x, e); }
function cnt8(x, a, b, d, e, f, g, h, k) {
  return eq(x, a) + eq(x, b) + eq(x, d) + eq(x, e) + eq(x, f) + eq(x, g) + eq(x, h) + eq(x, k);
}

/** Majority mode: take candidate x if it qualifies (count k >= surround). */
function major(nw, x, k, own, surround) { return sel(nw, x, -other(x, own) & ge(k, surround)); }

// Neighbour names used by every kernel: a above, b below, d left, e right,
// f g above-left/right, h k below-left/right.

function step8Off(p, out, W, rows, cols, predatorOf, threshold) {
  let o = 0;
  for (let i = 0; i < rows; i++) {
    let c = (i + 1) * W + 1;
    for (let j = 0; j < cols; j++, c++, o++) {
      const own = p[c], pr = predatorOf[own];
      const a = p[c - W], b = p[c + W], d = p[c - 1], e = p[c + 1];
      const f = p[c - W - 1], g = p[c - W + 1], h = p[c + W - 1], k = p[c + W + 1];
      out[o] = sel(own, pr, ge(cnt8(pr, a, b, d, e, f, g, h, k), threshold));
    }
  }
}

function step8Majority(p, out, W, rows, cols, predatorOf, threshold, surround) {
  const m = 9 - surround; // number of candidates (1..4)
  let o = 0;
  for (let i = 0; i < rows; i++) {
    let c = (i + 1) * W + 1;
    for (let j = 0; j < cols; j++, c++, o++) {
      const own = p[c], pr = predatorOf[own];
      const a = p[c - W], b = p[c + W], d = p[c - 1], e = p[c + 1];
      const f = p[c - W - 1], g = p[c - W + 1], h = p[c + W - 1], k = p[c + W + 1];
      let nw = sel(own, pr, ge(cnt8(pr, a, b, d, e, f, g, h, k), threshold));
      nw = major(nw, a, cnt8(a, a, b, d, e, f, g, h, k), own, surround);
      if (m > 1) nw = major(nw, b, cnt8(b, a, b, d, e, f, g, h, k), own, surround);
      if (m > 2) nw = major(nw, d, cnt8(d, a, b, d, e, f, g, h, k), own, surround);
      if (m > 3) nw = major(nw, e, cnt8(e, a, b, d, e, f, g, h, k), own, surround);
      out[o] = nw;
    }
  }
}

/** General mode: each neighbour's count (0 when its color doesn't take
 *  part) from the 28 pairwise comparisons; the first neighbour with the best
 *  count wins, unless a neighbour of another color has the same count. */
function step8General(p, out, W, rows, cols, predatorOf, threshold, surround) {
  let o = 0;
  for (let i = 0; i < rows; i++) {
    let c = (i + 1) * W + 1;
    for (let j = 0; j < cols; j++, c++, o++) {
      const own = p[c], pr = predatorOf[own];
      const a = p[c - W], b = p[c + W], d = p[c - 1], e = p[c + 1];
      const f = p[c - W - 1], g = p[c - W + 1], h = p[c + W - 1], k = p[c + W + 1];
      const nw = sel(own, pr, ge(cnt8(pr, a, b, d, e, f, g, h, k), threshold));
      const ab = eq(a, b), ad = eq(a, d), ae = eq(a, e), af = eq(a, f), ag = eq(a, g), ah = eq(a, h), ak = eq(a, k);
      const bd = eq(b, d), be = eq(b, e), bf = eq(b, f), bg = eq(b, g), bh = eq(b, h), bk = eq(b, k);
      const de = eq(d, e), df = eq(d, f), dg = eq(d, g), dh = eq(d, h), dk = eq(d, k);
      const ef = eq(e, f), eg = eq(e, g), eh = eq(e, h), ek = eq(e, k);
      const fg = eq(f, g), fh = eq(f, h), fk = eq(f, k);
      const gh = eq(g, h), gk = eq(g, k), hk = eq(h, k);
      const ka = (1 + ab + ad + ae + af + ag + ah + ak) & other(a, own);
      const kb = (1 + ab + bd + be + bf + bg + bh + bk) & other(b, own);
      const kd = (1 + ad + bd + de + df + dg + dh + dk) & other(d, own);
      const ke = (1 + ae + be + de + ef + eg + eh + ek) & other(e, own);
      const kf = (1 + af + bf + df + ef + fg + fh + fk) & other(f, own);
      const kg = (1 + ag + bg + dg + eg + fg + gh + gk) & other(g, own);
      const kh = (1 + ah + bh + dh + eh + fh + gh + hk) & other(h, own);
      const kk = (1 + ak + bk + dk + ek + fk + gk + hk) & other(k, own);
      const best = mx(mx(mx(ka, kb), mx(kd, ke)), mx(mx(kf, kg), mx(kh, kk)));
      // Winner: scan from the last neighbour to the first so the first best stays.
      let w = sel(0, k, eq(kk, best));
      w = sel(w, h, eq(kh, best)); w = sel(w, g, eq(kg, best)); w = sel(w, f, eq(kf, best));
      w = sel(w, e, eq(ke, best)); w = sel(w, d, eq(kd, best)); w = sel(w, b, eq(kb, best));
      w = sel(w, a, eq(ka, best));
      const tie = (eq(ka, best) & ne(a, w)) | (eq(kb, best) & ne(b, w)) | (eq(kd, best) & ne(d, w))
        | (eq(ke, best) & ne(e, w)) | (eq(kf, best) & ne(f, w)) | (eq(kg, best) & ne(g, w))
        | (eq(kh, best) & ne(h, w)) | (eq(kk, best) & ne(k, w));
      out[o] = sel(nw, w, ge(best, surround) & (1 - tie));
    }
  }
}

function step4Off(p, out, W, rows, cols, predatorOf, threshold) {
  let o = 0;
  for (let i = 0; i < rows; i++) {
    let c = (i + 1) * W + 1;
    for (let j = 0; j < cols; j++, c++, o++) {
      const own = p[c], pr = predatorOf[own];
      const a = p[c - W], b = p[c + W], d = p[c - 1], e = p[c + 1];
      out[o] = sel(own, pr, ge(cnt4(pr, a, b, d, e), threshold));
    }
  }
}

function step4Majority(p, out, W, rows, cols, predatorOf, threshold, surround) {
  const m = 5 - surround; // number of candidates (1..2)
  let o = 0;
  for (let i = 0; i < rows; i++) {
    let c = (i + 1) * W + 1;
    for (let j = 0; j < cols; j++, c++, o++) {
      const own = p[c], pr = predatorOf[own];
      const a = p[c - W], b = p[c + W], d = p[c - 1], e = p[c + 1];
      let nw = sel(own, pr, ge(cnt4(pr, a, b, d, e), threshold));
      nw = major(nw, a, cnt4(a, a, b, d, e), own, surround);
      if (m > 1) nw = major(nw, b, cnt4(b, a, b, d, e), own, surround);
      out[o] = nw;
    }
  }
}

function step4General(p, out, W, rows, cols, predatorOf, threshold, surround) {
  let o = 0;
  for (let i = 0; i < rows; i++) {
    let c = (i + 1) * W + 1;
    for (let j = 0; j < cols; j++, c++, o++) {
      const own = p[c], pr = predatorOf[own];
      const a = p[c - W], b = p[c + W], d = p[c - 1], e = p[c + 1];
      const nw = sel(own, pr, ge(cnt4(pr, a, b, d, e), threshold));
      const ab = eq(a, b), ad = eq(a, d), ae = eq(a, e), bd = eq(b, d), be = eq(b, e), de = eq(d, e);
      const ka = (1 + ab + ad + ae) & other(a, own);
      const kb = (1 + ab + bd + be) & other(b, own);
      const kd = (1 + ad + bd + de) & other(d, own);
      const ke = (1 + ae + be + de) & other(e, own);
      const best = mx(mx(ka, kb), mx(kd, ke));
      let w = sel(0, e, eq(ke, best));
      w = sel(w, d, eq(kd, best)); w = sel(w, b, eq(kb, best)); w = sel(w, a, eq(ka, best));
      const tie = (eq(ka, best) & ne(a, w)) | (eq(kb, best) & ne(b, w))
        | (eq(kd, best) & ne(d, w)) | (eq(ke, best) & ne(e, w));
      out[o] = sel(nw, w, ge(best, surround) & (1 - tie));
    }
  }
}

const KERNELS_8 = [step8Off, step8Majority, step8General];
const KERNELS_4 = [step4Off, step4Majority, step4General];
