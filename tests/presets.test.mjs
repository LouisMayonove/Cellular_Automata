// Presets: full presets set every setting, group presets only their own
// section, and every value is one the settings form accepts.
// Run with: node --test "tests/*.test.mjs"

import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESETS, SIZE_PRESETS, RULE_PRESETS, MEMORY_PRESETS, MAX_WINDOW_BYTES, defaultConfig,
  defaultHalfLife, stepsFor99,
} from "../js/config.js";

const FIELDS = Object.keys(defaultConfig()).sort();

function checkValues(v) {
  if ("rows" in v) {
    assert.ok(v.rows >= 2 && v.rows <= 5000 && v.cols >= 2 && v.cols <= 5000);
  }
  if ("connectivity" in v) {
    assert.ok([4, 8].includes(v.connectivity));
    assert.ok(v.threshold >= 1 && v.threshold <= v.connectivity);
    assert.ok(v.surround >= 0 && v.surround <= v.connectivity);
  }
  if ("window" in v) {
    assert.ok(v.window >= 1 && v.window <= 100000);
    assert.ok(v.halfLife >= 1 && v.halfLife <= 10000);
  }
  if ("colors" in v) assert.ok(v.colors.length >= 2);
}

test("full presets set every setting with valid values", () => {
  for (const [name, v] of Object.entries(PRESETS)) {
    assert.deepEqual(Object.keys(v).sort(), FIELDS, name);
    checkValues(v);
    assert.ok(v.rows * v.cols * v.window <= MAX_WINDOW_BYTES, `${name}: window too large`);
  }
});

test("group presets only set their own section", () => {
  const groups = [
    [SIZE_PRESETS, ["cols", "rows"]],
    [RULE_PRESETS, ["connectivity", "surround", "threshold"]],
    [MEMORY_PRESETS, ["halfLife", "window"]],
  ];
  for (const [group, fields] of groups) {
    for (const [name, v] of Object.entries(group)) {
      assert.deepEqual(Object.keys(v).sort(), fields, name);
      checkValues(v);
    }
  }
});

test("the largest board with the longest memory fits the window limit", () => {
  const cells = Math.max(...Object.values(SIZE_PRESETS).map((s) => s.rows * s.cols));
  const window = Math.max(...Object.values(MEMORY_PRESETS).map((m) => m.window));
  assert.ok(cells * window <= MAX_WINDOW_BYTES);
});

test("default half-life: 99 % of the fading average spans about 3/4 of the window", () => {
  for (const window of [50, 100, 200, 500, 1000]) {
    const share = stepsFor99(defaultHalfLife(window)) / window;
    assert.ok(share > 0.65 && share < 0.85, `window ${window}: ${share}`);
  }
  assert.equal(defaultConfig().halfLife, defaultHalfLife(defaultConfig().window));
  for (const { window, halfLife } of Object.values(MEMORY_PRESETS)) {
    assert.equal(halfLife, defaultHalfLife(window));
  }
});
