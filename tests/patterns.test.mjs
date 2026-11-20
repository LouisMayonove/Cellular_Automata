// Unit tests for the starting patterns. Run with: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import { PATTERNS, makeBoard, initStripes, initSectors, initSprinkle, initRandom } from "../js/core/patterns.js";
import { Rng } from "../js/core/rng.js";

test("every pattern gives a board of the right size with valid colors", () => {
  for (const [name, p] of Object.entries(PATTERNS)) {
    for (const [rows, cols] of [[1, 1], [3, 50], [64, 64], [37, 101]]) {
      for (const n of [2, 3, 14]) {
        const board = makeBoard(name, p.def, 7, rows, cols, n);
        assert.equal(board.length, rows * cols, name);
        assert.ok(board.every((v) => v < n), `${name}: color out of range`);
      }
    }
  }
});

test("the same seed gives the same board, another seed a different one", () => {
  for (const name of ["Random", "Blocks", "Spiral seeds on noise", "Sprinkle"]) {
    const p = PATTERNS[name];
    const a = makeBoard(name, p.def, 42, 60, 60, 3);
    const b = makeBoard(name, p.def, 42, 60, 60, 3);
    const c = makeBoard(name, p.def, 43, 60, 60, 3);
    assert.deepEqual(a, b, name);
    assert.notDeepEqual(a, c, name);
  }
});

test("stripes are bands of the given width in cycle order", () => {
  const b = initStripes(2, 9, 3, null, 2);
  assert.deepEqual([...b], [0, 0, 1, 1, 2, 2, 0, 0, 1, 0, 0, 1, 1, 2, 2, 0, 0, 1]);
});

test("sectors put each color in its own slice, in cycle order", () => {
  const b = initSectors(9, 9, 4, null, 0);
  // atan2 angle 0 points right; angles grow clockwise on screen (y down).
  assert.equal(b[4 * 9 + 8], 0); // right
  assert.equal(b[8 * 9 + 4], 1); // bottom
  assert.equal(b[4 * 9 + 0], 2); // left
  assert.equal(b[0 * 9 + 4], 3); // top
});

test("sprinkle keeps about the requested share of other colors", () => {
  const b = initSprinkle(200, 200, 3, new Rng(1), 25);
  const share = b.reduce((s, v) => s + (v !== 0), 0) / b.length;
  assert.ok(Math.abs(share - 0.25) < 0.01, `share ${share}`);
  assert.ok(initSprinkle(50, 50, 3, new Rng(1), 0).every((v) => v === 0));
});

test("random colors are about equally frequent; weights are respected", () => {
  const b = initRandom(300, 300, 3, new Rng(2));
  const counts = [0, 0, 0];
  for (const v of b) counts[v]++;
  for (const c of counts) assert.ok(Math.abs(c / b.length - 1 / 3) < 0.01);
  const w = initRandom(300, 300, 2, new Rng(3), [3, 1]);
  const share1 = w.reduce((s, v) => s + v, 0) / w.length;
  assert.ok(Math.abs(share1 - 0.25) < 0.01, `share ${share1}`);
});

test("twisted sectors are wound the way the spiral turns (it keeps its shape)", async () => {
  const { CyclicAutomaton } = await import("../js/core/automaton.js");
  const N = 81, n = 3, turns = 6;
  const seed = initSectors(N, N, n, null, turns);
  const ca = new CyclicAutomaton(N, N, n, { connectivity: 8, threshold: 3, surround: 0, wrap: true, grid: seed });
  for (let i = 0; i < 30; i++) ca.step();
  // Best match with the seed's colors shifted by a constant (a pure rotation).
  let best = 0;
  for (let k = 0; k < n; k++) {
    let m = 0;
    for (let i = 0; i < seed.length; i++) m += (seed[i] + k) % n === ca.grid[i];
    best = Math.max(best, m / seed.length);
  }
  assert.ok(best > 0.6, `only ${(100 * best).toFixed(0)}% of the shape kept`);
});
