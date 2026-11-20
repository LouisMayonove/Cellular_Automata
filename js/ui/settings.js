// Settings tab: grid size, neighbourhood, thresholds, edges, colors,
// statistics memory and cycle handling, with Apply / Revert. Presets (full,
// or one per section) only fill the form; Apply makes them take effect.
// Port of SettingsPanel from ca_app.py.

import {
  PRESETS, SIZE_PRESETS, RULE_PRESETS, MEMORY_PRESETS, MAX_WINDOW_BYTES, describeHalfLife,
} from "../config.js";

/** A section heading, with its preset menu if it has one. */
const section = (title, group, prompt) => `
    <div class="section">
      <h3>${title}</h3>
      ${group ? `<select class="preset" data-group="${group}" aria-label="${title} preset"
        title="Fill this section from a preset (Apply to use it)">
        <option value="">${prompt}</option>
      </select>` : ""}
    </div>`;

/**
 * @param {HTMLFormElement} form
 * @param {object} opts
 *   getConfig()          the settings currently applied
 *   apply(config)        apply new settings
 *   colorEditor          {element, getColors(), setColors(colors)}
 */
export function createSettings(form, { getConfig, apply, colorEditor }) {
  form.innerHTML = `
    <div class="section top">
      <h3>All settings</h3>
      <select class="preset" data-group="all" aria-label="Preset for all settings"
        title="Fill every setting below from a preset (Apply to use it)">
        <option value="">Full preset…</option>
      </select>
    </div>
    ${section("Board", "size", "Size…")}
    <span class="label">Grid (rows × columns)</span>
    <div class="inline">
      <input type="number" id="set-rows" min="2" max="5000" aria-label="Rows">
      <span>×</span>
      <input type="number" id="set-cols" min="2" max="5000" aria-label="Columns">
    </div>

    ${section("Rules", "rules", "Rules…")}
    <label for="set-connectivity">Neighbourhood</label>
    <select id="set-connectivity">
      <option value="4">4 (von Neumann)</option>
      <option value="8">8 (Moore)</option>
    </select>

    <label for="set-threshold">Beating threshold</label>
    <div class="inline">
      <input type="number" id="set-threshold" min="1" max="8">
      <span class="hint">neighbours of the beating color needed to convert a cell</span>
    </div>

    <label for="set-surround">Surround threshold</label>
    <div class="inline">
      <input type="number" id="set-surround" min="0" max="8">
      <span class="hint" id="set-surround-hint"></span>
    </div>

    <span class="label">Edges</span>
    <label class="check"><input type="checkbox" id="set-wrap"> Edges wrap around (torus)</label>

    ${section("Colors", null)}
    <span class="label">Colors (each beaten by the next)</span>
    <div id="set-colors"></div>

    ${section("Memory", "memory", "Memory…")}
    <label for="set-window">Statistics window (steps)</label>
    <div class="inline">
      <input type="number" id="set-window" min="1" max="100000">
      <span class="hint">past steps used by the Average color and Activity panels</span>
    </div>

    <label for="set-half-life">Fading average memory (half-life, in steps)</label>
    <div class="inline">
      <input type="number" id="set-half-life" min="1" max="10000">
      <span class="hint" id="set-half-life-hint"></span>
    </div>

    ${section("Cycles", null)}
    <span class="label">When a cycle is found</span>
    <label class="check"><input type="checkbox" id="set-stop-cycle"> Pause once a cycle is found and recorded</label>

    <p class="note">Presets only fill the form: press Apply to use them. Rule, color and memory changes apply to the running board. A new grid
      size or number of colors starts again from the chosen starting pattern.</p>
    <p class="error" id="set-error" hidden></p>
    <div class="actions">
      <span class="pending" id="set-pending" hidden>Changes not applied yet</span>
      <button type="button" id="set-revert">Revert</button>
      <button type="submit" class="primary">Apply</button>
    </div>`;

  const el = (id) => form.querySelector(`#set-${id}`);
  el("colors").append(colorEditor.element);

  const GROUPS = { all: PRESETS, size: SIZE_PRESETS, rules: RULE_PRESETS, memory: MEMORY_PRESETS };
  const menus = [...form.querySelectorAll("select.preset")];
  for (const menu of menus) {
    for (const name of Object.keys(GROUPS[menu.dataset.group])) menu.add(new Option(name, name));
  }

  function halfLifeHint() {
    const h = Math.max(1, Math.round(Number(el("half-life").value)) || 1);
    el("half-life-hint").textContent = describeHalfLife(h);
  }

  function surroundHint() {
    const v = Number(el("surround").value);
    el("surround-hint").textContent = v === 0
      ? "off (0): the surround rule is not used"
      : "neighbours of one single other color needed to take that color (0 = off)";
  }

  /** Neighbourhood change: adapt the threshold ranges, keeping the "all
   *  neighbours but one" surround default if it was in use. */
  function connectivityChanged(previous) {
    const n = Number(el("connectivity").value);
    const wasDefault = Number(el("surround").value) === previous - 1;
    el("threshold").max = n;
    el("surround").max = n;
    if (Number(el("threshold").value) > n) el("threshold").value = n;
    if (wasDefault) el("surround").value = n - 1;
    else if (Number(el("surround").value) > n) el("surround").value = n;
    surroundHint();
  }

  /** Fill the form from the settings currently applied. */
  function load() {
    const c = getConfig();
    el("rows").value = c.rows;
    el("cols").value = c.cols;
    el("connectivity").value = c.connectivity;
    el("threshold").max = c.connectivity;
    el("surround").max = c.connectivity;
    el("threshold").value = c.threshold;
    el("surround").value = c.surround;
    el("wrap").checked = c.wrap;
    colorEditor.setColors(c.colors);
    el("window").value = c.window;
    el("half-life").value = c.halfLife;
    halfLifeHint();
    el("stop-cycle").checked = c.stopOnCycle;
    el("error").hidden = true;
    surroundHint();
    updatePending();
  }

  /** The form's values as typed (no clamping), to compare with what is applied. */
  function formValues() {
    const int = (id) => Math.round(Number(el(id).value));
    return {
      rows: int("rows"), cols: int("cols"), colors: colorEditor.getColors(),
      connectivity: Number(el("connectivity").value), threshold: int("threshold"),
      surround: int("surround"), wrap: el("wrap").checked, window: int("window"),
      halfLife: int("half-life"), stopOnCycle: el("stop-cycle").checked,
    };
  }

  /** Do the values in `a` all equal those in `b` (colors compared in order)? */
  const matches = (a, b) => Object.keys(a).every((k) =>
    k === "colors" ? a.colors.join() === b.colors.join() : a[k] === b[k]);

  /** Show whether the form differs from the settings applied, and let each
   *  preset menu show the preset the form currently matches (or its prompt). */
  function updatePending() {
    const v = formValues();
    el("pending").hidden = matches(v, getConfig());
    for (const menu of menus) {
      const group = GROUPS[menu.dataset.group];
      menu.value = Object.keys(group).find((name) => matches(group[name], v)) ?? "";
    }
  }

  function number(input) {
    const v = Math.round(Number(input.value));
    const lo = Number(input.min), hi = Number(input.max);
    const clamped = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
    input.value = clamped;
    return clamped;
  }

  function showError(text) {
    el("error").textContent = text;
    el("error").hidden = false;
  }

  function submit() {
    const config = {
      ...getConfig(),
      rows: number(el("rows")),
      cols: number(el("cols")),
      colors: colorEditor.getColors(),
      connectivity: Number(el("connectivity").value),
      threshold: number(el("threshold")),
      surround: number(el("surround")),
      wrap: el("wrap").checked,
      window: number(el("window")),
      halfLife: number(el("half-life")),
      stopOnCycle: el("stop-cycle").checked,
    };
    const bytes = config.rows * config.cols * config.window;
    if (bytes > MAX_WINDOW_BYTES) {
      showError(`The statistics window would need about ${Math.round(bytes / 1e6).toLocaleString()} MB `
        + `(the limit is ${MAX_WINDOW_BYTES / 1e6} MB). Use a shorter window or a smaller grid.`);
      return;
    }
    el("error").hidden = true;
    apply(config);
    load(); // keep the form in sync with what is applied
  }

  /** Fill the fields a preset lists (the others keep their values). */
  function presetChosen(menu) {
    const v = GROUPS[menu.dataset.group][menu.value];
    if (!v) return;
    if ("rows" in v) { el("rows").value = v.rows; el("cols").value = v.cols; }
    if ("connectivity" in v) {
      const previous = Number(el("connectivity").value);
      el("connectivity").value = v.connectivity;
      connectivityChanged(previous);
    }
    if ("threshold" in v) el("threshold").value = v.threshold;
    if ("surround" in v) el("surround").value = v.surround;
    if ("wrap" in v) el("wrap").checked = v.wrap;
    if ("colors" in v) colorEditor.setColors(v.colors);
    if ("window" in v) el("window").value = v.window;
    if ("halfLife" in v) { el("half-life").value = v.halfLife; halfLifeHint(); }
    if ("stopOnCycle" in v) el("stop-cycle").checked = v.stopOnCycle;
    updatePending();
  }

  let lastConnectivity = Number(getConfig().connectivity);
  el("connectivity").addEventListener("focus", () => { lastConnectivity = Number(el("connectivity").value); });
  el("connectivity").addEventListener("change", () => {
    connectivityChanged(lastConnectivity);
    lastConnectivity = Number(el("connectivity").value);
  });
  el("surround").addEventListener("input", surroundHint);
  el("half-life").addEventListener("input", halfLifeHint);
  for (const menu of menus) menu.addEventListener("change", () => presetChosen(menu));
  // Any edit, including the color editor's buttons, drags and color picker.
  for (const type of ["input", "change", "click", "drop", "keyup"]) {
    form.addEventListener(type, () => setTimeout(updatePending));
  }
  el("revert").addEventListener("click", load);
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });

  load();
  return { load };
}
