// Image renderers: write one 32-bit pixel per cell into a Uint32Array view of
// an ImageData buffer. ImageData bytes are R, G, B, A, so on little-endian
// machines (all current ones) a pixel reads as 0xAABBGGRR.

export function rgba32(r, g, b) {
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** [[r, g, b], ...] -> Uint32Array of pixels. */
export function palette32(palette) {
  return Uint32Array.from(palette, ([r, g, b]) => rgba32(r, g, b));
}

/** 256-entry dark-to-bright heat map (an approximation of 'inferno'):
 *  black -> purple -> red -> orange -> pale yellow. */
export function heatLut32() {
  const stops = [0.0, 0.15, 0.35, 0.55, 0.75, 0.9, 1.0];
  const colors = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
                  [212, 72, 66], [245, 125, 21], [252, 255, 164]];
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let s = 0;
    while (s < stops.length - 2 && x > stops[s + 1]) s++;
    const t = (x - stops[s]) / (stops[s + 1] - stops[s]);
    const [r, g, b] = [0, 1, 2].map((k) => Math.round(colors[s][k] + t * (colors[s + 1][k] - colors[s][k])));
    lut[i] = rgba32(r, g, b);
  }
  return lut;
}

export function renderPalette(grid, pal32, out) {
  for (let i = 0; i < grid.length; i++) out[i] = pal32[grid[i]];
}

/** out = sum // n per channel. (s + 0.5) / n stays strictly between the exact
 *  floor and the next integer, so truncating it gives s // n with a
 *  multiplication instead of a division. */
export function renderMean(sumR, sumG, sumB, n, out) {
  const inv = 1 / n;
  for (let i = 0; i < out.length; i++) {
    const r = ((sumR[i] + 0.5) * inv) | 0;
    const g = ((sumG[i] + 0.5) * inv) | 0;
    const b = ((sumB[i] + 0.5) * inv) | 0;
    out[i] = 0xff000000 | (b << 16) | (g << 8) | r;
  }
}

/** Map values from lo..hi onto the heat LUT (<= lo darkest). */
export function renderHeat(values, lo, hi, lut32, out) {
  const scale = 255 / Math.max(hi - lo, 1);
  for (let i = 0; i < out.length; i++) {
    let idx = ((values[i] - lo) * scale) | 0;
    idx = idx < 0 ? 0 : idx > 255 ? 255 : idx;
    out[i] = lut32[idx];
  }
}
