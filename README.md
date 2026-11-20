# Cyclic cellular automaton

A browser version of a "rock-paper-scissors" cellular automaton. Each cell holds
one of K colors in a cycle where color *i* is beaten by color *i + 1*. All cells
update at the same time:

- **beating rule:** if at least `threshold` neighbours (4 or 8) have the color
  that beats the cell, it takes that color;
- **surround rule** (optional): if at least `surround` neighbours share one other
  color, the cell takes it, whatever their relationship (skipped on ties).

The page is plain HTML, CSS and JavaScript: no build step, no dependencies.

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

`tests/crosscheck.mjs` runs the original Python engine (`ca_core.py`) and this
JavaScript engine on the same boards, for every rule combination, and checks
that the boards and detected cycles are identical cell for cell. It needs
[Node.js](https://nodejs.org) and [uv](https://docs.astral.sh/uv/):

```sh
node tests/crosscheck.mjs "<folder containing ca_core.py>"
```

Unit tests (patterns, statistics) need only Node.js:

```sh
node --test "tests/*.test.mjs"
```
