// Unit tests for the statistics, against brute-force references.
// Run with: node --test "tests/*.test.mjs"

import test from "node:test";
import assert from "node:assert/strict";
import { WindowStats, CycleRecorder, colorCounts, medianAndMax } from "../js/core/stats.js";
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

test("median and max match sorting", () => {
  const rng = new Rng(9);
  for (const len of [1, 2, 3, 10, 101, 1000]) {
    const values = Int32Array.from({ length: len }, () => rng.int(0, 20));
    const sorted = [...values].sort((a, b) => a - b);
    const [median, top] = medianAndMax(values);
    assert.equal(top, sorted.at(-1));
    // numpy's searchsorted on the cumulative histogram = the lower median
    assert.equal(median, sorted[Math.floor((len + 1) / 2) - 1], `len ${len}`);
  }
});
