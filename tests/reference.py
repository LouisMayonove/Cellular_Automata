"""Reference runner for tests/crosscheck.mjs: runs the original Python engine
(ca_core.py) on the cases read from stdin and prints the results as JSON.

Usage (called by crosscheck.mjs):
    uv run --no-project --with numpy --with numba python tests/reference.py <dir of ca_core.py>

Input:  {"cases": [{"rows", "cols", "n_colors", "connectivity", "threshold",
          "surround", "wrap", "steps", "grid": [flat list]}, ...]}
Output: {"results": [{"grid": [flat list], "cycle": [first, period] | null,
          "step_count": int}, ...]}
"""

import json
import sys

import numpy as np

sys.path.insert(0, sys.argv[1])
import ca_core as core  # noqa: E402


def run(case):
    rows, cols = case["rows"], case["cols"]
    grid = np.array(case["grid"], dtype=np.uint8).reshape(rows, cols)
    ca = core.CyclicAutomaton(
        rows, cols, n_colors=case["n_colors"], connectivity=case["connectivity"],
        threshold=case["threshold"], surround_threshold=case["surround"],
        wrap=case["wrap"], grid=grid)
    for _ in range(case["steps"]):
        ca.step()
    return {
        "grid": ca.grid.ravel().tolist(),
        "cycle": list(ca.cycle) if ca.cycle is not None else None,
        "step_count": ca.step_count,
    }


def main():
    cases = json.load(sys.stdin)["cases"]
    json.dump({"results": [run(c) for c in cases]}, sys.stdout)


if __name__ == "__main__":
    main()
