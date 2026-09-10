const state = {
  connected: false,
  activeMix: 0, // 0 -> Mix0*, 1 -> Mix1*
  values: {},
  fxState: [],
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Each entry re-reads the device state and pushes it into one control, so the
// UI never shows a position the hardware isn't actually in. Resolved lazily
// because Mix 1 and Mix 2 hold independent values for the same control.
const syncers = [];
const onSync = (fn) => syncers.push(fn);

function syncControls() {
  syncers.forEach((fn) => {
    try {
      fn(state.values, state.fxState);
    } catch (err) {
      console.error("sync failed:", err);
    }
  });
}

async function refreshState() {
  const status = await api("/api/status");
  state.values = status.values || {};
  state.fxState = status.fxState || [];
  syncControls();
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}

function setParam(name, value, stackIndex) {
  state.values[name] = value;
  return api(`/api/params/${name}`, {
    method: "POST",
    body: JSON.stringify({ value, stackIndex }),
  }).catch((err) => console.error(`Failed to set ${name}:`, err));
}

function mixParamName(base, channelIndex) {
  return `Mix${state.activeMix}Input${channelIndex}${base}`;
}

function dbLabel(value) {
  if (value <= 0) return "-inf";
  const table = window.__DBFS_TABLE__;
  const v = table ? table[value] : null;
  return v === null || v === undefined ? `${value}` : v.toFixed(2);
}

function setToggle(btn, on) {
  if (btn) btn.classList.toggle("on", !!on);
}

// -- rotary knob widget --------------------------------------------------
//
// Drag vertically to change value, mirroring dspMixFx's default knob
// behaviour (Setup Window > Editor Settings > Knob Mouse Control).

const SWEEP_DEG = 135; // knob rotates from -135deg (min) to +135deg (max)

function makeKnob(el, { min, max, value, defaultValue, onChange, step = 1 }) {
  let current = value;

  function render() {
    const t = (current - min) / (max - min);
    const deg = -SWEEP_DEG + t * (2 * SWEEP_DEG);
    $(".knob-dot", el).style.transform = `translateX(-50%) rotate(${deg}deg)`;
  }

  function setValue(v, notify) {
    current = Math.min(max, Math.max(min, Math.round(v / step) * step));
    render();
    if (notify) onChange(current);
  }

  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startValue = current;
    const range = max - min;

    function onMove(ev) {
      const deltaY = startY - ev.clientY;
      const deltaValue = (deltaY / 120) * range;
      setValue(startValue + deltaValue, true);
    }
    function onUp() {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      onChange(current);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  });

  el.addEventListener("dblclick", () => {
    if (defaultValue !== undefined) setValue(defaultValue, true);
  });

  render();
  return { setValue: (v) => setValue(v, false) };
}

// every fader's 0 dB point (matches dspMixFx: "double-click the fader" -> 0 dB)
const FADER_ZERO_DB = 103;

function wireFader(faderEl, readoutEl, getParamName) {
  faderEl.addEventListener("input", () => {
    readoutEl.textContent = dbLabel(Number(faderEl.value));
  });
  faderEl.addEventListener("change", () => {
    setParam(getParamName(), Number(faderEl.value));
  });
  faderEl.addEventListener("dblclick", () => {
    faderEl.value = FADER_ZERO_DB;
    readoutEl.textContent = dbLabel(FADER_ZERO_DB);
    setParam(getParamName(), FADER_ZERO_DB);
  });
  onSync((values) => {
    const v = values[getParamName()];
    if (v === undefined) return;
    faderEl.value = v;
    readoutEl.textContent = dbLabel(v);
  });
}

// -- channel strip --------------------------------------------------------

function buildChannelStrip(channelIndex, title) {
  const el = document.createElement("div");
  el.className = "channel-strip";
  el.dataset.channel = channelIndex;

  const hasHpf = channelIndex <= 3;
  const phantomPair = channelIndex <= 1 ? "PhantomPower01" : channelIndex <= 3 ? "PhantomPower23" : null;
  // channels pair up as (1,2) (3,4) (5,6); only the first of each pair owns
  // the link param and shows the button
  const isLinkOwner = channelIndex === 0 || channelIndex === 2 || channelIndex === 4;
  const linkParam = isLinkOwner ? `Input${channelIndex}Link` : null;

  el.innerHTML = `
    <div class="strip-label top row-1">${title}</div>
    <div class="icon-row row-2">
      <button class="led-btn phase" title="Phase">&Oslash;</button>
      ${hasHpf ? '<button class="led-btn hpf" title="High Pass Filter">HPF</button>' : ""}
    </div>
    <div class="fx-row row-3">
      <div class="fx-btn-row">
        <button class="led-btn fx-power" title="FX On/Off">&#9211;</button>
        <button class="led-btn fx-edit" title="Edit" disabled>e</button>
      </div>
      <select class="fx-select">
        <option value="off">Off</option>
        <option value="channel-strip">Ch.Strip</option>
        <option value="amp-0">Clean</option>
        <option value="amp-1">Crunch</option>
        <option value="amp-2">Lead</option>
        <option value="amp-3">Drive</option>
      </select>
    </div>
    <div class="knob-row row-4">
      <div class="knob-wrap">
        <div class="knob revx-send"><div class="knob-dot"></div></div>
        <span class="knob-label">REV</span>
      </div>
      <div class="knob-wrap">
        <div class="knob pan"><div class="knob-dot"></div></div>
        <span class="knob-label">C</span>
      </div>
    </div>
    <div class="mute-solo-row row-5">
      <button class="led-btn mute-btn">M</button>
      <button class="led-btn solo-btn">S</button>
    </div>
    <div class="fader-row row-6">
      <div class="meter"><div class="fill"></div></div>
      <div class="fader-track">
        <input type="range" class="fader volume" min="0" max="127" value="103" />
      </div>
    </div>
    <span class="db-readout row-7">0.00</span>
    <span class="phantom-indicator row-8 ${phantomPair ? "" : "hidden"}"><i class="led-dot"></i>+48V</span>
    ${isLinkOwner ? '<button class="led-btn link-btn row-9" title="Link with next channel">LINK</button>' : ""}
  `;

  wireFader($(".fader.volume", el), $(".db-readout", el), () => mixParamName("Volume", channelIndex));

  const panKnob = makeKnob($(".knob.pan", el), {
    min: -16,
    max: 16,
    value: 0,
    defaultValue: 0,
    onChange: (v) => setParam(mixParamName("Pan", channelIndex), v),
  });
  onSync((values) => {
    const v = values[mixParamName("Pan", channelIndex)];
    if (v !== undefined) panKnob.setValue(v);
  });

  const revKnob = makeKnob($(".knob.revx-send", el), {
    min: 0,
    max: 127,
    value: 0,
    defaultValue: 0,
    onChange: (v) => setParam(`Input${channelIndex}ReverbSend`, v),
  });
  onSync((values) => {
    const v = values[`Input${channelIndex}ReverbSend`];
    if (v !== undefined) revKnob.setValue(v);
  });

  const muteBtn = $(".mute-btn", el);
  muteBtn.addEventListener("click", () => {
    const muted = muteBtn.classList.toggle("on");
    // device convention: 1 = unmuted, 0 = muted
    setParam(mixParamName("Mute", channelIndex), muted ? 0 : 1);
  });
  onSync((values) => {
    const v = values[mixParamName("Mute", channelIndex)];
    if (v !== undefined) setToggle(muteBtn, v === 0);
  });

  const soloBtn = $(".solo-btn", el);
  soloBtn.addEventListener("click", () => {
    const solo = soloBtn.classList.toggle("on");
    setParam(mixParamName("Solo", channelIndex), solo ? 1 : 0);
  });
  onSync((values) => {
    const v = values[mixParamName("Solo", channelIndex)];
    if (v !== undefined) setToggle(soloBtn, v === 1);
  });

  const phaseBtn = $(".phase", el);
  phaseBtn.addEventListener("click", () => {
    const inverted = phaseBtn.classList.toggle("on");
    setParam(`Input${channelIndex}InvertPhase`, inverted ? 1 : 0);
  });
  onSync((values) => {
    const v = values[`Input${channelIndex}InvertPhase`];
    if (v !== undefined) setToggle(phaseBtn, v === 1);
  });

  const hpfBtn = $(".hpf", el);
  if (hpfBtn) {
    hpfBtn.addEventListener("click", () => {
      const on = hpfBtn.classList.toggle("on");
      setParam(`Input${channelIndex}HPFEnabled`, on ? 1 : 0);
    });
    onSync((values) => {
      const v = values[`Input${channelIndex}HPFEnabled`];
      if (v !== undefined) setToggle(hpfBtn, v === 1);
    });
  }

  if (isLinkOwner) {
    const linkBtn = $(".link-btn", el);
    const partnerIndex = channelIndex + 1;

    function applyLinkVisual(on) {
      const partner = $(`.channel-strip[data-channel="${partnerIndex}"]`);
      el.classList.toggle("link-primary", on);
      $(".knob.pan", el).classList.toggle("disabled", on);
      if (!partner) return;
      partner.classList.toggle("link-secondary", on);
      $(".fader.volume", partner).disabled = on;
      $(".knob.pan", partner).classList.toggle("disabled", on);
    }

    linkBtn.addEventListener("click", () => {
      const on = linkBtn.classList.toggle("on");
      setParam(linkParam, on ? 1 : 0);
      if (on) {
        // stereo-pair convention when linking two mono inputs: hard pan the
        // pair left/right (the device mirrors volume automatically once
        // linked, confirmed on hardware - pan is not auto-set by it, dspMixFx
        // does this client-side)
        setParam(mixParamName("Pan", channelIndex), -16);
        setParam(mixParamName("Pan", partnerIndex), 16);
      }
      applyLinkVisual(on);
      syncControls();
    });
    onSync((values) => {
      const v = values[linkParam];
      if (v !== undefined) {
        setToggle(linkBtn, v === 1);
        applyLinkVisual(v === 1);
      }
    });
  }

  const fxSelect = $(".fx-select", el);
  const fxPower = $(".fx-power", el);
  const fxEdit = $(".fx-edit", el);
  let lastNonOffFx = "channel-strip";

  async function applyFx(type, mode = "insert") {
    try {
      await api(`/api/fx/${channelIndex}`, { method: "POST", body: JSON.stringify({ type, mode }) });
      return true;
    } catch (err) {
      alert(`FX (ANALOG ${channelIndex + 1}): ${err.message}`);
      return false;
    }
  }

  fxSelect.addEventListener("change", async () => {
    const previous = fxSelect.dataset.prev || "off";
    const val = fxSelect.value;
    let ok;
    if (val === "off") {
      ok = await applyFx("off");
    } else if (val === "channel-strip") {
      ok = await applyFx("channel-strip");
    } else {
      ok = await applyFx("amp");
      if (ok) setParam("AmpType", Number(val.split("-")[1]));
    }
    if (ok) {
      fxSelect.dataset.prev = val;
      if (val !== "off") lastNonOffFx = val;
    } else {
      fxSelect.value = previous;
    }
    await refreshState();
  });

  fxPower.addEventListener("click", async () => {
    if (fxPower.classList.contains("on")) {
      await applyFx("off");
    } else {
      fxSelect.value = lastNonOffFx;
      fxSelect.dispatchEvent(new Event("change"));
      return;
    }
    await refreshState();
  });

  fxEdit.addEventListener("click", () => openFxEditor(channelIndex));

  onSync((values, fxState) => {
    const fx = fxState[channelIndex];
    if (!fx) return;
    let selVal = "off";
    if (fx.type === "channel-strip") selVal = "channel-strip";
    else if (fx.type === "amp") selVal = `amp-${values.AmpType ?? 0}`;
    fxSelect.value = selVal;
    fxSelect.dataset.prev = selVal;
    if (selVal !== "off") lastNonOffFx = selVal;
    setToggle(fxPower, fx.type !== "off");
    fxEdit.disabled = fx.type === "off";
  });

  if (phantomPair) {
    onSync((values) => setToggle($(".phantom-indicator", el), values[phantomPair] === 1));
  }

  return el;
}

// DAW is the computer's playback return, not one of the 6 analog inputs:
// same Pan/Mute/Solo/Fader/Meter, but no Ch.Strip, REV-X send, phase or HPF
// (matches the dspMixFx "DAW Area" in the UR44 manual, page 12).
function buildDawStrip() {
  const el = document.createElement("div");
  el.className = "channel-strip";
  el.dataset.channel = "daw";

  el.innerHTML = `
    <div class="strip-label top row-1">DAW</div>
    <div class="knob-wrap row-4">
      <div class="knob pan"><div class="knob-dot"></div></div>
      <span class="knob-label">C</span>
    </div>
    <div class="mute-solo-row row-5">
      <button class="led-btn mute-btn">M</button>
      <button class="led-btn solo-btn">S</button>
    </div>
    <div class="fader-row row-6">
      <div class="meter"><div class="fill"></div></div>
      <div class="fader-track">
        <input type="range" class="fader volume" min="0" max="127" value="103" />
      </div>
    </div>
    <span class="db-readout row-7">0.00</span>
  `;

  wireFader($(".fader.volume", el), $(".db-readout", el), () => `Mix${state.activeMix}DAWVolume`);

  const panKnob = makeKnob($(".knob.pan", el), {
    min: -16,
    max: 16,
    value: 0,
    defaultValue: 0,
    onChange: (v) => setParam(`Mix${state.activeMix}DAWPan`, v),
  });
  onSync((values) => {
    const v = values[`Mix${state.activeMix}DAWPan`];
    if (v !== undefined) panKnob.setValue(v);
  });

  const muteBtn = $(".mute-btn", el);
  muteBtn.addEventListener("click", () => {
    const muted = muteBtn.classList.toggle("on");
    setParam(`Mix${state.activeMix}DAWMute`, muted ? 0 : 1);
  });
  onSync((values) => {
    const v = values[`Mix${state.activeMix}DAWMute`];
    if (v !== undefined) setToggle(muteBtn, v === 0);
  });

  const soloBtn = $(".solo-btn", el);
  soloBtn.addEventListener("click", () => {
    const solo = soloBtn.classList.toggle("on");
    setParam(`Mix${state.activeMix}DAWSolo`, solo ? 1 : 0);
  });
  onSync((values) => {
    const v = values[`Mix${state.activeMix}DAWSolo`];
    if (v !== undefined) setToggle(soloBtn, v === 1);
  });

  return el;
}

// -- FX editor modal --------------------------------------------------------
//
// Built fresh from a snapshot of state.values every time it opens (rather
// than wired into the persistent `syncers` list), since it's torn down and
// rebuilt on every open/close - registering permanent syncers here would
// leak a new set on every click and eventually touch stale DOM nodes.

function showModal(title) {
  $("#fx-modal-title").textContent = title;
  $("#fx-modal").hidden = false;
}

function closeModal() {
  $("#fx-modal").hidden = true;
  resetModalTheme();
}

// undoes the amp editor's themed background/text color for the next open
function resetModalTheme() {
  const body = $("#fx-modal-body");
  body.style.background = "";
  body.style.color = "";
}

function modalKnob(label, min, max, value, onChange, defaultValue, opts = {}) {
  const { colorClass, format } = opts;
  const fmt = format || ((n) => n);
  const wrap = document.createElement("div");
  wrap.className = "knob-wrap";
  wrap.innerHTML = `<div class="knob${colorClass ? " " + colorClass : ""}"><div class="knob-dot"></div></div><span class="knob-label">${label}</span><span class="modal-knob-value">${fmt(value)}</span>`;
  const valueEl = $(".modal-knob-value", wrap);
  makeKnob($(".knob", wrap), {
    min,
    max,
    value,
    defaultValue,
    onChange: (v) => {
      valueEl.textContent = fmt(v);
      onChange(v);
    },
  });
  return wrap;
}

function modalToggle(label, isOn, onChange) {
  const btn = document.createElement("button");
  btn.className = "led-btn";
  btn.textContent = label;
  setToggle(btn, isOn);
  btn.addEventListener("click", () => {
    const on = btn.classList.toggle("on");
    onChange(on);
  });
  return btn;
}

// inline multi-position switch (replaces a <select> for a handful of named
// choices, matching the real amp panels' physical toggle/rotary switches)
function segmentedControl(options, current, onChange) {
  const row = document.createElement("div");
  row.className = "segmented";
  const buttons = options.map(({ value, label, title }) => {
    const btn = document.createElement("button");
    btn.className = "led-btn seg-btn";
    btn.textContent = label;
    if (title) btn.title = title;
    setToggle(btn, value === current);
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      onChange(value);
    });
    row.appendChild(btn);
    return btn;
  });
  return row;
}

function openFxEditor(channelIndex) {
  const fx = state.fxState[channelIndex];
  if (!fx || fx.type === "off") return;
  if (fx.type === "channel-strip") {
    openChannelStripEditor(channelIndex, fx.stackIndex);
  } else if (fx.type === "amp") {
    openAmpEditor(channelIndex);
  }
}

// REV-X's Setup Window (page 14 of the UR44 manual) exposes several reverb
// engine params that never made it into the compact TIME/RTN knobs on the
// master strip: diffusion, room size, decay, initial delay, HPF/LPF, and the
// high/low damping ratios.
const revInitialDelayFromRaw = (raw) => lerpAnchors(raw, [[0, 0.1], [2, 3.2], [127, 200.0]]);
const revHpfFromRaw = (raw) => lerpAnchors(raw, [[0, 20], [4, 32], [52, 8000]]);
const revLpfFromRaw = (raw) => lerpAnchors(raw, [[34, 1000], [50, 6300], [60, 20000]]);
const revHighRatioFromRaw = (raw) => lerpAnchors(raw, [[1, 0.1], [8, 0.8], [10, 1.0]]);
const revLowRatioFromRaw = (raw) => lerpAnchors(raw, [[1, 0.1], [12, 1.2], [14, 1.4]]);
const revLowFreqFromRaw = (raw) => lerpAnchors(raw, [[1, 22], [32, 800], [59, 18000]]);

function openReverbEditor() {
  const v = state.values;
  resetModalTheme();
  const body = $("#fx-modal-body");
  body.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "modal-knob-grid";
  grid.appendChild(modalKnob("DIFFUSION", 0, 10, v.ReverbDiffusion ?? 10, (val) => setParam("ReverbDiffusion", val), 10));
  grid.appendChild(modalKnob("ROOM SIZE", 0, 31, v.ReverbRoomSize ?? 29, (val) => setParam("ReverbRoomSize", val), 29));
  grid.appendChild(modalKnob("DECAY", 0, 63, v.ReverbDecay ?? 27, (val) => setParam("ReverbDecay", val), 27));
  grid.appendChild(
    modalKnob("INITIAL DELAY", 0, 127, v.ReverbInitialDelay ?? 2, (val) => setParam("ReverbInitialDelay", val), 2, { format: (n) => revInitialDelayFromRaw(n).toFixed(1) + "ms" })
  );
  grid.appendChild(modalKnob("HPF", 0, 52, v.ReverbHPF ?? 4, (val) => setParam("ReverbHPF", val), 4, { format: (n) => fmtHz(revHpfFromRaw(n)) }));
  grid.appendChild(modalKnob("LPF", 34, 60, v.ReverbLPF ?? 50, (val) => setParam("ReverbLPF", val), 50, { format: (n) => fmtHz(revLpfFromRaw(n)) }));
  grid.appendChild(
    modalKnob("HIGH RATIO", 1, 10, v.ReverbHighRatio ?? 8, (val) => setParam("ReverbHighRatio", val), 8, { format: (n) => revHighRatioFromRaw(n).toFixed(2) })
  );
  grid.appendChild(
    modalKnob("LOW RATIO", 1, 14, v.ReverbLowRatio ?? 12, (val) => setParam("ReverbLowRatio", val), 12, { format: (n) => revLowRatioFromRaw(n).toFixed(2) })
  );
  grid.appendChild(modalKnob("LOW FREQ", 1, 59, v.ReverbLowFreq ?? 32, (val) => setParam("ReverbLowFreq", val), 32, { format: (n) => fmtHz(revLowFreqFromRaw(n)) }));
  body.appendChild(grid);

  const mixRow = document.createElement("div");
  mixRow.className = "modal-select-row";
  const mixLabel = document.createElement("span");
  mixLabel.className = "cs-inline-label";
  mixLabel.textContent = "REVERB INPUT";
  mixRow.appendChild(mixLabel);
  mixRow.appendChild(
    segmentedControl(
      [{ value: 0, label: "Mix 1" }, { value: 1, label: "Mix 2" }],
      v.ReverbInputMix ?? 0,
      (val) => setParam("ReverbInputMix", val)
    )
  );
  body.appendChild(mixRow);

  showModal("REV-X — Advanced");
}

// -- Channel Strip: unit conversion + live graphs ---------------------------
//
// The device sends/accepts raw integer codes for these params. The params
// table's comments give 2-3 anchor points per param (e.g. "0:0.50; 12:1.00;
// 60:16" for a Q control) - real-world units are linearly interpolated
// between those anchors for display and for the graphs below. This is an
// approximation (the device's actual curve may not be perfectly linear
// between anchors) but tracks the documented reference points exactly.

function lerpAnchors(raw, anchors) {
  for (let i = 0; i < anchors.length - 1; i++) {
    const [r0, d0] = anchors[i];
    const [r1, d1] = anchors[i + 1];
    if (raw <= r1) {
      const t = (raw - r0) / (r1 - r0);
      return d0 + t * (d1 - d0);
    }
  }
  return anchors[anchors.length - 1][1];
}

const gainFromRaw = (raw) => ((raw - 180) / 180) * 18; // 0-360 -> -18..+18 dB
const qFromRaw = (raw) => lerpAnchors(raw, [[0, 0.5], [12, 1.0], [60, 16]]);
const lowFreqFromRaw = (raw) => lerpAnchors(raw, [[4, 20], [72, 1000]]);
const midFreqFromRaw = (raw) => lerpAnchors(raw, [[4, 20], [71, 1000], [124, 20000]]);
const highFreqFromRaw = (raw) => lerpAnchors(raw, [[60, 500], [112, 10000], [124, 20000]]);
const ratioFromRaw = (raw) => lerpAnchors(raw, [[0, 1], [30, 2.5], [60, 4], [90, 14], [120, 40]]); // 120 = "inf", capped for the graph
const attackFromRaw = (raw) => lerpAnchors(raw, [[57, 0.092], [184, 4.122], [283, 80.0]]);
const releaseFromRaw = (raw) => lerpAnchors(raw, [[24, 9.3], [159, 92.0], [300, 999.0]]);
const driveFromRaw = (raw) => raw / 20; // 0-200 -> 0.00-10.00

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, val);
  return el;
}

// Compressor transfer curve (in dB -> out dB). There's no real Threshold
// parameter on this device, so a fixed -20dB threshold is assumed purely to
// give Ratio and Knee something to visibly bend around - the curve's shape
// is illustrative, not a literal readout of the device's internal curve.
function buildCompGraph(ratio, kneeIdx) {
  const w = 160;
  const h = 92;
  const threshold = -20;
  const kneeWidth = [18, 9, 1][kneeIdx] ?? 9; // soft/medium/hard

  // standard soft-knee compressor transfer function (continuous in both
  // value and slope at the knee boundaries) - Giannoulis et al., "Digital
  // Dynamic Range Compressor Design"
  function outDb(inDb) {
    const delta = inDb - threshold;
    if (2 * delta < -kneeWidth) return inDb;
    if (2 * delta > kneeWidth) return threshold + delta / ratio;
    const kneeTerm = delta + kneeWidth / 2;
    return inDb + (1 / ratio - 1) * (kneeTerm * kneeTerm) / (2 * kneeWidth);
  }

  const toX = (db) => ((db + 60) / 60) * w;
  const toY = (db) => h - ((db + 60) / 60) * h;

  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "cs-graph-svg" });
  svg.appendChild(svgEl("line", { x1: 0, y1: h, x2: w, y2: 0, class: "cs-graph-ref" }));
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const inDb = -60 + i;
    const x = toX(inDb);
    const y = toY(outDb(inDb));
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
  }
  svg.appendChild(svgEl("path", { d: d.trim(), class: "cs-comp-curve" }));
  return svg;
}

// Approximate 3-band EQ magnitude response (bell-shaped in log-frequency
// space) - not literal biquad math, but tracks Freq/Gain/Q direction and
// magnitude faithfully enough to see what turning a knob is doing.
function bellResponseDb(f, centerFreq, gainDb, q) {
  const octaves = Math.log2(f / centerFreq);
  const width = 1 / Math.max(0.3, q);
  return gainDb * Math.exp(-(octaves * octaves) / (2 * width * width));
}

function buildEqGraph(bands) {
  const w = 260;
  const h = 92;
  const range = 18;
  const minF = Math.log10(20);
  const maxF = Math.log10(20000);
  const toX = (f) => ((Math.log10(f) - minF) / (maxF - minF)) * w;
  const toY = (db) => h / 2 - (db / range) * (h / 2);

  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "cs-graph-svg" });
  svg.appendChild(svgEl("line", { x1: 0, y1: h / 2, x2: w, y2: h / 2, class: "cs-graph-ref" }));

  let d = "";
  const N = 80;
  for (let i = 0; i <= N; i++) {
    const f = 20 * Math.pow(1000, i / N);
    let total = 0;
    bands.forEach((b) => {
      total += bellResponseDb(f, b.freq, b.gain, b.q);
    });
    const x = toX(f);
    const y = toY(Math.max(-range, Math.min(range, total)));
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
  }
  svg.appendChild(svgEl("path", { d: d.trim(), class: "cs-eq-curve" }));

  bands.forEach((b) => {
    const x = toX(b.freq);
    const y = toY(Math.max(-range, Math.min(range, b.gain)));
    svg.appendChild(svgEl("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 4, class: `cs-eq-dot cs-eq-dot-${b.key}` }));
  });
  return svg;
}

const fmtHz = (hz) => (hz >= 1000 ? (hz / 1000).toFixed(2) + "kHz" : Math.round(hz) + "Hz");
const fmtDb = (db) => (db >= 0 ? "+" : "") + db.toFixed(1) + "dB";
const fmtMs = (ms) => ms.toFixed(ms < 10 ? 3 : 1) + "ms";
const fmtRatio = (r) => (r >= 40 ? "∞:1" : r.toFixed(1) + ":1");
const fmtQ = (q) => q.toFixed(2);
const fmtDrive = (d) => d.toFixed(2);

function openChannelStripEditor(channelIndex, stackIndex) {
  const v = state.values;
  const setStack = (name, val) => setParam(name, val, stackIndex);
  resetModalTheme();
  const body = $("#fx-modal-body");
  body.innerHTML = "";

  const columns = document.createElement("div");
  columns.className = "cs-columns";
  body.appendChild(columns);

  // -- Compressor (left column) --------------------------------------------
  const compCol = document.createElement("div");
  compCol.className = "cs-col";
  columns.appendChild(compCol);

  const compHeader = document.createElement("div");
  compHeader.className = "cs-section-header cs-comp-header";
  // ChannelStripCompEnabled is inverted on the device: 0 = on, 1 = off
  compHeader.appendChild(modalToggle("⏻", v.ChannelStripCompEnabled === 0, (on) => setStack("ChannelStripCompEnabled", on ? 0 : 1)));
  const compLabel = document.createElement("span");
  compLabel.className = "cs-section-title";
  compLabel.textContent = "COMP";
  compHeader.appendChild(compLabel);
  compCol.appendChild(compHeader);

  const compGraphBox = document.createElement("div");
  compGraphBox.className = "cs-graph";
  compCol.appendChild(compGraphBox);
  function redrawComp() {
    compGraphBox.innerHTML = "";
    compGraphBox.appendChild(buildCompGraph(ratioFromRaw(v.ChannelStripCompRatio ?? 30), v.ChannelStripCompKnee ?? 1));
  }
  redrawComp();

  const compKnobs = document.createElement("div");
  compKnobs.className = "modal-knob-grid";
  compKnobs.appendChild(modalKnob("ATTACK", 57, 283, v.ChannelStripCompAttack ?? 184, (val) => setStack("ChannelStripCompAttack", val), 184, { colorClass: "knob-green", format: (n) => fmtMs(attackFromRaw(n)) }));
  compKnobs.appendChild(modalKnob("RELEASE", 24, 300, v.ChannelStripCompRelease ?? 159, (val) => setStack("ChannelStripCompRelease", val), 159, { colorClass: "knob-green", format: (n) => fmtMs(releaseFromRaw(n)) }));
  compKnobs.appendChild(
    modalKnob("RATIO", 0, 120, v.ChannelStripCompRatio ?? 30, (val) => { setStack("ChannelStripCompRatio", val); redrawComp(); }, 30, { colorClass: "knob-green", format: (n) => fmtRatio(ratioFromRaw(n)) })
  );
  compCol.appendChild(compKnobs);

  const kneeRow = document.createElement("div");
  kneeRow.className = "modal-select-row";
  const kneeLabel = document.createElement("span");
  kneeLabel.className = "cs-inline-label";
  kneeLabel.textContent = "KNEE";
  kneeRow.appendChild(kneeLabel);
  kneeRow.appendChild(
    segmentedControl(
      [{ value: 0, label: "Soft" }, { value: 1, label: "Medium" }, { value: 2, label: "Hard" }],
      v.ChannelStripCompKnee ?? 1,
      (val) => { setStack("ChannelStripCompKnee", val); redrawComp(); }
    )
  );
  compCol.appendChild(kneeRow);

  compCol.appendChild(
    modalKnob("DRIVE", 0, 200, v.ChannelStripCompDrive ?? 100, (val) => setStack("ChannelStripCompDrive", val), 100, { colorClass: "knob-amber", format: fmtDrive })
  ).classList.add("cs-drive-knob");

  const scPill = document.createElement("div");
  scPill.className = "cs-band-pill cs-pill-green";
  const scLabel = document.createElement("span");
  scLabel.textContent = "SIDE CHAIN";
  scPill.appendChild(scLabel);
  // ChannelStripCompSideChEnabled is normal polarity: 0 = off, 1 = on
  scPill.appendChild(modalToggle("⏻", v.ChannelStripCompSideChEnabled === 1, (on) => setStack("ChannelStripCompSideChEnabled", on ? 1 : 0)));
  compCol.appendChild(scPill);

  const scKnobs = document.createElement("div");
  scKnobs.className = "modal-knob-grid";
  scKnobs.appendChild(modalKnob("Q", 0, 60, v.ChannelStripCompSideChQ ?? 12, (val) => setStack("ChannelStripCompSideChQ", val), 12, { colorClass: "knob-green", format: (n) => fmtQ(qFromRaw(n)) }));
  scKnobs.appendChild(modalKnob("FREQ", 4, 124, v.ChannelStripCompSideChFreq ?? 30, (val) => setStack("ChannelStripCompSideChFreq", val), 30, { colorClass: "knob-green", format: (n) => fmtHz(midFreqFromRaw(n)) }));
  scKnobs.appendChild(modalKnob("GAIN", 0, 360, v.ChannelStripCompSideChGain ?? 133, (val) => setStack("ChannelStripCompSideChGain", val), 133, { colorClass: "knob-green", format: (n) => fmtDb(gainFromRaw(n)) }));
  compCol.appendChild(scKnobs);

  // -- EQ (right column) ----------------------------------------------------
  const eqCol = document.createElement("div");
  eqCol.className = "cs-col";
  columns.appendChild(eqCol);

  const eqHeader = document.createElement("div");
  eqHeader.className = "cs-section-header cs-eq-header";
  // ChannelStripEQEnabled is inverted too: 0 = on, 1 = off
  eqHeader.appendChild(modalToggle("⏻", v.ChannelStripEQEnabled === 0, (on) => setStack("ChannelStripEQEnabled", on ? 0 : 1)));
  const eqLabel = document.createElement("span");
  eqLabel.className = "cs-section-title";
  eqLabel.textContent = "EQ";
  eqHeader.appendChild(eqLabel);
  eqCol.appendChild(eqHeader);

  const eqGraphBox = document.createElement("div");
  eqGraphBox.className = "cs-graph";
  eqCol.appendChild(eqGraphBox);
  function redrawEq() {
    eqGraphBox.innerHTML = "";
    eqGraphBox.appendChild(
      buildEqGraph([
        { key: "low", freq: lowFreqFromRaw(v.ChannelStripEQLowFreq ?? 32), gain: gainFromRaw(v.ChannelStripEQLowGain ?? 180), q: 0.9 },
        { key: "mid", freq: midFreqFromRaw(v.ChannelStripEQMidFreq ?? 71), gain: gainFromRaw(v.ChannelStripEQMidGain ?? 180), q: qFromRaw(v.ChannelStripEQMidQ ?? 12) },
        { key: "high", freq: highFreqFromRaw(v.ChannelStripEQHighFreq ?? 112), gain: gainFromRaw(v.ChannelStripEQHighGain ?? 180), q: 0.9 },
      ])
    );
  }
  redrawEq();

  const bandPills = document.createElement("div");
  bandPills.className = "cs-band-row";
  bandPills.innerHTML = `
    <span class="cs-band-pill cs-pill-orange">LOW</span>
    <span class="cs-band-pill cs-pill-purple">MID</span>
    <span class="cs-band-pill cs-pill-blue">HIGH</span>
  `;
  eqCol.appendChild(bandPills);

  const eqKnobs = document.createElement("div");
  eqKnobs.className = "modal-knob-grid";
  eqKnobs.appendChild(
    modalKnob("LOW F", 4, 72, v.ChannelStripEQLowFreq ?? 32, (val) => { setStack("ChannelStripEQLowFreq", val); redrawEq(); }, 32, { colorClass: "knob-orange", format: (n) => fmtHz(lowFreqFromRaw(n)) })
  );
  eqKnobs.appendChild(
    modalKnob("LOW G", 0, 360, v.ChannelStripEQLowGain ?? 180, (val) => { setStack("ChannelStripEQLowGain", val); redrawEq(); }, 180, { colorClass: "knob-orange", format: (n) => fmtDb(gainFromRaw(n)) })
  );
  eqKnobs.appendChild(
    modalKnob("MID F", 4, 124, v.ChannelStripEQMidFreq ?? 71, (val) => { setStack("ChannelStripEQMidFreq", val); redrawEq(); }, 71, { colorClass: "knob-purple", format: (n) => fmtHz(midFreqFromRaw(n)) })
  );
  eqKnobs.appendChild(
    modalKnob("MID G", 0, 360, v.ChannelStripEQMidGain ?? 180, (val) => { setStack("ChannelStripEQMidGain", val); redrawEq(); }, 180, { colorClass: "knob-purple", format: (n) => fmtDb(gainFromRaw(n)) })
  );
  eqKnobs.appendChild(
    modalKnob("MID Q", 0, 60, v.ChannelStripEQMidQ ?? 12, (val) => { setStack("ChannelStripEQMidQ", val); redrawEq(); }, 12, { colorClass: "knob-purple", format: (n) => fmtQ(qFromRaw(n)) })
  );
  eqKnobs.appendChild(
    modalKnob("HIGH F", 60, 124, v.ChannelStripEQHighFreq ?? 112, (val) => { setStack("ChannelStripEQHighFreq", val); redrawEq(); }, 112, { colorClass: "knob-blue", format: (n) => fmtHz(highFreqFromRaw(n)) })
  );
  eqKnobs.appendChild(
    modalKnob("HIGH G", 0, 360, v.ChannelStripEQHighGain ?? 180, (val) => { setStack("ChannelStripEQHighGain", val); redrawEq(); }, 180, { colorClass: "knob-blue", format: (n) => fmtDb(gainFromRaw(n)) })
  );
  eqCol.appendChild(eqKnobs);

  // -- Output row -------------------------------------------------------------
  const outRow = document.createElement("div");
  outRow.className = "modal-knob-grid cs-output-row";
  outRow.appendChild(modalKnob("MORPH", 0, 200, v.ChannelStripMorphing ?? 100, (val) => setStack("ChannelStripMorphing", val), 100));
  outRow.appendChild(modalKnob("TOTAL GAIN", 0, 360, v.ChannelStripTotalGain ?? 180, (val) => setStack("ChannelStripTotalGain", val), 180, { format: (n) => fmtDb(gainFromRaw(n)) }));
  body.appendChild(outRow);

  showModal(`Sweet Spot Morphing Channel Strip — ANALOG ${channelIndex + 1}`);
}

const AMP_LABELS = ["Clean", "Crunch", "Lead", "Drive"];

// Colors lifted from Yamaha's own Guitar Amp Classics panel graphics
// (asia-oceania.yamaha.com / pt.yamaha.com product pages) so each amp reads
// as the same "instrument" the real dspMixFx shows.
const AMP_THEMES = [
  { bg: "#5b8db8", header: "#2f6b7a", ink: "#0d2530" }, // Clean
  { bg: "#d4af37", header: "#9c8a1e", ink: "#241d04" }, // Crunch
  { bg: "#d98a2b", header: "#5a3315", ink: "#241503" }, // Lead
  { bg: "#5c2020", header: "#33100f", ink: "#f2ddd0" }, // Drive
];

// SP TYPE, MIC POSITION and the noise GATE knobs shown on the real amp
// panels have no known SysEx parameter in the steinmixer-derived table this
// app is built on, so they're left out rather than wired to nothing.

function openAmpEditor(channelIndex) {
  const v = state.values;
  const ampType = v.AmpType ?? 0;
  const theme = AMP_THEMES[ampType];
  const body = $("#fx-modal-body");
  body.innerHTML = "";
  body.style.background = theme.bg;
  body.style.color = theme.ink;

  const header = document.createElement("div");
  header.className = "amp-panel-header";
  header.style.background = theme.header;
  const title = document.createElement("span");
  title.className = "amp-panel-title";
  title.textContent = `Guitar Amp Classics — ${AMP_LABELS[ampType].toUpperCase()}`;
  header.appendChild(title);

  header.appendChild(
    segmentedControl(
      AMP_LABELS.map((label, i) => ({ value: i, label })),
      ampType,
      (i) => {
        setParam("AmpType", i);
        openAmpEditor(channelIndex);
      }
    )
  );
  body.appendChild(header);

  const typeRow = document.createElement("div");
  typeRow.className = "modal-select-row amp-type-row";
  body.appendChild(typeRow);

  const knobs = document.createElement("div");
  knobs.className = "modal-knob-grid amp-row";
  body.appendChild(knobs);

  function addKnob(row, label, paramName, min, max, def) {
    row.appendChild(modalKnob(label, min, max, v[paramName] ?? def, (val) => setParam(paramName, val), def));
  }

  function subTypeButtons(paramName, current, labels, titles) {
    typeRow.appendChild(
      segmentedControl(
        labels.map((label, i) => ({ value: i, label, title: titles?.[i] })),
        current ?? 1,
        (i) => setParam(paramName, i)
      )
    );
  }

  if (ampType === 0) {
    addKnob(knobs, "VOLUME", "AmpCleanVolume", 0, 64, 32);
    addKnob(knobs, "DISTORTION", "AmpCleanDistortion", 0, 64, 32);
    addKnob(knobs, "BLEND", "AmpCleanBlend", 0, 64, 32);
    typeRow.appendChild(
      segmentedControl(
        [
          { value: 0, label: "Cho" },
          { value: 1, label: "Off" },
          { value: 2, label: "Vib" },
        ],
        v.AmpCleanModulation ?? 1,
        (val) => setParam("AmpCleanModulation", val)
      )
    );

    addKnob(knobs, "TREBLE", "AmpCleanTreble", 0, 64, 32);
    addKnob(knobs, "MIDDLE", "AmpCleanMiddle", 0, 64, 32);
    addKnob(knobs, "BASS", "AmpCleanBass", 0, 64, 32);
    addKnob(knobs, "PRESENCE", "AmpCleanPresence", 0, 64, 32);
    addKnob(knobs, "SPEED", "AmpCleanVibratoSpeed", 0, 64, 32);
    addKnob(knobs, "DEPTH", "AmpCleanVibratoDepth", 0, 64, 32);
    addKnob(knobs, "OUTPUT", "AmpCleanOutput", 0, 127, 32);
  } else if (ampType === 1) {
    subTypeButtons("AmpCrunchMode", v.AmpCrunchMode, ["Normal", "Bright"]);
    addKnob(knobs, "GAIN", "AmpCrunchGain", 0, 64, 32);

    addKnob(knobs, "TREBLE", "AmpCrunchTreble", 0, 64, 32);
    addKnob(knobs, "MIDDLE", "AmpCrunchMiddle", 0, 64, 32);
    addKnob(knobs, "BASS", "AmpCrunchBass", 0, 64, 32);
    addKnob(knobs, "PRESENCE", "AmpCrunchPresence", 0, 64, 32);
    addKnob(knobs, "OUTPUT", "AmpCrunchOutput", 0, 127, 32);
  } else if (ampType === 2) {
    // device docs only name values 0/1 ("High"/"Low"); range technically
    // goes to 5 but 2-5 are undocumented, so only the real two are offered
    subTypeButtons("AmpLeadType", v.AmpLeadType, ["High", "Low"]);
    addKnob(knobs, "GAIN", "AmpLeadGain", 0, 64, 32);
    addKnob(knobs, "MASTER", "AmpLeadMaster", 0, 64, 32);

    addKnob(knobs, "TREBLE", "AmpLeadTreble", 0, 64, 32);
    addKnob(knobs, "MIDDLE", "AmpLeadMiddle", 0, 64, 32);
    addKnob(knobs, "BASS", "AmpLeadBass", 0, 64, 32);
    addKnob(knobs, "PRESENCE", "AmpLeadPresence", 0, 64, 32);
    addKnob(knobs, "OUTPUT", "AmpLeadOutput", 0, 127, 32);
  } else {
    // Yamaha's manual doesn't give these individual names, only numbers -
    // 1-2 mild, 3-4 fatter, 5-6 aggressive, evens have more presence/range
    subTypeButtons(
      "AmpDriveType",
      v.AmpDriveType,
      ["1", "2", "3", "4", "5", "6"],
      [
        "Mild distortion",
        "Mild distortion, more presence",
        "Fat, soft tone",
        "Fat, soft tone, more presence",
        "Aggressive, tight attack",
        "Aggressive, tight attack, more presence",
      ]
    );
    addKnob(knobs, "GAIN", "AmpDriveGain", 0, 64, 32);
    addKnob(knobs, "MASTER", "AmpDriveMaster", 0, 64, 32);

    addKnob(knobs, "TREBLE", "AmpDriveTreble", 0, 64, 32);
    addKnob(knobs, "MIDDLE", "AmpDriveMiddle", 0, 64, 32);
    addKnob(knobs, "BASS", "AmpDriveBass", 0, 64, 32);
    addKnob(knobs, "PRESENCE", "AmpDrivePresence", 0, 64, 32);
    addKnob(knobs, "OUTPUT", "AmpDriveOutput", 0, 127, 32);
  }

  showModal(`Guitar Amp Classics – ANALOG ${channelIndex + 1}`);
}

function renderChannelStrips(titles) {
  const container = $("#channel-strips");
  container.innerHTML = "";
  titles.forEach((title, i) => container.appendChild(buildChannelStrip(i, title)));
  container.appendChild(buildDawStrip());
}

// meter momentary/max values are 14-bit (two 7-bit MIDI bytes combined),
// i.e. 0-16383 full scale - not the 0-127 range faders use.
const METER_FULL_SCALE = 16383;

function setMeterFill(strip, momentary) {
  if (!strip) return;
  const pct = Math.min(100, (momentary / METER_FULL_SCALE) * 100);
  $(".meter .fill", strip).style.height = `${pct}%`;
}

function setMeterFillEl(meterEl, momentary) {
  if (!meterEl) return;
  const pct = Math.min(100, (momentary / METER_FULL_SCALE) * 100);
  $(".fill", meterEl).style.height = `${pct}%`;
}

function updateMeters(values) {
  const names = ["analog1", "analog2", "analog3", "analog4", "analog5", "analog6"];
  names.forEach((name, idx) => {
    if (values[name]) setMeterFill($(`.channel-strip[data-channel="${idx}"]`), values[name].momentary);
  });

  if (values.dawL || values.dawR) {
    const daw = Math.max(values.dawL?.momentary ?? 0, values.dawR?.momentary ?? 0);
    setMeterFill($('.channel-strip[data-channel="daw"]'), daw);
  }

  if (values.masterL) setMeterFillEl($("#master-meter-l"), values.masterL.momentary);
  if (values.masterR) setMeterFillEl($("#master-meter-r"), values.masterR.momentary);
}

async function refreshPorts() {
  const ports = await api("/api/ports");
  const select = $("#port-select");
  // The UR44 exposes two identically-named MIDI ports (passthrough + DSP
  // control) - only one answers the mixer protocol. Default to auto-detect
  // instead of pre-selecting whichever sorts first alphabetically, since
  // that guess is wrong as often as it's right.
  const autoOption = `<option value="">Auto-detectar</option>`;
  select.innerHTML = autoOption + ports.map((p) => `<option value="${p}">${p}</option>`).join("");
}

function setConnectionUI(connected, portName) {
  state.connected = connected;
  const statusEl = $("#connection-status");
  statusEl.textContent = connected ? `conectado` : "desconectado";
  statusEl.title = portName || "";
  statusEl.className = `status ${connected ? "connected" : "disconnected"}`;
  $("#connect-btn").textContent = connected ? "Desconectar" : "Conectar";
}

async function connect(silent = false) {
  const port = $("#port-select").value;
  try {
    const res = await api("/api/connect", { method: "POST", body: JSON.stringify({ port }) });
    setConnectionUI(true, res.port);
    // the device answers the init handshake with a full state dump; give it a
    // moment to land before mirroring it into the controls
    setTimeout(() => refreshState().catch((err) => console.error(err)), 1200);
  } catch (err) {
    if (!silent) alert(`Falha ao conectar: ${err.message}`);
  }
}

async function disconnect() {
  await api("/api/disconnect", { method: "POST" });
  setConnectionUI(false);
}

function setActiveMix(mix) {
  state.activeMix = mix;
  $$(".mix-btn").forEach((b) => b.classList.toggle("active", Number(b.dataset.mix) === mix));
  api(`/api/mix/${mix}`, { method: "POST" }).catch((err) => console.error(err));
  // Mix 1 and Mix 2 hold independent values - repaint every control
  syncControls();
}

function connectEventStream() {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "meter-update") {
      updateMeters(event.values);
    } else if (event.type === "change-parameter") {
      state.values[event.name] = event.value;
      syncControls();
    } else if (event.type === "init") {
      refreshState().catch((err) => console.error(err));
    }
  };
  es.onerror = () => {
    // EventSource auto-reconnects; nothing to do here
  };
}

async function init() {
  const status = await api("/api/status");
  renderChannelStrips(status.inputChannels);

  await refreshPorts();

  $("#connect-btn").addEventListener("click", () => (state.connected ? disconnect() : connect()));
  $$(".mix-btn").forEach((b) => b.addEventListener("click", () => setActiveMix(Number(b.dataset.mix))));

  $("#fx-modal-close").addEventListener("click", closeModal);
  $("#fx-modal").addEventListener("click", (e) => {
    if (e.target.id === "fx-modal") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  $$(".led-btn.phantom[data-param]").forEach((b) => {
    b.addEventListener("click", () => {
      const on = b.classList.toggle("on");
      setParam(b.dataset.param, on ? 1 : 0);
    });
    onSync((values) => {
      const v = values[b.dataset.param];
      if (v !== undefined) setToggle(b, v === 1);
    });
  });

  const hpfSelect = $("#hpf-setting");
  hpfSelect.addEventListener("change", (e) => setParam("InputHPFSetting", Number(e.target.value)));
  onSync((values) => {
    if (values.InputHPFSetting !== undefined) hpfSelect.value = values.InputHPFSetting;
  });

  const in56 = $("#input56-level");
  in56.addEventListener("change", (e) => setParam("Input45Level", Number(e.target.value)));
  onSync((values) => {
    if (values.Input45Level !== undefined) in56.value = values.Input45Level;
  });

  const loopbackBtn = $("#loopback-btn");
  loopbackBtn.addEventListener("click", () => {
    const on = loopbackBtn.classList.toggle("on");
    loopbackBtn.textContent = on ? "ON" : "OFF";
    setParam("Loopback", on ? 1 : 0);
  });
  onSync((values) => {
    if (values.Loopback === undefined) return;
    const on = values.Loopback === 1;
    setToggle(loopbackBtn, on);
    loopbackBtn.textContent = on ? "ON" : "OFF";
  });

  const phones2Btn = $("#phones2-btn");
  phones2Btn.addEventListener("click", () => {
    const mix2 = !phones2Btn.classList.contains("on");
    setToggle(phones2Btn, mix2);
    phones2Btn.textContent = mix2 ? "MIX 2" : "MIX 1";
    setParam("Phones2Output", mix2 ? 1 : 0);
  });
  onSync((values) => {
    if (values.Phones2Output === undefined) return;
    const mix2 = values.Phones2Output === 1;
    setToggle(phones2Btn, mix2);
    phones2Btn.textContent = mix2 ? "MIX 2" : "MIX 1";
  });

  // -- master strip --
  wireFader($("#master-volume"), $("#master-volume-db"), () => `Mix${state.activeMix}MainVolume`);

  const masterMute = $("#master-mute");
  masterMute.addEventListener("click", () => {
    const muted = masterMute.classList.toggle("on");
    setParam(`Mix${state.activeMix}MainMute`, muted ? 0 : 1);
  });
  onSync((values) => {
    const v = values[`Mix${state.activeMix}MainMute`];
    if (v !== undefined) setToggle(masterMute, v === 0);
  });

  const masterPan = makeKnob($("#master-pan"), {
    min: -16,
    max: 16,
    value: 0,
    defaultValue: 0,
    onChange: (v) => setParam(`Mix${state.activeMix}MainPan`, v),
  });
  onSync((values) => {
    const v = values[`Mix${state.activeMix}MainPan`];
    if (v !== undefined) masterPan.setValue(v);
  });

  // -- REV-X strip --
  //
  // The device has no dedicated "REV-X send on/off" parameter in the table
  // we have (steinmixer never documented one) - the real dspMixFx SEND button
  // sits right next to the Return Level fader in the manual, so we treat it
  // as a mute for that fader: off -> remember the current return level and
  // zero it, on -> restore what was remembered (or 0dB if nothing was).
  let revxReturnBeforeMute = null;
  const revxSendBtn = $("#revx-send");
  revxSendBtn.addEventListener("click", () => {
    const key = `Mix${state.activeMix}ReverbVolume`;
    const turningOn = !revxSendBtn.classList.contains("on");
    let newValue;
    if (turningOn) {
      newValue = revxReturnBeforeMute ?? 103;
    } else {
      revxReturnBeforeMute = state.values[key] || null;
      newValue = 0;
    }
    setParam(key, newValue);
    // setParam doesn't trigger a resync by itself - update this button and
    // the RTN knob it mutes/restores right away instead of waiting for one
    setToggle(revxSendBtn, turningOn);
    revxReturn.setValue(newValue);
  });
  onSync((values) => {
    const v = values[`Mix${state.activeMix}ReverbVolume`];
    if (v !== undefined) setToggle(revxSendBtn, v > 0);
  });

  $("#revx-edit").addEventListener("click", openReverbEditor);

  const revxType = $("#revx-type");
  revxType.addEventListener("change", (e) => setParam("ReverbType", Number(e.target.value)));
  onSync((values) => {
    if (values.ReverbType !== undefined) revxType.value = values.ReverbType;
  });

  const revxTime = makeKnob($("#revx-time"), {
    min: 0,
    max: 69,
    value: 23,
    defaultValue: 23,
    onChange: (v) => setParam("ReverbTime", v),
  });
  onSync((values) => {
    if (values.ReverbTime !== undefined) revxTime.setValue(values.ReverbTime);
  });

  const revxReturn = makeKnob($("#revx-return"), {
    min: 0,
    max: 127,
    value: 103,
    defaultValue: 103,
    onChange: (v) => setParam(`Mix${state.activeMix}ReverbVolume`, v),
  });
  onSync((values) => {
    const v = values[`Mix${state.activeMix}ReverbVolume`];
    if (v !== undefined) revxReturn.setValue(v);
  });

  setActiveMix(0);

  // if the backend is already connected (e.g. page reloaded), adopt its state
  if (status.connected) {
    setConnectionUI(true, status.port);
    state.values = status.values || {};
    state.fxState = status.fxState || [];
    syncControls();
  } else {
    // try to connect automatically on startup - silent on failure, since
    // the manual Conectar button is right there for the user to retry
    connect(true);
  }

  connectEventStream();
}

api("/api/dbfs-table").then((table) => {
  window.__DBFS_TABLE__ = table;
});

init().catch((err) => console.error("Failed to initialize UI:", err));
