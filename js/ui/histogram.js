// Color histogram panel: each color's share of the board as a bar, on a
// fixed 0-100 % axis so bar heights stay comparable from frame to frame.
// Drawn on the page thread: it is a handful of rectangles.

export function drawHistogram(canvas, counts, colors) {
  const dpr = devicePixelRatio || 1;
  const box = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width * dpr));
  const h = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = box.width, H = box.height;
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);
  if (!counts) return;

  const total = counts.reduce((s, c) => s + c, 0) || 1;
  const left = 6, right = W - 6, top = 22, bottom = H - 8;
  const plotH = Math.max(1, bottom - top);

  ctx.strokeStyle = "#3c3c3c";
  ctx.lineWidth = 1;
  for (const frac of [0.25, 0.5, 0.75, 1]) { // gridlines every 25 %
    const y = Math.round(bottom - frac * plotH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  const n = counts.length;
  const slot = (right - left) / n;
  const barW = Math.max(1, Math.round(slot * 0.7));
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (let c = 0; c < n; c++) {
    const share = counts[c] / total;
    const barH = Math.round(share * plotH);
    const x = left + Math.round(c * slot + (slot - barW) / 2);
    ctx.fillStyle = colors[c];
    ctx.fillRect(x, bottom - barH, barW, barH);
    if (slot >= 30) { // label only when it fits
      ctx.fillStyle = "#dcdcdc";
      ctx.fillText(`${(share * 100).toFixed(1)}%`, x + barW / 2, Math.max(top - 4, bottom - barH - 3));
    }
  }
}
