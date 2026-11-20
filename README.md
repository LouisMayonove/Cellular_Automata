# Cyclic Cellular Automaton

Rock-paper-scissors cellular automata in the browser: pick the rules, hit Start and watch spirals form.

**[▶ Try it online](https://louismayonove.github.io/Cellular_Automata/)**

## How it works

Every cell holds one of K colors arranged in a cycle, where each color is beaten by the next one (red → blue → yellow → red…). At each step, all cells update at once:

- **Beating rule:** a cell takes the color that beats it if at least *threshold* of its neighbours have that color.
- **Surround rule** (optional): a cell takes any color held by at least *surround* of its neighbours.

The rules are deterministic, so when a board repeats, the automaton loops forever. The app spots this and can pause on the cycle.

## Features

- 4 or 8 neighbours, adjustable thresholds, wrapping or walled edges
- Up to 255 colors, with an editor to pick and reorder them
- Starting patterns: random, blocks, spiral seeds, stripes, sprinkle
- Live panels: board, average color, activity heat map, color histogram
- Presets to get interesting results quickly
- Fast and responsive, on desktop and mobile

**Keyboard:** `Space` run/pause · `→` step · `R` reset

## Run locally

No build step and no dependencies. Serve the folder with any static server:

```sh
python -m http.server
```

Then open http://localhost:8000.

## Code overview

```
index.html, style.css   page and layout
js/main.js              UI wiring
js/worker.js            simulation loop and rendering (Web Worker)
js/core/                engine: automaton, statistics, patterns, renderers
js/ui/                  settings form, color editor, histogram
tests/                  unit tests and the cross-check against the Python engine
```

The simulation runs in a Web Worker and draws straight to the canvases (OffscreenCanvas), so the page stays responsive. The update kernels avoid branches, which makes them much faster on noisy boards.

Run the tests with `node --test "tests/*.test.mjs"`.

## License

[MIT](LICENSE)
