// Settings tab: presets, grid size, neighbourhood, thresholds, edges,
// colors, statistics window and cycle handling, with Apply / Revert.
// Port of SettingsPanel from ca_app.py.

import { PRESETS, MAX_WINDOW_BYTES, describeHalfLife } from "../config.js";

/**
 * @param {HTMLFormElement} form
 * @param {object} opts
 *   getConfig()          the settings currently applied
 *   apply(config)        apply new settings
 *   setView(panels, speed)  preset view changes (either may be undefined)
 *   colorEditor          {element, getColors(), setColors(colors)}
 */
export function createSettings(form, { getConfig, apply, setView, colorEditor }) {
  form.innerHTML = `
    <label for="set-preset">Preset</label>
    <select id="set-preset" title="Fill the form with a preset and apply it. Settings a preset doesn't mention keep their current values.">
      <option value="">Choose a preset…</option>
    </select>

    <span class="label">Grid (rows × columns)</span>
    <div class="inline">
      <input type="number" id="set-rows" min="2" max="5000" aria-label="Rows">
      <span>×</span>
      <input type="number" id="set-cols" min="2" max="5000" aria-label="Columns">
    </div>

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

    <span class="label">Colors (each beaten by the next)</span>
    <div id="set-colors"></div>

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

    <span class="label">Cycles</span>
    <label class="check"><input type="checkbox" id="set-stop-cycle"> Pause once a cycle is found and recorded</label>

    <p class="note">Rule, color and window changes apply to the running board. A new grid
      size or number of colors starts again from the chosen starting pattern.</p>
    <p class="error" id="set-error" hidden></p>
    <div class="actions">
      <button type="button" id="set-revert">Revert</button>
      <button type="submit" class="primary">Apply</button>
    </div>`;

  const el = (id) => form.querySelector(`#set-${id}`);
  const preset = el("preset");
  for (const name of Object.keys(PRESETS)) preset.add(new Option(name, name));
  el("colors").append(colorEditor.element);

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

  /** Fill the form with the chosen preset and apply it. */
  function presetChosen() {
    const make = PRESETS[preset.value];
    preset.value = "";
    if (!make) return;
    const v = make();
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
    setView(v.panels, v.speed);
    submit();
  }

  let lastConnectivity = Number(getConfig().connectivity);
  el("connectivity").addEventListener("focus", () => { lastConnectivity = Number(el("connectivity").value); });
  el("connectivity").addEventListener("change", () => {
    connectivityChanged(lastConnectivity);
    lastConnectivity = Number(el("connectivity").value);
  });
  el("surround").addEventListener("input", surroundHint);
  el("half-life").addEventListener("input", halfLifeHint);
  preset.addEventListener("change", presetChosen);
  el("revert").addEventListener("click", load);
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });

  load();
  return { load };
}
