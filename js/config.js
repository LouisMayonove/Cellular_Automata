// Shared constants and settings, used by the page and the worker.

/** Speed slider positions (steps per second); null = as fast as possible. */
export const SPEEDS = [1, 2, 3, 5, 10, 20, 30, 40, 50, 100, 200, 300, 500, 1000, 2000, 5000, null];

export const PANELS = ["board", "average", "activity", "histogram"];
export const PANEL_NAMES = {
  board: "Board", average: "Average color", activity: "Activity", histogram: "Color histogram",
};
/** Panels that need the sliding-window statistics. */
export const WINDOW_PANELS = ["average", "activity"];

/** Largest statistics window allowed, in bytes (rows x cols x window). A
 *  browser tab has less memory than a desktop app (which allowed 2 GB). */
export const MAX_WINDOW_BYTES = 512e6;

export const DEFAULT_COLORS = ["red", "blue", "yellow"];

export function defaultConfig() {
  return {
    rows: 150,
    cols: 150,
    colors: [...DEFAULT_COLORS], // in cycle order: each one is beaten by the next
    connectivity: 8,
    threshold: 3,
    surround: 7, // 0 = surround rule off
    wrap: true,
    window: 100,
    stopOnCycle: true,
  };
}

// --- Colors ------------------------------------------------------------------

/** HSV (all in 0..1) to "#rrggbb", as Qt's QColor.fromHsvF(...).name(). */
export function hsvToHex(h, s, v) {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return "#" + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

/** n evenly spaced hues around the color wheel. */
export function hueColors(n) {
  return Array.from({ length: n }, (_, i) => hsvToHex(i / n, 0.85, 0.95));
}

let probe = null;

/** Any CSS color (name or hex) to [r, g, b]. Page thread only. */
export function cssToRgb(color) {
  if (!probe) probe = document.createElement("canvas").getContext("2d");
  probe.fillStyle = "#000000";
  probe.fillStyle = color;
  const hex = probe.fillStyle; // normalised to "#rrggbb" for opaque colors
  return [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
}

/** Any CSS color to "#rrggbb". Page thread only. */
export function cssToHex(color) {
  return "#" + cssToRgb(color).map((x) => x.toString(16).padStart(2, "0")).join("");
}
