// Color cycle editor: numbered swatches in cycle order (each color is beaten
// by the next). Drag or ◀ ▶ to reorder, double-click a swatch to change it,
// + / − to add or remove, a dropdown of whole color sets, and Reverse.
// Port of ColorListEditor from ca_app.py.

import { SWATCHES, COLOR_SETS, hsvToHex, cssToRgb, cssToHex } from "../config.js";

const MAX_COLORS = 255;
const MIN_COLORS = 2;

export function createColorEditor() {
  const element = document.createElement("div");
  element.className = "color-editor";
  element.innerHTML = `
    <div class="swatches" role="listbox" aria-label="Colors in cycle order"></div>
    <div class="color-buttons">
      <button type="button" data-act="left" title="Move the selected color earlier in the cycle">◀</button>
      <button type="button" data-act="right" title="Move the selected color later in the cycle">▶</button>
      <button type="button" data-act="add" title="Add a color (after the selected one, or at the end)">+</button>
      <button type="button" data-act="remove" title="Remove the selected color (or the last one)">−</button>
      <button type="button" data-act="change" title="Change the selected color">✎</button>
      <button type="button" data-act="reverse" title="Reverse the cycle order">⇄</button>
      <select data-act="sets" title="Replace all the colors with a preset set">
        <option value="">Color set…</option>
      </select>
    </div>
    <p class="hint">Click to select · drag to reorder · double-click a color to change it</p>`;

  const list = element.querySelector(".swatches");
  const btn = (act) => element.querySelector(`[data-act="${act}"]`);
  const sets = btn("sets");
  for (const name of Object.keys(COLOR_SETS)) sets.add(new Option(name, name));

  let colors = [];
  let selected = -1;
  let dragFrom = -1;

  function setColors(next, select = -1) {
    colors = [...next];
    selected = select;
    render();
  }

  /** Show the color set the colors currently match, if any. */
  function syncSets() {
    const key = colors.join();
    sets.value = Object.keys(COLOR_SETS).find((name) => {
      const v = COLOR_SETS[name];
      return (typeof v === "function" ? v(colors.length) : v).join() === key;
    }) ?? "";
  }

  function render() {
    syncSets();
    list.textContent = "";
    const n = colors.length;
    colors.forEach((c, i) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "swatch";
      sw.role = "option";
      sw.draggable = true;
      sw.style.background = c;
      const [r, g, b] = cssToRgb(c);
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
      sw.style.color = lightness > 0.55 ? "#000" : "#fff";
      sw.textContent = i + 1;
      sw.title = `Color ${i + 1}: ${c}, beaten by color ${(i + 1) % n + 1}`;
      sw.setAttribute("aria-selected", String(i === selected));
      sw.addEventListener("click", () => { selected = i; render(); list.children[i].focus(); });
      sw.addEventListener("dblclick", () => { selected = i; render(); changeSelected(); });
      sw.addEventListener("dragstart", (e) => {
        dragFrom = i;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      });
      sw.addEventListener("dragover", (e) => { e.preventDefault(); sw.classList.add("drop"); });
      sw.addEventListener("dragleave", () => sw.classList.remove("drop"));
      sw.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragFrom < 0 || dragFrom === i) return;
        const moved = colors.splice(dragFrom, 1)[0];
        colors.splice(i, 0, moved);
        selected = i;
        dragFrom = -1;
        render();
      });
      sw.addEventListener("dragend", () => { dragFrom = -1; });
      list.append(sw);
    });
    btn("left").disabled = selected <= 0;
    btn("right").disabled = selected < 0 || selected >= n - 1;
    btn("add").disabled = n >= MAX_COLORS;
    btn("remove").disabled = n <= MIN_COLORS;
    btn("change").disabled = selected < 0;
  }

  function move(delta) {
    const to = selected + delta;
    if (selected < 0 || to < 0 || to >= colors.length) return;
    [colors[selected], colors[to]] = [colors[to], colors[selected]];
    selected = to;
    render();
  }

  function changeSelected() {
    if (selected < 0) return;
    const i = selected;
    openPicker(list.children[i], colors[i], (c) => { colors[i] = c; render(); });
  }

  function add() {
    const at = selected >= 0 ? selected + 1 : colors.length;
    const hue = (colors.length * 0.381966) % 1; // golden-ratio hue steps
    openPicker(btn("add"), hsvToHex(hue, 0.8, 0.95), (c) => {
      colors.splice(at, 0, c);
      selected = at;
      render();
    });
  }

  function remove() {
    if (colors.length <= MIN_COLORS) return;
    const i = selected >= 0 ? selected : colors.length - 1;
    colors.splice(i, 1);
    selected = Math.min(i, colors.length - 1);
    render();
  }

  btn("left").addEventListener("click", () => move(-1));
  btn("right").addEventListener("click", () => move(1));
  btn("add").addEventListener("click", add);
  btn("remove").addEventListener("click", remove);
  btn("change").addEventListener("click", changeSelected);
  btn("reverse").addEventListener("click", () => setColors(colors.reverse()));
  sets.addEventListener("change", () => {
    const value = COLOR_SETS[sets.value];
    if (value) setColors(typeof value === "function" ? value(colors.length) : value);
    else syncSets();
  });
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && e.altKey) { move(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight" && e.altKey) { move(1); e.preventDefault(); }
    else if (e.key === "Delete") { remove(); e.preventDefault(); }
  });

  return {
    element,
    getColors: () => [...colors],
    setColors: (c) => setColors(c),
  };
}

// --- Swatch popup -------------------------------------------------------------------

let openPopup = null;

function closePicker() {
  if (openPopup) { openPopup.remove(); openPopup = null; }
}

/** Popup under `anchor` with the preset swatches plus "More colors…" (the
 *  browser's color picker). Calls onPick("#rrggbb") with the choice. */
function openPicker(anchor, current, onPick) {
  closePicker();
  const popup = document.createElement("div");
  popup.className = "color-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "Choose a color");
  const grid = document.createElement("div");
  grid.className = "popup-grid";
  for (const c of SWATCHES) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => { closePicker(); onPick(c); });
    grid.append(b);
  }
  const more = document.createElement("label");
  more.className = "popup-more";
  more.textContent = "More colors… ";
  const input = document.createElement("input");
  input.type = "color";
  input.value = cssToHex(current);
  input.addEventListener("change", () => { closePicker(); onPick(input.value); });
  more.append(input);
  popup.append(grid, more);
  document.body.append(popup);

  const r = anchor.getBoundingClientRect();
  const w = popup.offsetWidth, h = popup.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
  const below = r.bottom + 4 + h <= window.innerHeight;
  popup.style.left = `${left + window.scrollX}px`;
  popup.style.top = `${(below ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + window.scrollY}px`;
  openPopup = popup;
  grid.firstChild.focus();
}

document.addEventListener("pointerdown", (e) => {
  if (openPopup && !openPopup.contains(e.target)) closePicker();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
