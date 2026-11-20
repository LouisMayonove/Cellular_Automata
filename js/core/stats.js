// Per-cell statistics: a port of WindowStats, CycleRecorder, color_counts
// and median_and_max from ca_core.py. All totals are integers kept as running
// sums (no drift), stored planar: one Int32Array per RGB channel.

/** Palette as three Int32Array channel lookups. `palette` = [[r, g, b], ...]. */
function channels(palette) {
  return [0, 1, 2].map((k) => Int32Array.from(palette, (rgb) => rgb[k]));
}

/**
 * Per-cell statistics over the last `window` boards:
 * - average color: running sum of RGB values;
 * - activity: how many times each cell changed color between consecutive
 *   boards in the window (a window of W boards holds W - 1 transitions).
 * Both share one ring buffer of the last `window` boards, so each update
 * costs O(cells) whatever the window length.
 */
export class WindowStats {
  constructor(grid, palette, window) {
    const n = grid.length;
    this.window = window;
    this.cells = n;
    [this.palR, this.palG, this.palB] = channels(palette);
    this.buffer = new Uint8Array(window * n);
    this.sumR = new Int32Array(n);
    this.sumG = new Int32Array(n);
    this.sumB = new Int32Array(n);
    this.changes = new Int32Array(n);
    this.size = 0; // number of boards currently in the window
    this.pos = 0;  // next slot to write in the ring buffer
    this.push(grid);
  }

  _slot(k) {
    const n = this.cells;
    return this.buffer.subarray(k * n, (k + 1) * n);
  }

  push(grid) {
    const w = this.window, n = this.cells;
    const full = this.size === w;
    const last = this._slot((this.pos - 1 + w) % w); // newest board so far
    const oldest = this._slot(this.pos);              // slot about to be overwritten
    // The board after the oldest one; with a 1-board window that is the new
    // board itself, so the added and removed transitions cancel out.
    const second = w > 1 ? this._slot((this.pos + 1) % w) : grid;
    const { palR, palG, palB, sumR, sumG, sumB, changes } = this;
    const hasLast = this.size > 0 ? 1 : 0;
    if (full) {
      for (let i = 0; i < n; i++) {
        const a = grid[i], o = oldest[i];
        sumR[i] += palR[a] - palR[o];
        sumG[i] += palG[a] - palG[o];
        sumB[i] += palB[a] - palB[o];
        // + (new != last) - (oldest != second), branch-free
        changes[i] += ((-(a ^ last[i])) >>> 31) - ((-(o ^ second[i])) >>> 31);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const a = grid[i];
        sumR[i] += palR[a];
        sumG[i] += palG[a];
        sumB[i] += palB[a];
        changes[i] += ((-(a ^ last[i])) >>> 31) & hasLast;
      }
      this.size++;
    }
    oldest.set(grid);
    this.pos = (this.pos + 1) % w;
  }
}

/**
 * Exact average color and activity over one full cycle. Feed it the P
 * boards of a cycle of period P, starting with the board at which the cycle
 * was detected. Every whole number of cycles has the same average, so one
 * cycle is exact. Activity counts the changes between consecutive boards
 * plus the change from the last board back to the first (the cycle closing).
 */
export class CycleRecorder {
  constructor(grid, palette, period) {
    const n = grid.length;
    this.period = period;
    [this.palR, this.palG, this.palB] = channels(palette);
    this.sumR = new Int32Array(n);
    this.sumG = new Int32Array(n);
    this.sumB = new Int32Array(n);
    this.changes = new Int32Array(n);
    this.first = grid.slice();
    this.prev = grid.slice();
    this.seen = 1;
    this._accumulate(grid);
  }

  get complete() {
    return this.seen === this.period;
  }

  add(grid) {
    this._accumulate(grid);
    countChanges(this.changes, grid, this.prev);
    this.prev.set(grid);
    this.seen++;
    if (this.complete) countChanges(this.changes, this.first, this.prev); // close the cycle
  }

  _accumulate(grid) {
    const { palR, palG, palB, sumR, sumG, sumB } = this;
    for (let i = 0; i < grid.length; i++) {
      const a = grid[i];
      sumR[i] += palR[a];
      sumG[i] += palG[a];
      sumB[i] += palB[a];
    }
  }
}

/** changes += (a != b), in place. */
function countChanges(changes, a, b) {
  for (let i = 0; i < a.length; i++) changes[i] += (-(a[i] ^ b[i])) >>> 31;
}

/** Number of cells of each color, as an array of length n. */
export function colorCounts(grid, n) {
  const counts = new Int32Array(256);
  for (let i = 0; i < grid.length; i++) counts[grid[i]]++;
  return Array.from(counts.subarray(0, n));
}

/** Median and max of small non-negative integer counts, via a histogram
 *  (much faster than sorting a large board). */
export function medianAndMax(values) {
  let top = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > top) top = values[i];
  const hist = new Int32Array(top + 1);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  // First value whose cumulative count reaches (size + 1) // 2, as
  // np.searchsorted(np.cumsum(hist), (size + 1) // 2) does.
  const target = Math.floor((values.length + 1) / 2);
  let acc = 0, median = 0;
  for (; median <= top; median++) {
    acc += hist[median];
    if (acc >= target) break;
  }
  return [median, top];
}
