// Unit tests for the statistics, against brute-force references.
// Run with: node --test "tests/*.test.mjs"

import test from "node:test";
import assert from "node:assert/strict";
import {
  WindowStats, CycleRecorder, FadingAverage, alphaForHalfLife, colorCounts, histogram, quantile, stdDev,
} from "../js/core/stats.js";
import { activityLevels } from "../js/core/render.js";
import { Rng } from "../js/core/rng.js";

const PALETTE = [[255, 0, 0], [0, 0, 255], [255, 255, 0], [10, 200, 30]];

function randomBoards(count, cells, n, seed) {
  const rng = new Rng(seed);
  return Array.from({ length: count }, () => Uint8Array.from({ length: cells }, () => rng.int(0, n)));
}

/** Sums and changes over `boards` computed the slow, obvious way. */
function naive(boards, cells) {
  const sum = [new Int32Array(cells), new Int32Array(cells), new Int32Array(cells)];
  const changes = new Int32Array(cells);
  boards.forEach((b, t) => {
    for (let i = 0; i < cells; i++) {
      for (let k = 0; k < 3; k++) sum[k][i] += PALETTE[b[i]][k];
      if (t > 0 && b[i] !== boards[t - 1][i]) changes[i]++;
    }
  });
  return { sum, changes };
}

test("window statistics match a brute-force recount at every step", () => {
  const cells = 50;
  const boards = randomBoards(40, cells, 4, 1);
  for (const window of [1, 2, 3, 7, 40, 100]) {
    const stats = new WindowStats(boards[0], PALETTE, window);
    for (let t = 0; t < boards.length; t++) {
      if (t > 0) stats.push(boards[t]);
      const inWindow = boards.slice(Math.max(0, t + 1 - window), t + 1);
      const ref = naive(inWindow, cells);
      assert.equal(stats.size, inWindow.length);
      assert.deepEqual(stats.sumR, ref.sum[0], `window ${window}, step ${t}: red`);
      assert.deepEqual(stats.sumG, ref.sum[1], `window ${window}, step ${t}: green`);
      assert.deepEqual(stats.sumB, ref.sum[2], `window ${window}, step ${t}: blue`);
      assert.deepEqual(stats.changes, ref.changes, `window ${window}, step ${t}: changes`);
    }
  }
});

test("cycle recorder: exact sums over one cycle, closing change included", () => {
  const cells = 30;
  for (const period of [1, 2, 5]) {
    const boards = randomBoards(period, cells, 3, period);
    const rec = new CycleRecorder(boards[0], PALETTE, period);
    for (let t = 1; t < period; t++) {
      assert.equal(rec.complete, false);
      rec.add(boards[t]);
    }
    assert.equal(rec.complete, true);
    const ref = naive([...boards, boards[0]], cells); // includes closing transition
    for (let k = 0; k < 3; k++) {
      // the closing board is counted once in `ref.sum`, so remove it
      const expected = ref.sum[k].map((s, i) => s - PALETTE[boards[0][i]][k]);
      assert.deepEqual([rec.sumR, rec.sumG, rec.sumB][k], expected);
    }
    assert.deepEqual(rec.changes, ref.changes, `period ${period}`);
  }
});

test("color counts", () => {
  assert.deepEqual(colorCounts(Uint8Array.from([0, 2, 2, 1, 2, 0]), 4), [2, 1, 3, 0]);
});

test("histogram and quantiles", () => {
  const hist = histogram(Int32Array.from([3, 0, 3, 1, 3, 7]));
  assert.deepEqual([...hist], [1, 1, 0, 3, 0, 0, 0, 1]);
  assert.equal(quantile(hist, 0.5), 3);
  assert.equal(quantile(hist, 0.25), 1);
  assert.equal(quantile(hist, 1), 7);
  assert.deepEqual([...histogram(new Int32Array(4))], [4]);
});

test("standard deviation from a histogram matches the direct formula", () => {
  const rng = new Rng(5);
  const values = Int32Array.from({ length: 1000 }, () => rng.int(0, 30));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const direct = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  assert.ok(Math.abs(stdDev(histogram(values)) - direct) < 1e-9);
  assert.equal(stdDev(histogram(new Int32Array(10).fill(4))), 0);
});

test("activity levels: 0 is black, max brightest, every count its own shade", () => {
  for (const [max, center, width] of [[0, 0, 1], [1, 0, 1], [5, 2, 1], [19, 12, 2], [100, 40, 10], [100, 3, 1]]) {
    const levels = activityLevels(max, center, width);
    assert.equal(levels.length, max + 1);
    assert.equal(levels[0], 0);
    if (max > 0) assert.equal(levels[max], 255);
    for (let v = 1; v <= max; v++) {
      assert.ok(levels[v] >= levels[v - 1], `max ${max}: not increasing at ${v}`);
    }
  }
  // Around the median the curve is steep: neighbouring counts differ clearly.
  const typical = activityLevels(19, 12, 2);
  assert.ok(typical[13] - typical[12] > 25);
  // Neither end is clipped: quiet cells (1 vs 2 changes) still differ.
  assert.ok(typical[2] > typical[1]);
});

test("fading average: weights 1/2, 1/4, 1/8... for a half-life of 1 step", () => {
  assert.equal(alphaForHalfLife(1), 0.5);
  assert.ok(Math.abs((1 - alphaForHalfLife(10)) ** 10 - 0.5) < 1e-12);
  // One cell: start on color 0, then colors 1, 2, 3 (red channels 0, 0, 255, 10).
  const pal = [[100, 0, 0], [0, 0, 0], [255, 0, 0], [10, 0, 0]];
  const avg = new FadingAverage(Uint8Array.from([0]), pal, 0.5);
  for (const c of [1, 2, 3]) avg.push(Uint8Array.from([c]));
  // newest 1/2, then 1/4, 1/8, and the starting color keeps the rest (1/8)
  const expected = 10 / 2 + 255 / 4 + 0 / 8 + 100 / 8;
  assert.ok(Math.abs(avg.r[0] - expected) < 1e-3, `${avg.r[0]} vs ${expected}`);
});
