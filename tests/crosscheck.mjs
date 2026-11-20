// Cross-check the JS engine against the original Python engine (ca_core.py).
//
// Runs every rule combination (4 and 8 neighbours, every threshold, every
// surround threshold including off, wrapping and fixed edges, several color
// counts) on random and blocky boards, in both engines, and compares the
// final boards and the detected cycles cell by cell.
//
// Usage:
//   node tests/crosscheck.mjs <folder containing ca_core.py>
// Needs uv (https://docs.astral.sh/uv/), which fetches numpy and numba.
// The first run compiles the numba kernels and can take a minute.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CyclicAutomaton } from "../js/core/automaton.js";
import { Rng } from "../js/core/rng.js";

const coreDir = process.argv[2];
if (!coreDir) {
  console.error("usage: node tests/crosscheck.mjs <folder containing ca_core.py>");
  process.exit(2);
}

const rng = new Rng(12345);

function randomBoard(rows, cols, n) {
  return Array.from({ length: rows * cols }, () => rng.int(0, n));
}

function blockyBoard(rows, cols, n, size) {
  const small = Array.from({ length: Math.ceil(rows / size) * Math.ceil(cols / size) }, () => rng.int(0, n));
  const sc = Math.ceil(cols / size);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push(small[Math.floor(r / size) * sc + Math.floor(c / size)]);
  }
  return out;
}

// --- Build the cases ----------------------------------------------------------

const cases = [];
for (const connectivity of [4, 8]) {
  for (let threshold = 1; threshold <= connectivity; threshold++) {
    for (let surround = 0; surround <= connectivity; surround++) {
      for (const wrap of [true, false]) {
        for (const n of [2, 3, 6]) {
          // Small noisy board: many ties and rule boundaries.
          cases.push({ rows: 11, cols: 13, n_colors: n, connectivity, threshold, surround, wrap,
                       steps: 25, grid: randomBoard(11, 13, n) });
        }
        // Larger blocky board: fronts and spirals, often reaches a cycle.
        cases.push({ rows: 40, cols: 52, n_colors: 3, connectivity, threshold, surround, wrap,
                     steps: 120, grid: blockyBoard(40, 52, 3, 3) });
      }
    }
  }
}
// A few many-color boards (the classic CCA uses 14 colors).
for (const [connectivity, threshold, surround] of [[4, 1, 0], [8, 2, 0], [8, 2, 4], [8, 3, 5]]) {
  cases.push({ rows: 30, cols: 30, n_colors: 14, connectivity, threshold, surround, wrap: true,
               steps: 200, grid: randomBoard(30, 30, 14) });
}
// Thin boards: 1-3 rows or columns stress the wrapping corners.
for (const [rows, cols] of [[1, 7], [7, 1], [2, 2], [3, 9]]) {
  for (const wrap of [true, false]) {
    cases.push({ rows, cols, n_colors: 3, connectivity: 8, threshold: 1, surround: 3, wrap,
                 steps: 15, grid: randomBoard(rows, cols, 3) });
  }
}

// --- Run the Python reference -------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
console.log(`Running ${cases.length} cases in the Python engine (uv + numba)...`);
const py = spawnSync(
  "uv", ["run", "--no-project", "--with", "numpy", "--with", "numba", "python",
         path.join(here, "reference.py"), coreDir],
  { input: JSON.stringify({ cases }), maxBuffer: 1 << 28, encoding: "utf8" });
if (py.status !== 0) {
  console.error(py.stderr || py.error);
  process.exit(1);
}
const { results } = JSON.parse(py.stdout);

// --- Run the JS engine and compare --------------------------------------------

let failures = 0;
const t0 = performance.now();
cases.forEach((c, i) => {
  const ca = new CyclicAutomaton(c.rows, c.cols, c.n_colors, {
    connectivity: c.connectivity, threshold: c.threshold, surround: c.surround,
    wrap: c.wrap, grid: Uint8Array.from(c.grid),
  });
  for (let s = 0; s < c.steps; s++) ca.step();
  const ref = results[i];
  const label = `case ${i} (${c.rows}x${c.cols}, ${c.n_colors} colors, conn ${c.connectivity}, `
    + `threshold ${c.threshold}, surround ${c.surround}, wrap ${c.wrap})`;
  let diff = 0;
  for (let k = 0; k < ca.grid.length; k++) if (ca.grid[k] !== ref.grid[k]) diff++;
  const jsCycle = ca.cycle ? [ca.cycle.first, ca.cycle.period] : null;
  const sameCycle = JSON.stringify(jsCycle) === JSON.stringify(ref.cycle);
  if (diff || !sameCycle || ca.stepCount !== ref.step_count) {
    failures++;
    if (failures <= 10) {
      console.log(`FAIL ${label}: ${diff} cells differ, cycle JS ${JSON.stringify(jsCycle)} `
        + `vs Python ${JSON.stringify(ref.cycle)}`);
    }
  }
});

const cycles = results.filter((r) => r.cycle).length;
console.log(`${cases.length - failures}/${cases.length} cases identical `
  + `(${cycles} reached a cycle), JS took ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(failures ? 1 : 0);
