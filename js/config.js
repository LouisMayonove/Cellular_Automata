// Shared constants and settings, used by the page and the worker.

/** Speed slider positions (steps per second); null = as fast as possible. */
export const SPEEDS = [1, 2, 3, 5, 10, 20, 30, 40, 50, 100, 200, 300, 500, 1000, 2000, 5000, null];

export const PANELS = ["board", "average", "fading", "activity", "histogram", "activityHist"];
export const PANEL_NAMES = {
  board: "Board", average: "Average color", fading: "Fading average", activity: "Activity",
  histogram: "Color histogram",
  activityHist: "Activity histogram",
};
/** Panels that need the sliding-window statistics. */
export const WINDOW_PANELS = ["average", "activity", "activityHist"];

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
    halfLife: 1, // fading average: weights halve every `halfLife` steps (1: 1/2, 1/4, 1/8, ...)
    stopOnCycle: true,
  };
}

// --- Fading average ------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Number of most recent steps that make up 99 % of a fading average with
 *  this half-life: weights halve every h steps, so the last K boards hold
 *  1 - 2^(-K/h) of the total, which reaches 99 % at K = h * log2(100). */
export function stepsFor99(halfLife) {
  return Math.ceil(halfLife * Math.log2(100));
}

/** Plain-words meaning of a half-life, for the settings hint. */
export function describeHalfLife(h) {
  const first = h === 1
    ? "Each step keeps half of the previous average and adds half of the current color: "
      + "the previous board counts half as much as the current one, the one before a quarter, and so on."
    : `A board from ${plural(h, "step")} ago counts half as much as the current one, `
      + `from ${2 * h} steps ago a quarter, and so on.`;
  return `${first} The last ${plural(stepsFor99(h), "step")} make up 99% of the image. `
    + "Larger values remember longer and look smoother.";
}

/** Short version for the panel caption. */
export function captionHalfLife(h) {
  return `a color ${plural(h, "step")} old counts half as much as the current one; `
    + `99% of the image comes from the last ${plural(stepsFor99(h), "step")}`;
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

// --- Presets -------------------------------------------------------------------
// Presets only fill the settings form (Apply makes them take effect); they
// never touch the simulation tab. Group presets fill one section of the form;
// full presets (PRESETS) fill every field. Colors have their own sets
// (COLOR_SETS, in the color editor).

export const SIZE_PRESETS = {
  "Tiny (50 × 50)": { rows: 50, cols: 50 },
  "Small (100 × 100)": { rows: 100, cols: 100 },
  "Medium (150 × 150)": { rows: 150, cols: 150 },
  "Large (300 × 300)": { rows: 300, cols: 300 },
  "Huge (600 × 600)": { rows: 600, cols: 600 },
  "Wide (150 × 300)": { rows: 150, cols: 300 },
};

export const RULE_PRESETS = {
  "Default: Moore, beat 3, surround 7": { connectivity: 8, threshold: 3, surround: 7 },
  "Spirals: Moore, beat 3, no surround": { connectivity: 8, threshold: 3, surround: 0 },
  "Fast fronts: Moore, beat 1": { connectivity: 8, threshold: 1, surround: 0 },
  "Wheel spirals: Moore, beat 2": { connectivity: 8, threshold: 2, surround: 0 },
  "Rainbow: Moore, beat 2, surround 4": { connectivity: 8, threshold: 2, surround: 4 },
  "Smooth blobs: Moore, beat 3, surround 5": { connectivity: 8, threshold: 3, surround: 5 },
  "Classic CCA: von Neumann, beat 1": { connectivity: 4, threshold: 1, surround: 0 },
  "Diamonds: von Neumann, beat 2, surround 3": { connectivity: 4, threshold: 2, surround: 3 },
};

export const MEMORY_PRESETS = {
  "Short: window 20, half-life 1": { window: 20, halfLife: 1 },
  "Default: window 100, half-life 1": { window: 100, halfLife: 1 },
  "Smooth: window 200, half-life 10": { window: 200, halfLife: 10 },
  "Long: window 500, half-life 30": { window: 500, halfLife: 30 },
};

/** A full preset from one preset of each group, plus edges and colors. */
function full(size, rules, wrap, colors, memory) {
  const pick = (group, prefix) => {
    const key = Object.keys(group).find((k) => k.startsWith(prefix));
    if (!key) throw new Error(`no preset "${prefix}"`);
    return group[key];
  };
  return {
    ...pick(SIZE_PRESETS, size), ...pick(RULE_PRESETS, rules), wrap, colors,
    ...pick(MEMORY_PRESETS, memory), stopOnCycle: true,
  };
}

export const PRESETS = {
  "Default (3 colors, medium board)":
    full("Medium", "Default", true, DEFAULT_COLORS, "Default"),
  "Rainbow (6 colors, edges don't wrap)":
    full("Medium", "Rainbow", false, ["yellow", "green", "blue", "purple", "red", "orange"], "Smooth"),
  "Spirals 3-3-3 (no surround rule)":
    full("Medium", "Spirals", true, DEFAULT_COLORS, "Default"),
  "Fast fronts (3 colors, threshold 1)":
    full("Large", "Fast fronts", true, DEFAULT_COLORS, "Short"),
  "Classic CCA (14 colors, von Neumann)":
    full("Large", "Classic CCA", true, hueColors(14), "Default"),
  "Color-wheel spirals (8 colors)":
    full("Large", "Wheel spirals", true, hueColors(8), "Smooth"),
  "Smooth blobs (4 colors, strong surround rule)":
    full("Medium", "Smooth blobs", true, ["red", "blue", "yellow", "green"], "Smooth"),
  "Walled box (small board, edges don't wrap)":
    full("Small", "Default", false, DEFAULT_COLORS, "Default"),
  "Big spirals (600 × 600)":
    full("Huge", "Spirals", true, DEFAULT_COLORS, "Short"),
};

// --- Color editor ----------------------------------------------------------------

/** Quick-pick swatches, shown 8 per row when changing or adding a color. */
export const SWATCHES = [
  "#e62828", "#f57c00", "#f5d000", "#8bc34a", "#2e9e44", "#00a5a5", "#2855e6", "#7b3fd0",
  "#ff6f91", "#ffb74d", "#fff176", "#c5e1a5", "#80cbc4", "#81d4fa", "#9fa8da", "#ce93d8",
  "#8b0000", "#8d5524", "#808000", "#1b5e20", "#004d40", "#0d1b6e", "#4a148c", "#880e4f",
  "#ffffff", "#d0d0d0", "#a0a0a0", "#707070", "#404040", "#000000", "#ff00ff", "#00ffff",
];

/** Whole color sets; a function takes the current number of colors (keeps the count). */
export const COLOR_SETS = {
  "Red / blue / yellow": ["red", "blue", "yellow"],
  "Rainbow (6)": ["yellow", "green", "blue", "purple", "red", "orange"],
  "Traffic lights (3)": ["#e62828", "#f5d000", "#2e9e44"],
  "CMY (3)": ["cyan", "magenta", "yellow"],
  "Fire (5)": ["#2b0000", "#8b0000", "#e62828", "#f57c00", "#f5d000"],
  "Ocean (5)": ["#0d1b6e", "#2855e6", "#00a5a5", "#80cbc4", "#e0f7fa"],
  "Forest (5)": ["#1b5e20", "#2e9e44", "#8bc34a", "#8d5524", "#f5d000"],
  "Color wheel (keep count)": (n) => hueColors(n),
  "Pastel wheel (keep count)": (n) => Array.from({ length: n }, (_, i) => hsvToHex(i / n, 0.35, 1)),
  "Grayscale (keep count)": (n) => Array.from({ length: n }, (_, i) => hsvToHex(0, 0, 0.1 + 0.85 * i / (n - 1))),
};
