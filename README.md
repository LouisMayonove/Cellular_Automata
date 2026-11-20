# Cyclic cellular automaton

A browser version of a "rock-paper-scissors" cellular automaton. Each cell holds
one of K colors in a cycle where color *i* is beaten by color *i + 1* (by
default red, blue, yellow: blue beats red, red beats yellow, yellow beats blue).
All cells update at the same time:

- **beating rule:** if at least `threshold` neighbours (4 or 8) have the color
  that beats the cell, it takes that color;
- **surround rule** (optional): if at least `surround` neighbours share one other
  color, the cell takes it, whatever their relationship (skipped on ties). It
  overrides the beating rule.

Because the rule is deterministic, a board that repeats means the automaton
loops forever: the app detects it, records one full cycle and can pause there,
showing the exact average color and activity over the cycle.

The page is plain HTML, CSS and JavaScript: no build step, no dependencies.

## Using it

- **Simulation tab:** Start / Pause, Step and Stop (back to the starting board),
  a speed limit, the starting pattern (random, blocks, spiral seeds, stripes…)
  and which panels to show: the board, the average color and the activity
  (how often each cell changed) over the last steps, and a color histogram.
- **Settings tab:** presets, grid size, neighbourhood, thresholds, wrapping
  edges, the colors in cycle order, the statistics window and cycle handling.
  Rule and color changes apply to the running board.
- **Keys** (simulation tab): Space = run/pause, Right = one step, R = stop.

## How it stays fast

- The simulation runs in a **Web Worker** and draws straight into the panel
  canvases (OffscreenCanvas), so the page stays responsive at full speed.
  Canvases are the size of the grid and scaled by the GPU.
- The update kernels are **branch-free** (neighbour comparisons turned into
  0/1 arithmetic), with a separate small kernel per rule family; on noisy
  boards this is 3-4x faster than a straightforward version.
- Statistics are kept as integer running sums, updated in one pass per step,
  and only while a panel shows them.

## Files

| Path | What it does |
| --- | --- |
| `index.html`, `style.css` | Page layout and theme (light/dark, phone layout) |
| `js/main.js` | Wires the controls, tabs and keys; talks to the worker |
| `js/worker.js` | Simulation model, run loop, rendering of the image panels |
| `js/config.js` | Defaults, speeds, presets, color sets |
| `js/core/automaton.js` | The automaton: step kernels, edges, cycle detection |
| `js/core/stats.js` | Window statistics, cycle recorder, histogram helpers |
| `js/core/patterns.js`, `js/core/rng.js` | Starting patterns, seeded random numbers |
| `js/core/render.js` | Pixel renderers (palette, average, heat map) |
| `js/ui/` | Settings form, color editor, histogram panel |
| `tests/` | Unit tests and the cross-check against the Python engine |

## Run locally

ES modules and Web Workers need a web server (opening `index.html` from disk
won't work). From this folder:

```sh
python -m http.server 8000
```

then open <http://localhost:8000>.

## Publish on GitHub Pages (free)

1. Push this repository to GitHub (public).
2. Repository **Settings → Pages → Build and deployment → Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. After a minute the app is live at `https://<user>.github.io/<repo>/`.

## Tests

Unit tests (patterns, statistics) need only [Node.js](https://nodejs.org):

```sh
node --test "tests/*.test.mjs"
```

`tests/crosscheck.mjs` runs the original Python engine (`ca_core.py`) and this
JavaScript engine on the same boards, for every rule combination, and checks
that the boards and detected cycles are identical cell for cell. It also needs
[uv](https://docs.astral.sh/uv/), which fetches numpy and numba:

```sh
node tests/crosscheck.mjs "<folder containing ca_core.py>"
```

## Differences from the desktop version

- The same seed gives a different starting board (the browser has no numpy).
- The statistics window is limited to 512 MB instead of 2 GB.
- The simulation uses one CPU core (numba used all of them).
