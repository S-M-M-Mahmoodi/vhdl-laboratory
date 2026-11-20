/* ==========================================================================
   Board Lab — Proteus-style FPGA board simulator for VHDL Laboratory
   -------------------------------------------------------------------------
   Dark free-place canvas:
   - drag components from the left palette anywhere on the canvas
   - every component has terminals (net labels); terminals with the SAME
     name are electrically connected (like Proteus net labels)
   - FPGA pins are terminals too, so wiring a switch to port "sw" means
     naming both terminals "sw"
   - VCC / GND power components tie the common side of switches
   - clock generator drives the clock port
   - Run compiles the entity + generated board testbench with GHDL and
     lights LEDs / 7-segment digits / pin indicators with real values.
   ========================================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const SEG_PATTERNS = {
    "0": "1111110", "1": "0110000", "2": "1101101", "3": "1111001", "4": "0110011",
    "5": "1011011", "6": "1011111", "7": "1110000", "8": "1111111", "9": "1111011",
    "A": "1110111", "b": "0011111", "C": "1001110", "d": "0111101", "E": "1001111",
    "F": "1000111", "-": "0000001", " ": "0000000",
  };
  const HEXCH = "0123456789ABCDEF";

  /* Palette definitions ----------------------------------------------- */
  const PAL_ICONS = {
    dip: `<svg viewBox="0 0 44 34" width="40" height="30"><rect x="4" y="6" width="36" height="22" rx="3" fill="#10151d" stroke="#2a3547"/><g fill="#9aa7b8">${[0, 1, 2, 3].map(i => `<rect x="${9 + i * 8}" y="11" width="5" height="12" rx="1.5"/>`).join("")}</g></svg>`,
    push: `<svg viewBox="0 0 44 34" width="40" height="30"><line x1="4" y1="20" x2="14" y2="20" stroke="#8b99ab" stroke-width="2"/><circle cx="15" cy="20" r="2.5" fill="none" stroke="#5fd3f0" stroke-width="1.8"/><circle cx="29" cy="20" r="2.5" fill="none" stroke="#5fd3f0" stroke-width="1.8"/><line x1="30" y1="20" x2="40" y2="20" stroke="#8b99ab" stroke-width="2"/><line x1="12" y1="13" x2="32" y2="13" stroke="#2ee66b" stroke-width="2.5" stroke-linecap="round"/><line x1="22" y1="13" x2="22" y2="6" stroke="#8b99ab" stroke-width="2"/><rect x="18" y="5" width="8" height="3" rx="1" fill="#46d96c"/></svg>`,
    led: `<svg viewBox="0 0 36 28" width="36" height="28">
      <circle cx="18" cy="14" r="11" fill="#101720" stroke="#253547" stroke-width="1.5"/>
      <line x1="9" y1="14" x2="13" y2="14" stroke="#46d96c" stroke-width="1.8"/>
      <polygon points="13,9 20,14 13,19" fill="#46d96c"/>
      <line x1="20" y1="8" x2="20" y2="20" stroke="#46d96c" stroke-width="2" stroke-linecap="round"/>
      <line x1="20" y1="14" x2="27" y2="14" stroke="#46d96c" stroke-width="1.8"/>
      <path d="M17,9 L22,4 M19,4 L22,4 L22,7" stroke="#7ff2a8" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    </svg>`,
    ledR: `<svg viewBox="0 0 36 28" width="36" height="28">
      <circle cx="18" cy="14" r="11" fill="#101720" stroke="#253547" stroke-width="1.5"/>
      <line x1="9" y1="14" x2="13" y2="14" stroke="#ff5038" stroke-width="1.8"/>
      <polygon points="13,9 20,14 13,19" fill="#ff5038"/>
      <line x1="20" y1="8" x2="20" y2="20" stroke="#ff5038" stroke-width="2" stroke-linecap="round"/>
      <line x1="20" y1="14" x2="27" y2="14" stroke="#ff5038" stroke-width="1.8"/>
      <path d="M17,9 L22,4 M19,4 L22,4 L22,7" stroke="#ff9d8f" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    </svg>`,
    seg: `<svg viewBox="0 0 44 34" width="40" height="30">
      <rect x="11" y="3" width="22" height="28" rx="3" fill="#10151d" stroke="#2a3c54" stroke-width="1.5"/>
      <g fill="#ff5038">
        <polygon points="15.5,5.5 24.5,5.5 26,7 24.5,8.5 15.5,8.5 14,7"/>
        <polygon points="25.5,7.5 27,9 27,13.5 25.5,15 24,13.5 24,9"/>
        <polygon points="25.5,16.5 27,18 27,22.5 25.5,24 24,22.5 24,18"/>
        <polygon points="15.5,23.5 24.5,23.5 26,25 24.5,26.5 15.5,26.5 14,25"/>
        <polygon points="14.5,16.5 16,18 16,22.5 14.5,24 13,22.5 13,18"/>
        <polygon points="14.5,7.5 16,9 16,13.5 14.5,15 13,13.5 13,9"/>
        <polygon points="15.5,14.5 24.5,14.5 26,16 24.5,17.5 15.5,17.5 14,16"/>
        <circle cx="28.5" cy="25" r="1.3"/>
      </g>
    </svg>`,
    hex: `<svg viewBox="0 0 44 34" width="40" height="30"><rect x="5" y="8" width="34" height="18" rx="3" fill="#05080c" stroke="#2a3547"/><text x="22" y="21" text-anchor="middle" font-family="monospace" font-size="10" fill="#7fe3a8">A5</text></svg>`,
    clk: `<svg viewBox="0 0 44 34" width="40" height="30"><rect x="4" y="10" width="36" height="14" rx="3" fill="#10151d" stroke="#2a3547"/><path d="M8 17h5v-4h6v8h6v-8h6v8h5" stroke="#5fd3f0" stroke-width="1.8" fill="none"/></svg>`,
    vcc: `<svg viewBox="0 0 44 34" width="40" height="30"><path d="M12 14h20M22 14v12" stroke="#c8402f" stroke-width="2.4" stroke-linecap="round"/><circle cx="22" cy="10" r="3.4" fill="none" stroke="#c8402f" stroke-width="1.8"/></svg>`,
    gnd: `<svg viewBox="0 0 44 34" width="40" height="30"><path d="M22 6v12M14 20h16M17 24h10M20 28h4" stroke="#8b99ab" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    text: `<svg viewBox="0 0 44 34" width="40" height="30"><text x="22" y="24" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="#5fd3f0">T</text></svg>`,
    line: `<svg viewBox="0 0 44 34" width="40" height="30"><line x1="6" y1="26" x2="38" y2="8" stroke="#5fd3f0" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    rect: `<svg viewBox="0 0 44 34" width="40" height="30"><rect x="7" y="8" width="30" height="18" rx="2" fill="none" stroke="#5fd3f0" stroke-width="2"/></svg>`,
    circle: `<svg viewBox="0 0 44 34" width="40" height="30"><circle cx="22" cy="17" r="11" fill="none" stroke="#5fd3f0" stroke-width="2"/></svg>`,
    chip: `<svg viewBox="0 0 44 34" width="40" height="30"><rect x="10" y="8" width="24" height="18" rx="2" fill="#0d141e" stroke="#5fd3f0" stroke-width="1.6"/><path d="M7 11h3M7 15h3M7 19h3M7 23h3M34 11h3M34 15h3M34 19h3M34 23h3" stroke="#8b99ab" stroke-width="1.8"/><text x="22" y="20" text-anchor="middle" font-family="monospace" font-size="7.5" fill="#5fd3f0">7447</text></svg>`,
  };

  const PALETTE = [
    { type: "dip",          label: "DIP switch ×8",     icon: "dip",    w: 8 },
    { type: "dip4",         label: "DIP switch ×4",     icon: "dip",    w: 4 },
    { type: "dip2",         label: "DIP switch ×2",     icon: "dip",    w: 2 },
    { type: "dip1",         label: "DIP switch ×1",     icon: "dip",    w: 1 },
    { type: "push",         label: "Push button",       icon: "push",   w: 1 },
    { type: "bcd7seg",      label: "7-Seg Decoder (4-bit)", icon: "chip", w: 4 },
    { type: "led",          label: "LED (green)",       icon: "led",    color: "green", w: 1 },
    { type: "ledR",         label: "LED (red)",         icon: "ledR",   color: "red",   w: 1 },
    { type: "seg",          label: "7-segment digit",   icon: "seg",    w: 4 },
    { type: "hex",          label: "Hex readout",       icon: "hex",    w: 32 },
    { type: "clk",          label: "Clock generator",   icon: "clk",    w: 1 },
    { type: "vcc",          label: "VCC (+)",           icon: "vcc",    w: 0 },
    { type: "gnd",          label: "GND (−)",           icon: "gnd",    w: 0 },
    { type: "text",         label: "Text Label",        icon: "text",   w: 0 },
    { type: "shape_line",   label: "Line",              icon: "line",   w: 0 },
    { type: "shape_rect",   label: "Rectangle",         icon: "rect",   w: 0 },
    { type: "shape_circle", label: "Circle",            icon: "circle", w: 0 },
  ];

  /* State -------------------------------------------------------------- */
  const BL = {
    open: false,
    entity: "",
    ports: [],            // entity ports (from parser)
    generics: [],
    comps: [],            // placed components: {id,type,x,y,...}
    nextId: 1,
    fpgaPos: null,
    pinNames: null,       // port -> custom terminal name
    lastOutputs: null,
    live: false,
    pendingLive: false,
    busy: false,
    activeTool: null,     // active drawing tool: "shape_line", "shape_rect", "shape_circle"
    zoom: 1.0,
    panX: 0,
    panY: 0,
    undoStack: [],
    redoStack: [],
  };

  let activeDrag = null;
  let activeResize = null;

  const MAX_UNDO = 50;

  function getBoardSnapshot() {
    return JSON.stringify({
      comps: BL.comps,
      fpgaPos: BL.fpgaPos,
      pinNames: BL.pinNames
    });
  }

  function pushUndo() {
    const snap = getBoardSnapshot();
    if (BL.undoStack.length && BL.undoStack[BL.undoStack.length - 1] === snap) return;
    BL.undoStack.push(snap);
    if (BL.undoStack.length > MAX_UNDO) BL.undoStack.shift();
    BL.redoStack = [];
    updateUndoRedoUI();
  }

  function undo() {
    if (!BL.undoStack.length) return;
    const current = getBoardSnapshot();
    BL.redoStack.push(current);
    const snapStr = BL.undoStack.pop();
    const snap = JSON.parse(snapStr);
    BL.comps = snap.comps || [];
    BL.fpgaPos = snap.fpgaPos || null;
    BL.pinNames = snap.pinNames || {};
    renderCanvas();
    saveBench();
    updateUndoRedoUI();
  }

  function redo() {
    if (!BL.redoStack.length) return;
    const current = getBoardSnapshot();
    BL.undoStack.push(current);
    const snapStr = BL.redoStack.pop();
    const snap = JSON.parse(snapStr);
    BL.comps = snap.comps || [];
    BL.fpgaPos = snap.fpgaPos || null;
    BL.pinNames = snap.pinNames || {};
    renderCanvas();
    saveBench();
    updateUndoRedoUI();
  }

  function updateUndoRedoUI() {
    const btnUndo = $("blBtnUndo");
    const btnRedo = $("blBtnRedo");
    if (btnUndo) {
      btnUndo.disabled = BL.undoStack.length === 0;
      btnUndo.style.opacity = BL.undoStack.length === 0 ? "0.4" : "1";
    }
    if (btnRedo) {
      btnRedo.disabled = BL.redoStack.length === 0;
      btnRedo.style.opacity = BL.redoStack.length === 0 ? "0.4" : "1";
    }
  }

  /* ------------------------------------------------------------------ *
   *  project / entity helpers
   * ------------------------------------------------------------------ */

  function getProject() {
    return (window.state && window.state.project) || null;
  }

  function syncOpenFiles() {
    const p = getProject();
    if (!p || !p.files) return;
    p.files.forEach((f) => {
      if (window.fileDocs && window.fileDocs.has(f.filename)) {
        f.code = window.fileDocs.get(f.filename).getValue();
      }
    });
  }

  function refreshEntity() {
    syncOpenFiles();
    const p = getProject();
    BL.ports = [];
    BL.entity = "";
    BL.generics = [];
    if (!p) return;
    let src = (p.files || []).find((f) =>
      (f.type || "design").toLowerCase() === "design" &&
      f.entity === (p.top_entity || p.entity));
    if (!src) src = (p.files || []).find((f) => (f.type || "design").toLowerCase() === "design");
    if (!src && p.files && p.files.length) src = p.files[0];
    if (!src) return;
    BL.entity = src.entity || p.entity || "";
    if (src.ports && src.ports.length) BL.ports = src.ports.map((x) => ({ ...x }));
    const code = src.code || "";
    if (code && typeof window.parseEntityPortsJS === "function") {
      try {
        const ports = window.parseEntityPortsJS(code, BL.entity);
        if (ports.length) BL.ports = ports;
      } catch (e) { /* keep stored */ }
    }
    const gm = /\bgeneric\s*\(([\s\S]*?)\)/i.exec(code || "");
    if (gm) {
      for (const chunk of gm[1].split(";")) {
        const m = /^\s*(\w+)\s*:\s*(integer|natural|positive)\s*(?::=\s*(\d+))?/i.exec(chunk);
        if (m) BL.generics.push({ name: m[1], type: m[2].toLowerCase(),
                                  default: m[3] ? parseInt(m[3], 10) : null });
      }
    }
  }

  function portWidth(p) {
    if (!p.vector) return 1;
    return Math.abs((p.msb ?? 0) - (p.lsb ?? 0)) + 1;
  }

  /* ------------------------------------------------------------------ *
   *  component model
   * ------------------------------------------------------------------ */

  function makeComp(type, x, y) {
    const def = PALETTE.find((d) => d.type === type);
    const id = "c" + (BL.nextId++);
    const c = {
      id, type, x, y,
      label: def.label,
      width: def.w || 0,
      color: def.color || null,
      on: {},                // dip/push bit states (bitIdx -> 0/1)
      terms: [],             // [{key, name}] — name is the net label
    };
    switch (type) {
      case "dip":
      case "dip4":
      case "dip2":
      case "dip1": {
        const w = type === "dip" ? 8 : (type === "dip4" ? 4 : (type === "dip2" ? 2 : 1));
        c.width = w;
        c.busNet = "";
        for (let i = 0; i < w; i++) c.on[i] = 0;
        // one terminal per bit + a COM terminal for the common side
        for (let i = w - 1; i >= 0; i--) c.terms.push({ key: "b" + i, name: "" });
        c.terms.push({ key: "com", name: "" });
        break;
      }
      case "bcd7seg": {
        c.width = 4;
        c.val = 0;
        c.terms = [
          { key: "d3", name: "" },
          { key: "d2", name: "" },
          { key: "d1", name: "" },
          { key: "d0", name: "" },
          { key: "a", name: "" },
          { key: "b", name: "" },
          { key: "c", name: "" },
          { key: "d", name: "" },
          { key: "e", name: "" },
          { key: "f", name: "" },
          { key: "g", name: "" },
        ];
        break;
      }
      case "push":
        c.on[0] = 0;
        c.terms = [{ key: "a", name: "" }, { key: "com", name: "" }];
        break;
      case "led":
      case "ledR":
        c.terms = [{ key: "a", name: "" }, { key: "k", name: "" }];
        break;
      case "seg":
        c.terms = [
          { key: "a", name: "" },
          { key: "b", name: "" },
          { key: "c", name: "" },
          { key: "d", name: "" },
          { key: "e", name: "" },
          { key: "f", name: "" },
          { key: "g", name: "" },
          { key: "dp", name: "" },
          { key: "bus", name: "" }
        ];
        break;
      case "hex":
        c.terms = [{ key: "bus", name: "" }];
        break;
      case "clk":
        c.freq = 2;
        c.unit = "Hz";
        c.terms = [{ key: "out", name: "" }];
        break;
      case "vcc":
        c.terms = [{ key: "p", name: "vcc", fixed: true }];
        break;
      case "gnd":
        c.terms = [{ key: "p", name: "gnd", fixed: true }];
        break;
      case "text":
        c.text = "Text Label";
        c.fontSize = 14;
        c.color = "#d5dfe9";
        c.bold = false;
        c.terms = [];
        break;
      case "shape_line":
        c.dx = 140;
        c.dy = 0;
        c.width = 140;
        c.height = 0;
        c.stroke = "#5fd3f0";
        c.strokeWidth = 2;
        c.dash = "solid";
        c.terms = [];
        break;
      case "shape_rect":
        c.width = 140;
        c.height = 90;
        c.stroke = "#5fd3f0";
        c.strokeWidth = 2;
        c.fill = "none";
        c.fillColor = "#121820";
        c.dash = "solid";
        c.terms = [];
        break;
      case "shape_circle":
        c.width = 100;
        c.height = 100;
        c.stroke = "#5fd3f0";
        c.strokeWidth = 2;
        c.fill = "none";
        c.fillColor = "#121820";
        c.dash = "solid";
        c.terms = [];
        break;
    }
    return c;
  }

  /* Netlist: terminals with equal non-empty names are connected -------- */
  function netName(t) {
    return (t && t.name ? String(t.name) : "").trim().toLowerCase();
  }

  function collectNets() {
    const inputs = {};
    let clockPort = "";
    let halfPeriodNs = 10;

    const fpgaEl = $("blCanvas") ? $("blCanvas").querySelector(".bl-comp.is-fpga") : null;

    // Helper to get pin net from input DOM or BL.pinNames
    const getPinNet = (key, fallback = "") => {
      if (fpgaEl) {
        const pinInp = fpgaEl.querySelector(`.bl-fpga-pin[data-pin-key="${key}"] input, .bl-fpga-pin[data-port="${key}"] input`);
        if (pinInp && pinInp.value) return pinInp.value.trim().toLowerCase();
      }
      if (BL.pinNames && BL.pinNames[key]) return String(BL.pinNames[key]).trim().toLowerCase();
      return fallback.trim().toLowerCase();
    };

    // Clock generator: calculate halfPeriodNs and find clock net
    let clkNet = "";
    for (const c of BL.comps) {
      if (c.type === "clk") {
        const t = c.terms.find((x) => x.key === "out");
        if (t && netName(t)) clkNet = netName(t);
        const f = parseFloat(c.freq) || 50;
        const u = c.unit || "MHz";
        let fHz = f;
        if (u === "kHz") fHz = f * 1e3;
        else if (u === "MHz") fHz = f * 1e6;
        if (fHz > 0) halfPeriodNs = 5e8 / fHz;
      }
    }

    // Value of a net driven by switches/buttons/power
    const driveNet = (net) => {
      if (!net) return null;
      if (net === "vcc") return "1";
      if (net === "gnd") return "0";
      for (const c of BL.comps) {
        if (c.type.startsWith("dip")) {
          const comTerm = c.terms.find((t) => t.key === "com");
          const comNet = netName(comTerm || {});
          const isGndCom = (comNet === "gnd");
          const onVal = isGndCom ? "0" : "1";
          const offVal = isGndCom ? "1" : "0";

          if (c.busNet && c.busNet.trim().toLowerCase() === net) {
            let s = "";
            for (let i = c.width - 1; i >= 0; i--) {
              s += (c.on[i] ? onVal : offVal);
            }
            return s;
          }
          const bits = c.terms.filter((t) => t.key !== "com" && netName(t) === net);
          if (bits.length) {
            const idxs = bits.map((t) => parseInt(t.key.slice(1), 10)).sort((a, b) => b - a);
            let s = "";
            for (const idx of idxs) {
              s += (c.on[idx] ? onVal : offVal);
            }
            return s;
          }
        } else if (c.type === "push") {
          const comTerm = c.terms.find((t) => t.key === "com");
          const comNet = netName(comTerm || {});
          const isGndCom = (comNet === "gnd");
          const onVal = isGndCom ? "0" : "1";
          const offVal = isGndCom ? "1" : "0";
          for (const t of c.terms) {
            if (t.key !== "com" && netName(t) === net) return String(c.on[0] ? onVal : offVal);
          }
        } else if (c.type === "bcd7seg") {
          const segKeys = ["a", "b", "c", "d", "e", "f", "g"];
          for (let i = 0; i < 7; i++) {
            const t = c.terms.find((x) => x.key === segKeys[i]);
            if (t && netName(t) === net) {
              let v = 0;
              for (let b = 0; b < 4; b++) {
                const dt = c.terms.find((x) => x.key === "d" + b);
                const dnet = netName(dt || {});
                if (dnet && driveNet(dnet) === "1") v |= (1 << b);
              }
              const pat = SEG_PATTERNS[HEXCH[v & 0xF]] || "0000000";
              return pat[i];
            }
          }
        }
      }
      return null;
    };

    for (const p of BL.ports) {
      if (p.dir !== "in") continue;

      if (!p.vector) {
        // Scalar input port
        const net = getPinNet(p.name, p.name);
        if (!net) continue;
        if (clkNet && net === clkNet) { clockPort = p.name; continue; }
        const v = driveNet(net);
        if (v !== null) {
          inputs[p.name] = v.slice(-1);
        }
      } else {
        // Multi-bit vector input port (e.g. A(7 downto 0))
        const w = portWidth(p);
        const msb = p.msb ?? (w - 1);
        const lsb = p.lsb ?? 0;
        const isDownto = msb >= lsb;
        const bitIndices = [];
        if (isDownto) {
          for (let i = msb; i >= lsb; i--) bitIndices.push(i);
        } else {
          for (let i = msb; i <= lsb; i++) bitIndices.push(i);
        }

        // Pre-scan pin net labels for this vector port to support group/slice bus nets
        const pinNets = [];
        const netToPinIndices = {};
        for (let b = 0; b < bitIndices.length; b++) {
          const bitIdx = bitIndices[b];
          const bitKey = `${p.name}(${bitIdx})`;
          const bitNet = getPinNet(bitKey, "");
          pinNets.push(bitNet);
          if (bitNet) {
            if (!netToPinIndices[bitNet]) netToPinIndices[bitNet] = [];
            netToPinIndices[bitNet].push(b);
          }
        }

        // Check if there is a whole-bus net label assigned
        const busNet = getPinNet(p.name, "");
        const busVal = busNet ? driveNet(busNet) : null;

        let assembled = "";
        let anyDriven = false;

        for (let b = 0; b < bitIndices.length; b++) {
          const bitNet = pinNets[b];

          let bitVal = null;
          if (bitNet) {
            const driven = driveNet(bitNet);
            if (driven !== null && driven !== "") {
              anyDriven = true;
              const pinsWithNet = netToPinIndices[bitNet];
              if (pinsWithNet && pinsWithNet.length > 1 && driven.length > 1) {
                // Group vector net slice: assign corresponding bit matching position
                const pos = pinsWithNet.indexOf(b);
                if (pos >= 0 && pos < driven.length) {
                  bitVal = driven[pos];
                } else {
                  bitVal = driven.slice(-1);
                }
              } else {
                // Scalar net or single-bit driver
                bitVal = driven.slice(-1);
              }
            }
          }
          if (bitVal === null && busVal !== null) {
            bitVal = busVal.length >= bitIndices.length ? busVal[b] : "0";
            anyDriven = true;
          }
          if (bitVal === null) bitVal = "0";
          assembled += bitVal;
        }

        if (anyDriven) {
          inputs[p.name] = assembled;
        }
      }
    }

    // auto clock: clk component present + a clk-ish unwired input port
    if (clkNet && !clockPort) {
      const auto = BL.ports.find((p) => p.dir === "in" && /clk|clock/i.test(p.name));
      if (auto && !inputs[auto.name]) clockPort = auto.name;
    }

    return { inputs, clockPort, halfPeriodNs };
  }

  /* ------------------------------------------------------------------ *
   *  rendering
   * ------------------------------------------------------------------ */

  function render() {
    renderPalette();
    renderCanvas();
    updateStatus();
  }

  function renderPalette() {
    const host = $("blPaletteList");
    if (!host) return;
    if (host.childElementCount) return;              // build once
    for (const def of PALETTE) {
      const it = document.createElement("div");
      it.className = "bl-pal-item";
      it.dataset.type = def.type;
      it.draggable = true;
      it.innerHTML =
        `<span class="bl-pal-ico">${PAL_ICONS[def.icon]}</span>` +
        `<span class="bl-pal-lab">${esc(def.label)}</span>`;
      it.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/bl-comp", def.type);
        e.dataTransfer.effectAllowed = "copy";
        it.classList.add("is-dragging");
      });
      it.addEventListener("dragend", () => it.classList.remove("is-dragging"));
      // click = toggle drawing tool for shapes, or place for standard components
      it.addEventListener("click", () => {
        if (def.type.startsWith("shape_")) {
          if (BL.activeTool === def.type) {
            setActiveTool(null);
          } else {
            setActiveTool(def.type);
          }
        } else {
          setActiveTool(null);
          placeAt(def.type, findFreeSpot());
        }
      });
      host.appendChild(it);
    }
  }

  function setActiveTool(type) {
    BL.activeTool = type;
    const canvas = $("blCanvas");
    if (canvas) canvas.classList.toggle("is-drawing-mode", !!type);

    document.querySelectorAll(".bl-pal-item").forEach((it) => {
      it.classList.toggle("is-active-tool", it.dataset.type === type);
    });

    if (type) {
      const def = PALETTE.find((x) => x.type === type);
      const name = def ? def.label : type;
      setDot("run", `Drawing ${name} — Click & drag on canvas to draw and size (Esc to exit)`);
    } else {
      setDot("", "idle — configure nets and click Run");
    }
  }

  function findFreeSpot() {
    const n = BL.comps.length;
    return { x: 40 + (n % 4) * 170, y: 30 + Math.floor(n / 4) * 150 };
  }

  function buildOriginMarker() {
    let el = $("blOriginMarker");
    if (el) return el;
    el = document.createElement("div");
    el.id = "blOriginMarker";
    el.className = "bl-origin-marker";
    el.innerHTML = `
      <svg viewBox="-30 -30 90 90" width="90" height="90" class="bl-origin-svg">
        <line x1="-24" y1="0" x2="42" y2="0" stroke="#5fd3f0" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.5"/>
        <line x1="0" y1="-24" x2="0" y2="42" stroke="#5fd3f0" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.5"/>
        <line x1="0" y1="0" x2="38" y2="0" stroke="#5fd3f0" stroke-width="1.8"/>
        <polygon points="42,0 34,-3 34,3" fill="#5fd3f0"/>
        <line x1="0" y1="0" x2="0" y2="38" stroke="#5fd3f0" stroke-width="1.8"/>
        <polygon points="0,42 -3,34 3,34" fill="#5fd3f0"/>
        <circle cx="0" cy="0" r="6" fill="none" stroke="#5fd3f0" stroke-width="1.4"/>
        <circle cx="0" cy="0" r="2.2" fill="#5fd3f0"/>
        <text x="44" y="3.5" font-family="'JetBrains Mono', Consolas, monospace" font-size="8.5" font-weight="700" fill="#5fd3f0">+X</text>
        <text x="3" y="50" font-family="'JetBrains Mono', Consolas, monospace" font-size="8.5" font-weight="700" fill="#5fd3f0">+Y</text>
        <text x="-6" y="-9" font-family="'JetBrains Mono', Consolas, monospace" font-size="8" font-weight="600" fill="#8b99ab" opacity="0.9">(0,0)</text>
      </svg>
    `;
    return el;
  }

  function renderCanvas() {
    const canvas = $("blCanvas");
    if (!canvas) return;
    let world = $("blCanvasWorld");
    if (!world) {
      world = document.createElement("div");
      world.id = "blCanvasWorld";
      world.className = "bl-canvas-world";
      canvas.appendChild(world);
    }
    for (const el of [...world.children]) {
      if (el.id !== "blDrawOverlay" && el.id !== "blDrawHud" && el.id !== "blOriginMarker" && !el.classList.contains("bl-wires")) el.remove();
    }
    if (!$("blOriginMarker")) world.prepend(buildOriginMarker());
    if (BL.ports.length) world.appendChild(buildFpga());
    for (const c of BL.comps) world.appendChild(buildComp(c));
    updateEmpty();
    $("blCountInfo").textContent =
      `${BL.comps.length} component${BL.comps.length === 1 ? "" : "s"}` +
      (BL.ports.length ? ` · ${BL.ports.length} FPGA pins` : "");
    drawWires();
    applyCanvasTransform();
  }

  function updateEmpty() {
    const empty = $("blEmpty");
    const has = BL.comps.length > 0 || BL.ports.length > 0;
    empty.classList.toggle("bl-hide", has);
    if (!BL.ports.length) {
      $("blEmptyMsg").innerHTML =
        "Open a project with a design entity first — its ports will appear as FPGA pins on the canvas.";
    }
  }

  /* FPGA chip component ------------------------------------------------ */
  function buildFpga() {
    const el = document.createElement("div");
    el.className = "bl-comp is-fpga";
    el.dataset.id = "__fpga";
    el.style.left = (BL.fpgaPos?.x ?? 40) + "px";
    el.style.top = (BL.fpgaPos?.y ?? 40) + "px";
    const ins = BL.ports.filter((p) => p.dir === "in");
    const outs = BL.ports.filter((p) => p.dir !== "in");

    let pinsHTML = "";
    for (const p of BL.ports) {
      if (!p.vector) {
        pinsHTML += `
          <div class="bl-term bl-fpga-pin" data-port="${esc(p.name)}" data-pin-key="${esc(p.name)}" data-dir="${p.dir}" data-w="1"
               title="Terminal for port ${esc(p.name)} (${p.dir}) — dbl-click to configure">
            <span class="bl-term-tag"></span>
            <span style="font-size:9.5px;color:#8b99ab;min-width:32px">${esc(p.name)}</span>
            <input value="${esc(BL.pinNames?.[p.name] || '')}" placeholder="net" spellcheck="false" maxlength="24">
          </div>`;
      } else {
        const w = portWidth(p);
        const msb = p.msb ?? (w - 1);
        const lsb = p.lsb ?? 0;
        const isDownto = msb >= lsb;
        const bitIndices = [];
        if (isDownto) { for (let i = msb; i >= lsb; i--) bitIndices.push(i); }
        else { for (let i = msb; i <= lsb; i++) bitIndices.push(i); }

        pinsHTML += `
          <div class="bl-fpga-vec-group">
            <div class="bl-fpga-vec-header" title="Bus label for ${esc(p.name)} (${msb} downto ${lsb})">
              <span>${esc(p.name)} [${msb}:${lsb}]</span>
              <span class="bl-term bl-fpga-pin" data-port="${esc(p.name)}" data-pin-key="${esc(p.name)}" data-dir="${p.dir}" style="display:inline-flex;padding:0 2px">
                <input value="${esc(BL.pinNames?.[p.name] || '')}" placeholder="bus" spellcheck="false" style="width:44px;font-size:9px" title="Whole bus net label">
              </span>
            </div>
            <div class="bl-fpga-vec-bits">
              ${bitIndices.map(b => `
                <div class="bl-term bl-fpga-pin" data-port="${esc(p.name)}" data-bit="${b}" data-pin-key="${esc(p.name)}(${b})" data-dir="${p.dir}" title="${esc(p.name)}(${b})">
                  <span class="bl-term-tag"></span>
                  <span style="font-size:9px;color:#8b99ab;min-width:32px">${esc(p.name)}(${b})</span>
                  <input value="${esc(BL.pinNames?.[p.name + '(' + b + ')'] || '')}" placeholder="net" spellcheck="false" maxlength="24">
                </div>
              `).join("")}
            </div>
          </div>`;
      }
    }

    el.innerHTML = `
      <div class="bl-comp-head">
        <span class="bl-comp-name">FPGA</span>
        <button class="bl-comp-del bl-comp-reset" title="Reset FPGA position to default">↺</button>
      </div>
      <div class="bl-fpga-inner" title="Double-click to open Pin Settings">
        <div class="bl-fpga-title">FPGA · entity</div>
        <div class="bl-fpga-name">${esc(BL.entity || "—")}</div>
        <div class="bl-fpga-sub">${ins.length} in / ${outs.length} out</div>
      </div>
      <div class="bl-fpga-pins">
        ${pinsHTML}
      </div>`;

    makeDraggable(el, "__fpga");

    // Double-click opens Properties Modal
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      openPropsModal("__fpga");
    });

    el.querySelector(".bl-comp-del").addEventListener("click", (e) => {
      e.stopPropagation();
      BL.fpgaPos = { x: 40, y: 40 };
      el.style.left = "40px";
      el.style.top = "40px";
      saveBench();
    });

    for (const inp of el.querySelectorAll(".bl-fpga-pin input")) {
      inp.addEventListener("input", () => {
        BL.pinNames = BL.pinNames || {};
        const pinEl = inp.closest(".bl-fpga-pin");
        const pinKey = pinEl ? pinEl.dataset.pinKey : null;
        if (pinKey) {
          if (inp.value.trim()) BL.pinNames[pinKey] = inp.value.trim();
          else delete BL.pinNames[pinKey];
        }
        saveBench();
      });
      inp.addEventListener("keydown", (e) => e.stopPropagation());
      inp.addEventListener("click", (e) => e.stopPropagation());
    }
    return el;
  }

  function updateLineShapeDOM(c, body) {
    const dx = c.dx !== undefined ? c.dx : (c.width || 140);
    const dy = c.dy !== undefined ? c.dy : (c.height || 0);
    const sw = Math.max(1, c.strokeWidth || 2);
    const dashAttr = c.dash === "dashed" ? '8 5' : (c.dash === "dotted" ? '3 3' : '');

    const pad = 16;
    const minX = Math.min(0, dx);
    const maxX = Math.max(0, dx);
    const minY = Math.min(0, dy);
    const maxY = Math.max(0, dy);

    const offX = minX - pad;
    const offY = minY - pad;
    const svgW = Math.max(32, (maxX - minX) + pad * 2);
    const svgH = Math.max(32, (maxY - minY) + pad * 2);

    const lx1 = 0 - offX;
    const ly1 = 0 - offY;
    const lx2 = dx - offX;
    const ly2 = dy - offY;

    let svg = body.querySelector("svg");
    if (!svg) {
      body.innerHTML = `
        <svg style="position:absolute;overflow:visible;pointer-events:none">
          <line class="bl-line-hit" stroke="transparent" style="pointer-events:stroke;cursor:move"/>
          <line class="bl-line-vis" stroke-linecap="round" style="pointer-events:none"/>
        </svg>
        <div class="bl-shape-handle handle-start" title="Drag to move start point"></div>
        <div class="bl-shape-handle handle-end" title="Drag to change length & angle"></div>`;
      svg = body.querySelector("svg");
    }

    svg.setAttribute("width", svgW);
    svg.setAttribute("height", svgH);
    svg.style.left = offX + "px";
    svg.style.top = offY + "px";
    svg.style.width = svgW + "px";
    svg.style.height = svgH + "px";

    const hit = svg.querySelector(".bl-line-hit");
    if (hit) {
      hit.setAttribute("x1", lx1);
      hit.setAttribute("y1", ly1);
      hit.setAttribute("x2", lx2);
      hit.setAttribute("y2", ly2);
      hit.setAttribute("stroke-width", Math.max(16, sw + 10));
    }

    const vis = svg.querySelector(".bl-line-vis");
    if (vis) {
      vis.setAttribute("x1", lx1);
      vis.setAttribute("y1", ly1);
      vis.setAttribute("x2", lx2);
      vis.setAttribute("y2", ly2);
      vis.setAttribute("stroke", c.stroke || "#5fd3f0");
      vis.setAttribute("stroke-width", sw);
      if (dashAttr) vis.setAttribute("stroke-dasharray", dashAttr);
      else vis.removeAttribute("stroke-dasharray");
    }

    const startH = body.querySelector(".handle-start");
    if (startH) {
      startH.style.left = "0px";
      startH.style.top = "0px";
    }
    const endH = body.querySelector(".handle-end");
    if (endH) {
      endH.style.left = dx + "px";
      endH.style.top = dy + "px";
    }

    // Offset delete button so it has comfortable spacing from the line itself
    const parentComp = body.closest ? body.closest(".bl-comp") : body.parentElement;
    const delBtn = parentComp ? parentComp.querySelector(".bl-comp-del-btn") : null;
    if (delBtn) {
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const dist = 22; // 22px perpendicular clearance from the line
      const delX = Math.round(dx / 2 + nx * dist);
      const delY = Math.round(dy / 2 + ny * dist);
      delBtn.style.left = delX + "px";
      delBtn.style.top = delY + "px";
      delBtn.style.right = "auto";
    }
  }

  /* generic component --------------------------------------------------- */
  function buildComp(c) {
    const el = document.createElement("div");
    el.className = "bl-comp";
    el.dataset.id = c.id;
    if (c.type === "vcc") el.classList.add("is-vcc");
    if (c.type === "gnd") el.classList.add("is-gnd");
    if (c.type === "text") el.classList.add("is-text");
    if (c.type.startsWith("shape_")) el.classList.add("is-shape");
    if (c.type === "shape_line") el.classList.add("is-line-comp");
    el.style.left = c.x + "px";
    el.style.top = c.y + "px";

    // Subtle delete button on hover
    const delBtn = document.createElement("button");
    delBtn.className = "bl-comp-del-btn";
    delBtn.title = "Delete component";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndo();
      BL.comps = BL.comps.filter((x) => x.id !== c.id);
      renderCanvas();
      saveBench();
    });
    el.appendChild(delBtn);

    let hoverTimeout = null;
    const keepHover = () => {
      if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
      el.classList.add("is-hovered");
    };
    const dropHover = (delay = 1200) => {
      if (hoverTimeout) clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        el.classList.remove("is-hovered");
      }, delay);
    };

    delBtn.addEventListener("mouseenter", keepHover);
    delBtn.addEventListener("mouseleave", () => dropHover(300));

    // Double click opens Component Properties Modal (except fixed VCC and GND)
    if (c.type !== "vcc" && c.type !== "gnd") {
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        openPropsModal(c);
      });
    }

    if (c.type.startsWith("dip")) {
      const body = document.createElement("div");
      body.className = "bl-dip-body";
      for (let i = c.width - 1; i >= 0; i--) {
        const sw = document.createElement("div");
        sw.className = "bl-dip" + (c.on[i] ? " is-on" : "");
        sw.innerHTML =
          `<span class="bl-dip-num">${i}</span>` +
          `<span class="bl-dip-switch"></span>` +
          `<span class="bl-dip-val">${c.on[i] ? 1 : 0}</span>`;
        sw.addEventListener("click", (e) => {
          e.stopPropagation();
          c.on[i] = c.on[i] ? 0 : 1;
          sw.classList.toggle("is-on", !!c.on[i]);
          sw.querySelector(".bl-dip-val").textContent = c.on[i] ? "1" : "0";
          updateTagRow(c, el);
          saveBench();
          maybeLive();
        });
        body.appendChild(sw);
      }
      el.appendChild(body);
    } else if (c.type === "bcd7seg") {
      const body = document.createElement("div");
      body.className = "bl-decoder-ic";
      const hexVal = (c.val ?? 0) & 0xF;
      body.innerHTML = `
        <div class="bl-decoder-title">7447 BCD-7SEG</div>
        <div class="bl-decoder-body">
          <div class="bl-decoder-col">
            <span class="bl-decoder-tag">D3</span>
            <span class="bl-decoder-tag">D2</span>
            <span class="bl-decoder-tag">D1</span>
            <span class="bl-decoder-tag">D0</span>
          </div>
          <div class="bl-decoder-screen">${HEXCH[hexVal]}</div>
          <div class="bl-decoder-col" style="align-items:flex-end">
            <span class="bl-decoder-tag">A B C</span>
            <span class="bl-decoder-tag">D E F</span>
            <span class="bl-decoder-tag">G</span>
          </div>
        </div>`;
      el.appendChild(body);
    } else if (c.type === "push") {
      // Schematic momentary push button
      const body = document.createElement("div");
      body.className = "bl-push-sch" + (c.on[0] ? " is-on" : "");
      body.title = "Press and hold to connect (momentary)";
      body.innerHTML = `
        <svg class="bl-push-svg" viewBox="0 0 54 36" width="50" height="34">
          <line x1="2" y1="22" x2="16" y2="22" stroke="#5c6b7d" stroke-width="2.5"/>
          <circle cx="17" cy="22" r="3" fill="#10151d" stroke="#5fd3f0" stroke-width="2"/>
          <circle cx="37" cy="22" r="3" fill="#10151d" stroke="#5fd3f0" stroke-width="2"/>
          <line x1="38" y1="22" x2="52" y2="22" stroke="#5c6b7d" stroke-width="2.5"/>
          <g class="bl-push-contact">
            <line class="bl-push-bar" x1="13" y1="14" x2="41" y2="14" stroke="#2ee66b" stroke-width="3" stroke-linecap="round"/>
            <line class="bl-push-stem" x1="27" y1="14" x2="27" y2="6" stroke="#8b99ab" stroke-width="2.5"/>
            <rect class="bl-push-head" x1="21" y1="4" width="12" height="4" rx="1.5" fill="#46d96c"/>
          </g>
        </svg>`;

      const setPush = (val) => {
        if (c.on[0] === val) return;
        c.on[0] = val;
        body.classList.toggle("is-on", !!val);
        el.classList.toggle("is-on", !!val);
        updateTagRow(c, el);
        saveBench();
        maybeLive();
      };

      body.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        setPush(1);
      });
      body.addEventListener("mouseup", (e) => {
        e.stopPropagation();
        setPush(0);
      });
      body.addEventListener("mouseleave", () => {
        if (c.on[0]) setPush(0);
      });
      el.appendChild(body);
    } else if (c.type === "led" || c.type === "ledR") {
      const body = document.createElement("div");
      body.className = "bl-led" + (c.lit ? " is-on" : "");
      body.dataset.color = c.color || "green";
      body.style.cssText = "display:grid;place-items:center;padding:2px 4px";
      body.innerHTML = `
        <span class="bl-led-bulb">
          <svg class="bl-led-sch" viewBox="0 0 32 32" width="28" height="28">
            <line class="bl-diode-lead" x1="3" y1="17" x2="9" y2="17"/>
            <polygon class="bl-diode-tri" points="9,10 19,17 9,24"/>
            <line class="bl-diode-bar" x1="19" y1="9" x2="19" y2="25"/>
            <line class="bl-diode-lead" x1="19" y1="17" x2="29" y2="17"/>
            <g class="bl-diode-rays">
              <line class="bl-diode-ray-line" x1="15" y1="10" x2="21" y2="4"/>
              <polygon class="bl-diode-ray-arrow" points="21,4 17,5 20,8"/>
              <line class="bl-diode-ray-line" x1="19" y1="13" x2="26" y2="6"/>
              <polygon class="bl-diode-ray-arrow" points="26,6 22,7 25,10"/>
            </g>
          </svg>
        </span>`;
      el.appendChild(body);
    } else if (c.type === "seg") {
      const body = document.createElement("div");
      body.className = "bl-seg-digit";
      body.innerHTML = segDigitSVG() + `<span class="bl-seg-dp"></span>`;
      el.appendChild(body);
    } else if (c.type === "hex") {
      const body = document.createElement("div");
      body.className = "bl-hex-lcd";
      body.innerHTML = `<span class="bl-hex-val">—</span> <span class="bl-hex-bits"></span>`;
      el.appendChild(body);
    } else if (c.type === "clk") {
      const body = document.createElement("div");
      body.className = "bl-clk-wave";
      body.innerHTML =
        `<svg width="34" height="16" viewBox="0 0 34 16"><path d="M2 13h5V3h8v10h8V3h9" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>` +
        `<span class="bl-clk-f">${esc(c.freq || 50)} ${esc(c.unit || "MHz")}</span>`;
      el.appendChild(body);
    } else if (c.type === "vcc") {
      const body = document.createElement("div");
      body.className = "bl-power-sch is-vcc";
      body.title = "VCC Rail (+5V)";
      body.innerHTML = `
        <svg viewBox="0 0 44 34" width="36" height="28">
          <path d="M12 14h20M22 14v12" stroke="#c8402f" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="22" cy="10" r="3.4" fill="none" stroke="#c8402f" stroke-width="1.8"/>
        </svg>
        <span class="bl-power-sch-label" style="color:#ff9d8f">VCC</span>`;
      el.appendChild(body);
    } else if (c.type === "gnd") {
      const body = document.createElement("div");
      body.className = "bl-power-sch is-gnd";
      body.title = "GND Rail (0V)";
      body.innerHTML = `
        <svg viewBox="0 0 44 34" width="36" height="28">
          <path d="M22 6v12M14 20h16M17 24h10M20 28h4" stroke="#8b99ab" stroke-width="2.4" stroke-linecap="round"/>
        </svg>
        <span class="bl-power-sch-label" style="color:#c3ccd8">GND</span>`;
      el.appendChild(body);
    } else if (c.type === "text") {
      const body = document.createElement("div");
      body.className = "bl-text-comp";
      body.style.fontSize = (c.fontSize || 14) + "px";
      body.style.color = c.color || "#d5dfe9";
      body.style.fontWeight = c.bold ? "bold" : "normal";
      body.textContent = c.text || "Text Label";
      body.addEventListener("mouseenter", keepHover);
      body.addEventListener("mouseleave", () => dropHover(1200));
      body.addEventListener("mousedown", (e) => {
        if (e.target.closest(".bl-comp-del-btn")) return;
        for (const s of $("blCanvas").querySelectorAll(".bl-comp.is-selected")) {
          if (s !== el) s.classList.remove("is-selected");
        }
        el.classList.add("is-selected");
      });
      el.appendChild(body);
    } else if (c.type === "shape_line") {
      const body = document.createElement("div");
      body.className = "bl-shape-comp is-line";
      body.style.cssText = "position:relative;width:0;height:0;overflow:visible;";
      updateLineShapeDOM(c, body);

      const lineHit = body.querySelector(".bl-line-hit");
      if (lineHit) {
        lineHit.addEventListener("mouseenter", keepHover);
        lineHit.addEventListener("mouseleave", () => dropHover(1200));
        lineHit.addEventListener("mousedown", (e) => {
          if (e.target.closest(".bl-shape-handle, .bl-comp-del-btn")) return;
          if (e.ctrlKey || e.shiftKey) {
            el.classList.toggle("is-selected");
            return;
          }
          if (!el.classList.contains("is-selected")) {
            for (const s of $("blCanvas").querySelectorAll(".bl-comp.is-selected")) {
              if (s !== el) s.classList.remove("is-selected");
            }
            el.classList.add("is-selected");
          }
        });
      }

      // Dragging handle-end updates (dx, dy), length and angle
      const endHandle = body.querySelector(".handle-end");
      if (endHandle) {
        endHandle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          activeResize = {
            kind: "line-end",
            c, body, el,
            startX: e.clientX,
            startY: e.clientY,
            initDx: c.dx !== undefined ? c.dx : (c.width || 140),
            initDy: c.dy !== undefined ? c.dy : (c.height || 0),
            snap: getBoardSnapshot()
          };
          el.classList.add("is-resizing");
        });
      }

      // Dragging handle-start moves start point while keeping end point fixed in space
      const startHandle = body.querySelector(".handle-start");
      if (startHandle) {
        startHandle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          activeResize = {
            kind: "line-start",
            c, body, el,
            sx: e.clientX,
            sy: e.clientY,
            origX: c.x,
            origY: c.y,
            origDx: c.dx !== undefined ? c.dx : (c.width || 140),
            origDy: c.dy !== undefined ? c.dy : (c.height || 0),
            snap: getBoardSnapshot()
          };
          el.classList.add("is-resizing");
        });
      }

      el.appendChild(body);
      updateLineShapeDOM(c, body);
    } else if (c.type === "shape_rect") {
      const rw = Math.max(15, c.width || 140);
      const rh = Math.max(15, c.height || 90);
      const sw = Math.max(1, c.strokeWidth || 2);
      const fillVal = c.fill === "color" ? (c.fillColor || "#121820") : "none";
      const dashAttr = c.dash === "dashed" ? 'stroke-dasharray="8 5"' : (c.dash === "dotted" ? 'stroke-dasharray="3 3"' : '');
      const isSolid = c.fill === "color";

      const body = document.createElement("div");
      body.className = "bl-shape-comp is-rect";
      body.style.cssText = `position:relative;width:${rw}px;height:${rh}px;pointer-events:none;`;
      body.innerHTML = `
        <svg width="100%" height="100%" style="overflow:visible;display:block;pointer-events:none">
          <!-- Transparent hit outline on stroke so clicking the border selects/drags, while center is hollow -->
          <rect class="bl-rect-hit" x="${sw/2}" y="${sw/2}" width="${Math.max(2, rw - sw)}" height="${Math.max(2, rh - sw)}" rx="4"
                fill="${isSolid ? esc(fillVal) : 'none'}" stroke="transparent" stroke-width="${Math.max(14, sw + 8)}"
                style="pointer-events:${isSolid ? 'all' : 'stroke'};cursor:move"/>
          <rect class="bl-rect-vis" x="${sw/2}" y="${sw/2}" width="${Math.max(2, rw - sw)}" height="${Math.max(2, rh - sw)}" rx="4"
                fill="${esc(fillVal)}" stroke="${esc(c.stroke || '#5fd3f0')}" stroke-width="${sw}" ${dashAttr}
                style="pointer-events:none"/>
        </svg>
        <div class="bl-shape-handle handle-se" style="left:${rw}px;top:${rh}px;pointer-events:auto" title="Drag to resize"></div>`;

      const seHandle = body.querySelector(".handle-se");
      if (seHandle) {
        seHandle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          activeResize = {
            kind: "rect-se",
            c, body, el, seHandle, sw,
            sx: e.clientX,
            sy: e.clientY,
            origW: c.width || 140,
            origH: c.height || 90,
            snap: getBoardSnapshot()
          };
          el.classList.add("is-resizing");
        });
      }

      const rectHit = body.querySelector(".bl-rect-hit");
      if (rectHit) {
        rectHit.addEventListener("mouseenter", keepHover);
        rectHit.addEventListener("mouseleave", () => dropHover(1200));
        rectHit.addEventListener("mousedown", (e) => {
          if (e.target.closest(".bl-shape-handle, .bl-comp-del-btn")) return;
          if (e.ctrlKey || e.shiftKey) {
            el.classList.toggle("is-selected");
            return;
          }
          if (!el.classList.contains("is-selected")) {
            for (const s of $("blCanvas").querySelectorAll(".bl-comp.is-selected")) {
              if (s !== el) s.classList.remove("is-selected");
            }
            el.classList.add("is-selected");
          }
        });
      }

      el.appendChild(body);
    } else if (c.type === "shape_circle") {
      const cw = Math.max(15, c.width || 100);
      const ch = Math.max(15, c.height || 100);
      const sw = Math.max(1, c.strokeWidth || 2);
      const fillVal = c.fill === "color" ? (c.fillColor || "#121820") : "none";
      const dashAttr = c.dash === "dashed" ? 'stroke-dasharray="8 5"' : (c.dash === "dotted" ? 'stroke-dasharray="3 3"' : '');
      const isSolid = c.fill === "color";

      const body = document.createElement("div");
      body.className = "bl-shape-comp is-circle";
      body.style.cssText = `position:relative;width:${cw}px;height:${ch}px;pointer-events:none;`;
      body.innerHTML = `
        <svg width="100%" height="100%" style="overflow:visible;display:block;pointer-events:none">
          <!-- Transparent hit outline on circumference so clicking the border selects/drags, while center is hollow -->
          <ellipse class="bl-circle-hit" cx="${cw/2}" cy="${ch/2}" rx="${Math.max(2, (cw - sw)/2)}" ry="${Math.max(2, (ch - sw)/2)}"
                   fill="${isSolid ? esc(fillVal) : 'none'}" stroke="transparent" stroke-width="${Math.max(14, sw + 8)}"
                   style="pointer-events:${isSolid ? 'all' : 'stroke'};cursor:move"/>
          <ellipse class="bl-circle-vis" cx="${cw/2}" cy="${ch/2}" rx="${Math.max(2, (cw - sw)/2)}" ry="${Math.max(2, (ch - sw)/2)}"
                   fill="${esc(fillVal)}" stroke="${esc(c.stroke || '#5fd3f0')}" stroke-width="${sw}" ${dashAttr}
                   style="pointer-events:none"/>
        </svg>
        <div class="bl-shape-handle handle-se" style="left:${cw}px;top:${ch}px;pointer-events:auto" title="Drag to resize"></div>`;

      const seHandle = body.querySelector(".handle-se");
      if (seHandle) {
        seHandle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          activeResize = {
            kind: "circle-se",
            c, body, el, seHandle, sw,
            sx: e.clientX,
            sy: e.clientY,
            origW: c.width || 100,
            origH: c.height || 100,
            snap: getBoardSnapshot()
          };
          el.classList.add("is-resizing");
        });
      }

      const elpHit = body.querySelector(".bl-circle-hit");
      if (elpHit) {
        elpHit.addEventListener("mouseenter", keepHover);
        elpHit.addEventListener("mouseleave", () => dropHover(1200));
        elpHit.addEventListener("mousedown", (e) => {
          if (e.target.closest(".bl-shape-handle, .bl-comp-del-btn")) return;
          if (e.ctrlKey || e.shiftKey) {
            el.classList.toggle("is-selected");
            return;
          }
          if (!el.classList.contains("is-selected")) {
            for (const s of $("blCanvas").querySelectorAll(".bl-comp.is-selected")) {
              if (s !== el) s.classList.remove("is-selected");
            }
            el.classList.add("is-selected");
          }
        });
      }

      el.appendChild(body);
    }

    // Render compact net tags row underneath
    updateTagRow(c, el);

    makeDraggable(el, c.id);
    return el;
  }

  function updateTagRow(c, el) {
    let row = el.querySelector(".bl-comp-tags-row");
    if (c.type === "vcc" || c.type === "gnd" || c.type === "text" || c.type.startsWith("shape_")) {
      if (row) row.remove();
      return;
    }
    if (!row) {
      row = document.createElement("div");
      row.className = "bl-comp-tags-row";
      el.appendChild(row);
    }
    row.innerHTML = "";

    if (c.type === "clk") {
      const t = c.terms.find(x => x.key === "out");
      const net = netName(t || {});
      row.innerHTML = `<span class="bl-tag-pill" title="Clock Frequency">${c.freq || 50} ${c.unit || "MHz"}</span>` +
        (net ? `<span class="bl-tag-pill" title="Output Net">OUT: ${esc(net)}</span>` : "");
      return;
    }

    if (c.busNet) {
      const busPill = document.createElement("span");
      busPill.className = "bl-tag-pill";
      busPill.style.color = "#5fd3f0";
      busPill.textContent = "BUS: " + c.busNet;
      row.appendChild(busPill);
    }

    const named = c.terms.filter(t => netName(t));
    if (!named.length && !c.busNet) {
      // No badges when unwired (dbl-click text removed)
      return;
    }
    for (const t of named.slice(0, 4)) {
      const pill = document.createElement("span");
      pill.className = "bl-tag-pill";
      pill.textContent = (t.key ? t.key.toUpperCase() + ": " : "") + t.name;
      row.appendChild(pill);
    }
    if (named.length > 4) {
      const more = document.createElement("span");
      more.className = "bl-tag-pill";
      more.textContent = `+${named.length - 4}`;
      row.appendChild(more);
    }
  }

  function segDigitSVG() {
    return `
<svg viewBox="0 0 40 76" shape-rendering="geometricPrecision">
  <polygon class="seg seg-a" points="10,2 30,2 33,5 30,8 10,8 7,5"/>
  <polygon class="seg seg-b" points="33,6 36,9 36,32 33,35 30,32 30,9"/>
  <polygon class="seg seg-c" points="33,40 36,43 36,66 33,69 30,66 30,43"/>
  <polygon class="seg seg-d" points="10,68 30,68 33,71 30,74 10,74 7,71"/>
  <polygon class="seg seg-e" points="7,40 10,43 10,66 7,69 4,66 4,43"/>
  <polygon class="seg seg-f" points="7,6 10,9 10,32 7,35 4,32 4,9"/>
  <polygon class="seg seg-g" points="10,36 30,36 33,38.5 30,41 10,41 7,38.5"/>
</svg>`;
  }

  /* drag & drop (with multi-selection group move) ----------------------- */
  function makeDraggable(el, id) {
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest("input, button, .bl-dip, .bl-push, .bl-shape-handle")) return; // don't drag controls or handles
      if (BL.activeTool) return; // don't drag when in drawing tool mode
      if (e.button !== 0) return; // only left click

      // Multi-selection click modifier (Ctrl / Shift)
      if (e.ctrlKey || e.shiftKey) {
        el.classList.toggle("is-selected");
        return;
      }

      // If clicked element is not selected yet, select it and deselect others
      if (!el.classList.contains("is-selected")) {
        for (const s of document.querySelectorAll(".bl-comp.is-selected")) {
          if (s !== el) s.classList.remove("is-selected");
        }
        el.classList.add("is-selected");
      }

      // Group all currently selected elements
      const selectedEls = Array.from(document.querySelectorAll(".bl-comp.is-selected"));
      if (!selectedEls.includes(el)) selectedEls.push(el);

      const startPositions = selectedEls.map((item) => {
        item.classList.add("is-drag");
        return {
          el: item,
          id: item.dataset.id,
          ox: item.offsetLeft,
          oy: item.offsetTop
        };
      });

      activeDrag = {
        sx: e.clientX,
        sy: e.clientY,
        dragSnap: getBoardSnapshot(),
        el,
        startPositions
      };

      e.preventDefault();
    });
  }

  function placeAt(type, pos) {
    pushUndo();
    const c = makeComp(type, pos.x, pos.y);
    BL.comps.push(c);
    renderCanvas();
    saveBench();
    return c;
  }

  function placeSilent(type, x, y) {
    BL.comps.push(makeComp(type, x, y));
  }

  function wireCanvasDrop() {
    const canvas = $("blCanvas");
    canvas.addEventListener("dragover", (e) => {
      if ([...e.dataTransfer.types].includes("text/bl-comp")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    canvas.addEventListener("drop", (e) => {
      const type = e.dataTransfer.getData("text/bl-comp");
      if (!type) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const z = BL.zoom || 1;
      const x = Math.max(0, Math.round((e.clientX - r.left - BL.panX) / z - 40));
      const y = Math.max(0, Math.round((e.clientY - r.top - BL.panY) / z - 16));
      placeAt(type, { x, y });
    });
  }

  /* ------------------------------------------------------------------ *
   *  wires (SVG) — connect terminals with equal names
   * ------------------------------------------------------------------ */

  function drawWires() {
    // Curved SVG connection lines removed in Proteus net-label mode
  }

  /* ------------------------------------------------------------------ *
   *  simulation
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   *  simulation & local real-time playback engine (Solution A)
   * ------------------------------------------------------------------ */

  BL.combCache = {};
  BL.playback = null;
  BL.cachedFrames = null;

  function stopPlayback() {
    if (BL.playback) {
      BL.playback.running = false;
      if (BL.playback.timerId) {
        clearTimeout(BL.playback.timerId);
        BL.playback.timerId = null;
      }
      if (BL.playback.animId) {
        cancelAnimationFrame(BL.playback.animId);
        BL.playback.animId = null;
      }
      // Note: requestAnimationFrame is intentionally replaced with self-correcting setTimeout
      // for clock frequencies <= 60Hz to reduce CPU/GPU wakeups from 144Hz-240Hz down to exact target Hz.
      BL.playback = null;
    }
  }

  function startPlayback(frames, freqHz, period, periodStart, clockPort, inputs) {
    stopPlayback();
    if (!frames || !frames.length) return;

    BL.clockPort = clockPort;
    BL.lastInputs = inputs;

    const intervalMs = 1000 / Math.max(0.05, freqHz);
    BL.playback = {
      frames: frames,
      period: period || 0,
      periodStart: periodStart || 0,
      freqHz: freqHz,
      intervalMs: intervalMs,
      startTime: performance.now(),
      baseCycle: BL.clockCycles || 0,
      currentStep: 0,
      lastRenderedIndex: -1,
      timerId: null,
      animId: null,
      running: true,
    };
    const pb = BL.playback;

    function step() {
      if (!BL.live || !BL.playback || !BL.playback.running || !BL.open) {
        stopPlayback();
        return;
      }
      const now = performance.now();
      const elapsed = now - pb.startTime;
      const targetStep = Math.max(0, Math.floor(elapsed / pb.intervalMs));

      // Catch-up clamp: cap step advance to at most +2 to prevent burst updates
      // when waking from throttled background tab
      if (targetStep > pb.currentStep + 2) {
        pb.currentStep = targetStep;
        pb.startTime = now - (targetStep * pb.intervalMs);
      } else {
        pb.currentStep = targetStep;
      }

      const rawCycle = pb.currentStep;
      let frameIdx = rawCycle;
      if (pb.period > 0 && frameIdx >= pb.periodStart) {
        // Seamless periodic loop
        frameIdx = pb.periodStart + ((frameIdx - pb.periodStart) % pb.period);
      } else if (frameIdx >= pb.frames.length) {
        // Aperiodic designs: wrap-around over simulated batch horizon
        frameIdx = frameIdx % pb.frames.length;
      }

      if (frameIdx !== pb.lastRenderedIndex) {
        pb.lastRenderedIndex = frameIdx;
        const fr = pb.frames[frameIdx];
        if (fr && fr.outputs) {
          BL.lastOutputs = fr.outputs;
          applyOutputs(fr.outputs, BL.lastInputs || {}, BL.clockPort);
          const currentCycle = (pb.baseCycle + rawCycle) % 65536;
          BL.clockCycles = currentCycle;
          if (now - (pb.lastInfoTime || 0) >= 100) {
            pb.lastInfoTime = now;
            const freqStr = pb.freqHz >= 1000 ? (pb.freqHz / 1000).toFixed(1) + " kHz" : pb.freqHz.toFixed(1) + " Hz";
            $("blSimInfo").textContent =
              `${Object.keys(fr.outputs).length} output port(s) · clk ${BL.clockPort} [cycle ${currentCycle}] · ${freqStr} · real-time`;
          }
        }
      }

      // Self-correcting schedule: compute target time for next tick to cancel any timer jitter
      const nextTarget = pb.startTime + (pb.currentStep + 1) * pb.intervalMs;
      const delay = Math.max(1, Math.round(nextTarget - performance.now()));
      pb.timerId = setTimeout(step, delay);
    }

    pb.timerId = setTimeout(step, 0);
  }

  async function runBatchAndPlay() {
    if (BL.busy) {
      BL.pendingLive = true;
      return;
    }
    syncOpenFiles();
    const p = getProject();
    if (!p || !p.files || !p.files.length) return;
    if (!BL.ports.length) {
      refreshEntity();
      if (!BL.ports.length) return;
    }

    const { inputs, clockPort, halfPeriodNs } = collectNets();
    if (!clockPort) {
      runBoard(true);
      return;
    }

    const clkComp = BL.comps.find((c) => c.type === "clk");
    let freqHz = 2;
    if (clkComp) {
      const f = parseFloat(clkComp.freq) || 2;
      const u = clkComp.unit || "Hz";
      if (u === "Hz") freqHz = Math.max(0.05, f);
      else if (u === "kHz") freqHz = Math.min(30, f * 1000);
      else if (u === "MHz") freqHz = Math.min(30, f * 1000000);
    }

    let halfPeriod = halfPeriodNs || 10;
    if (halfPeriod > 100000) halfPeriod = 25;

    // Duplicate batch suppression: if inputs and clock haven't changed, reuse cached simulation
    const inputSig = JSON.stringify({ inputs, clockPort, halfPeriod, entity: BL.entity });
    if (inputSig === BL.lastBatchInputSig && BL.cachedFrames && BL.cachedFrames.length) {
      if (BL.live) {
        startPlayback(BL.cachedFrames, freqHz, BL.lastPeriod, BL.lastPeriodStart, clockPort, inputs);
      }
      return;
    }

    BL.busy = true;
    setDot("run", "simulating batch…");

    const generics = {};
    for (const g of BL.generics) generics[g.name] = g.default;

    // Adaptive batch sizing: 128 cycles for <= 10Hz, 256 for higher
    const adaptiveCycles = freqHz <= 10 ? 128 : 256;

    const payload = {
      files: p.files.map((f) => ({
        filename: f.filename, entity: f.entity, type: f.type,
        architecture: f.architecture, code: f.code, ports: f.ports || [],
      })),
      entity: BL.entity || p.top_entity || "",
      board_tb: {
        inputs: { ...inputs, generics },
        clock_port: clockPort,
        clock_half_period_ns: halfPeriod,
        batch_cycles: adaptiveCycles,
        trim_periodic: true,
      },
      standard: p.standard || "08",
      dependencies: p.dependencies || [],
    };

    try {
      const resp = await fetch("/api/board/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await resp.json();
      if (!resp.ok || !d.ok) {
        renderBoardLog(d.log || []);
        setDot("bad", d.message || "batch simulation failed");
        $("blSimInfo").textContent = "errors — see board log";
        blLogLine("err", d.message || `HTTP ${resp.status}`);
        return;
      }
      BL.lastBatchInputSig = inputSig;
      BL.lastPeriod = d.period;
      BL.lastPeriodStart = d.period_start;
      BL.cachedFrames = d.frames || [];
      BL.lastOutputs = d.outputs || {};
      setDot("ok", "simulation ok");

      const fpga = $("blCanvas").querySelector(".bl-comp.is-fpga");
      if (fpga) fpga.classList.add("is-live");

      if (BL.live) {
        startPlayback(BL.cachedFrames, freqHz, d.period, d.period_start, clockPort, inputs);
      } else if (BL.cachedFrames.length > 0) {
        applyOutputs(BL.cachedFrames[0].outputs, inputs, clockPort);
      }
    } catch (err) {
      setDot("bad", "server unreachable");
      blLogLine("err", "Network error: " + err.message);
    } finally {
      BL.busy = false;
      if (BL.pendingLive) {
        BL.pendingLive = false;
        setTimeout(() => maybeLive(true), 15);
      }
    }
  }

  async function runBoard(silent = false) {
    if (BL.busy) {
      if (BL.live) BL.pendingLive = true;
      return;
    }
    syncOpenFiles();
    const p = getProject();
    if (!p || !p.files || !p.files.length) {
      blLogLine("err", "No project files to put on the board.");
      return;
    }
    if (!BL.ports.length) {
      refreshEntity();
      if (!BL.ports.length) {
        blLogLine("err", "No entity found — open a design file first.");
        return;
      }
    }

    const { inputs, clockPort, halfPeriodNs } = collectNets();

    // Purely combinational circuit cache lookup
    if (!clockPort) {
      const inHash = JSON.stringify(inputs);
      if (BL.combCache[inHash]) {
        BL.lastOutputs = BL.combCache[inHash];
        applyOutputs(BL.lastOutputs, inputs, null);
        setDot("ok", "simulation ok (cached)");
        $("blSimInfo").textContent = `${Object.keys(BL.lastOutputs).length} output port(s) · combinational (instant)`;
        return;
      }
    }

    // If Live is active and clock port is present, route to batch playback engine
    if (BL.live && clockPort) {
      runBatchAndPlay();
      return;
    }

    BL.busy = true;
    if (!silent) {
      $("blBtnRun").classList.add("is-busy");
      $("blBtnRun").disabled = true;
    }
    setDot("run", "simulating…");

    let halfPeriod = halfPeriodNs || 10;
    if (halfPeriod > 100000) halfPeriod = 25;
    const periodNs = halfPeriod * 2;

    let isResetActive = false;
    for (const [k, v] of Object.entries(inputs)) {
      if (/clear|rst|reset|clr/i.test(k) && (v === "1" || String(v).endsWith("1"))) {
        isResetActive = true;
        break;
      }
    }

    if (isResetActive) {
      BL.clockCycles = 0;
    } else if (clockPort) {
      BL.clockCycles = ((BL.clockCycles || 0) + 1) % 65536;
      if (BL.clockCycles === 0) BL.clockCycles = 1;
    } else {
      BL.clockCycles = null;
    }

    // Step mode local frame advance if cached batch is available
    if (clockPort && BL.cachedFrames && BL.cachedFrames[BL.clockCycles]) {
      const fr = BL.cachedFrames[BL.clockCycles];
      BL.lastOutputs = fr.outputs;
      applyOutputs(fr.outputs, inputs, clockPort);
      setDot("ok", "simulation ok (step)");
      $("blSimInfo").textContent = `${Object.keys(fr.outputs).length} output port(s) · clk ${clockPort} [cycle ${BL.clockCycles}] (cached)`;
      BL.busy = false;
      if (!silent) {
        $("blBtnRun").classList.remove("is-busy");
        $("blBtnRun").disabled = false;
      }
      return;
    }

    const stopNs = clockPort
      ? Math.min(1000000, Math.max(30, Math.ceil(BL.clockCycles * periodNs - (halfPeriod * 0.8))))
      : Math.min(1000000, Math.max(200, Math.ceil(periodNs * 2)));
    const stopTimeStr = stopNs >= 1000000 ? "1 ms"
      : (stopNs >= 1000 ? (stopNs / 1000).toFixed(2) + " us" : stopNs + " ns");

    const generics = {};
    for (const g of BL.generics) generics[g.name] = g.default;

    const payload = {
      files: p.files.map((f) => ({
        filename: f.filename, entity: f.entity, type: f.type,
        architecture: f.architecture, code: f.code, ports: f.ports || [],
      })),
      entity: BL.entity || p.top_entity || "",
      board_tb: {
        inputs: { ...inputs, generics },
        clock_port: clockPort || null,
        clock_half_period_ns: halfPeriod,
        clock_cycles: clockPort ? BL.clockCycles : null,
      },
      stop_time: stopTimeStr,
      standard: p.standard || "08",
      dependencies: p.dependencies || [],
    };

    try {
      const resp = await fetch("/api/board/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await resp.json();
      if (!silent || (!resp.ok || !d.ok)) {
        renderBoardLog(d.log || []);
      }
      if (!resp.ok || !d.ok) {
        setDot("bad", d.message || "simulation failed");
        $("blSimInfo").textContent = "errors — see board log";
        blLogLine("err", d.message || `HTTP ${resp.status}`);
        return;
      }
      BL.lastOutputs = d.outputs || {};
      if (!clockPort) {
        const inHash = JSON.stringify(inputs);
        BL.combCache[inHash] = BL.lastOutputs;
      }
      applyOutputs(BL.lastOutputs, inputs, clockPort);
      setDot("ok", "simulation ok");
      $("blSimInfo").textContent =
        `${Object.keys(BL.lastOutputs).length} output port(s)` +
        (clockPort ? ` · clk ${clockPort} [cycle ${BL.clockCycles || 0}]` : ` · sim time ${d.stop_time || stopTimeStr}`);
      const fpga = $("blCanvas").querySelector(".bl-comp.is-fpga");
      if (fpga) fpga.classList.add("is-live");
    } catch (err) {
      setDot("bad", "server unreachable");
      blLogLine("err", "Network error: " + err.message);
    } finally {
      BL.busy = false;
      if (!silent) {
        $("blBtnRun").classList.remove("is-busy");
        $("blBtnRun").disabled = false;
      }
      if (BL.pendingLive) {
        BL.pendingLive = false;
        setTimeout(() => maybeLive(), 15);
      }
    }
  }

  let liveDebounceTimer = null;

  function startLiveLoop() {
    stopLiveLoop();
    if (!BL.live) return;
    const { clockPort } = collectNets();
    if (clockPort) {
      runBatchAndPlay();
    } else {
      runBoard(true);
    }
  }

  function stopLiveLoop() {
    if (liveDebounceTimer) {
      clearTimeout(liveDebounceTimer);
      liveDebounceTimer = null;
    }
    stopPlayback();
    if (BL.liveTimer) {
      clearInterval(BL.liveTimer);
      BL.liveTimer = null;
    }
  }

  function maybeLive(immediate = false) {
    if (!BL.live) return;
    if (liveDebounceTimer) {
      clearTimeout(liveDebounceTimer);
      liveDebounceTimer = null;
    }
    if (immediate) {
      execMaybeLive();
    } else {
      // Trailing debounce (180ms) to coalesce rapid switch flipping and button presses
      liveDebounceTimer = setTimeout(execMaybeLive, 180);
    }
  }

  function execMaybeLive() {
    liveDebounceTimer = null;
    if (!BL.live) return;
    stopPlayback();
    const { inputs, clockPort } = collectNets();
    let isResetActive = false;
    for (const [k, v] of Object.entries(inputs)) {
      if (/clear|rst|reset|clr/i.test(k) && (v === "1" || String(v).endsWith("1"))) {
        isResetActive = true;
        break;
      }
    }
    if (isResetActive) {
      BL.clockCycles = 0;
    }
    if (clockPort) {
      runBatchAndPlay();
    } else {
      runBoard(true);
    }
  }

  function applyOutputs(outputs, inputs, clockPort) {
    const netValues = {};

    // Map each FPGA output port and its individual bits into netValues
    for (const p of BL.ports) {
      if (p.dir === "in") continue;
      const o = outputs[p.name];
      if (!o) continue;

      if (!p.vector) {
        const net = (BL.pinNames?.[p.name] || p.name || "").trim().toLowerCase();
        if (net) netValues[net] = (o.value === 1);
      } else {
        const w = portWidth(p);
        const msb = p.msb ?? (w - 1);
        const lsb = p.lsb ?? 0;
        const isDownto = msb >= lsb;
        const bitIndices = [];
        if (isDownto) { for (let i = msb; i >= lsb; i--) bitIndices.push(i); }
        else { for (let i = msb; i <= lsb; i++) bitIndices.push(i); }

        const busNet = (BL.pinNames?.[p.name] || "").trim().toLowerCase();
        if (busNet) netValues[busNet] = o;

        const bitsStr = o.bits || "";
        for (let b = 0; b < bitIndices.length; b++) {
          const bitIdx = bitIndices[b];
          const bitVal = bitsStr[b] === "1";
          const bitNet = (BL.pinNames?.[`${p.name}(${bitIdx})`] || "").trim().toLowerCase();
          if (bitNet) netValues[bitNet] = bitVal;
        }
      }
    }

    // Include switch / button states into netValues
    for (const c of BL.comps) {
      if (c.type.startsWith("dip")) {
        const comTerm = c.terms.find((x) => x.key === "com");
        const comNet = netName(comTerm || {});
        const isGndCom = (comNet === "gnd");
        for (let i = 0; i < c.width; i++) {
          const t = c.terms.find((x) => x.key === "b" + i);
          const net = netName(t || {});
          if (net && !(net in netValues)) {
            netValues[net] = isGndCom ? !c.on[i] : !!c.on[i];
          }
        }
      } else if (c.type === "push") {
        const comTerm = c.terms.find((x) => x.key === "com");
        const comNet = netName(comTerm || {});
        const isGndCom = (comNet === "gnd");
        const t = c.terms.find((x) => x.key === "a");
        const net = netName(t || {});
        if (net && !(net in netValues)) {
          netValues[net] = isGndCom ? !c.on[0] : !!c.on[0];
        }
      }
    }

    const isNetHigh = (net) => {
      if (!net) return false;
      if (net === "vcc") return true;
      if (net === "gnd") return false;
      if (net in netValues) {
        const v = netValues[net];
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v === 1;
        if (v && typeof v === "object" && "value" in v) return v.value === 1 || ((v.value & 1) === 1);
      }
      return false;
    };

    // Update any BCD-to-7Segment decoders and publish their segment outputs into netValues
    for (const c of BL.comps) {
      if (c.type === "bcd7seg") {
        let val = 0;
        for (let b = 0; b < 4; b++) {
          const t = c.terms.find((x) => x.key === "d" + b);
          const net = netName(t || {});
          if (net && isNetHigh(net)) val |= (1 << b);
        }
        c.val = val;
        const ch = HEXCH[val & 0xF];
        const pat = SEG_PATTERNS[ch] || "0000000";
        const segKeys = ["a", "b", "c", "d", "e", "f", "g"];
        for (let i = 0; i < 7; i++) {
          const t = c.terms.find((x) => x.key === segKeys[i]);
          const net = netName(t || {});
          if (net) netValues[net] = (pat[i] === "1");
        }
        const el = $("blCanvas")?.querySelector(`[data-id="${c.id}"]`);
        if (el) {
          const screen = el.querySelector(".bl-decoder-screen");
          if (screen) screen.textContent = ch;
        }
      }
    }

    // Update board components
    for (const c of BL.comps) {
      const el = $("blCanvas")?.querySelector(`[data-id="${c.id}"]`);
      if (!el) continue;

      if (c.type === "led" || c.type === "ledR") {
        const tA = c.terms.find((x) => x.key === "a");
        const on = isNetHigh(netName(tA || {}));
        if (c.lit !== on) {
          c.lit = on;
          el.querySelector(".bl-led")?.classList.toggle("is-on", on);
        }
      } else if (c.type === "seg") {
        const segKeys = ["a", "b", "c", "d", "e", "f", "g"];
        let hasAnyIndividual = false;

        for (const k of segKeys) {
          const t = c.terms.find((x) => x.key === k);
          const net = netName(t || {});
          if (net) {
            hasAnyIndividual = true;
            const on = isNetHigh(net);
            el.querySelector(`.seg-${k}`)?.classList.toggle("on", on);
          }
        }

        const tDp = c.terms.find((x) => x.key === "dp");
        const netDp = netName(tDp || {});
        if (netDp) {
          hasAnyIndividual = true;
          const dpOn = isNetHigh(netDp);
          el.querySelector(".bl-seg-dp")?.classList.toggle("on", dpOn);
        }

        // Bus fallback if whole bus wired
        const tBus = c.terms.find((x) => x.key === "bus");
        const busNet = netName(tBus || {});
        if (busNet && netValues[busNet] && typeof netValues[busNet] === "object") {
          const o = netValues[busNet];
          let pat = "0000000";
          if (o.width === 7) {
            pat = o.bits || "0000000";
          } else if (o.width === 8) {
            pat = (o.bits || "").slice(0, 7);
            const dpOn = (o.bits || "")[7] === "1";
            el.querySelector(".bl-seg-dp")?.classList.toggle("on", dpOn);
          } else {
            const ch = HEXCH[(o.value ?? 0) & 0xF];
            pat = SEG_PATTERNS[ch] || "0000000";
          }
          el.querySelectorAll(".seg").forEach((s, idx) => s.classList.toggle("on", pat[idx] === "1"));
        } else if (!hasAnyIndividual) {
          el.querySelectorAll(".seg").forEach((s) => s.classList.remove("on"));
          el.querySelector(".bl-seg-dp")?.classList.remove("on");
        }
      } else if (c.type === "hex") {
        const t = c.terms.find((x) => x.key === "bus");
        const net = netName(t || {});
        const valEl = el.querySelector(".bl-hex-val");
        const bitsEl = el.querySelector(".bl-hex-bits");
        if (net && netValues[net] && typeof netValues[net] === "object") {
          const o = netValues[net];
          const hexw = Math.max(1, Math.ceil((o.width || 1) / 4));
          if (valEl) valEl.textContent = "0x" + (o.value ?? 0).toString(16).toUpperCase().padStart(hexw, "0").slice(-Math.max(hexw, 1));
          if (bitsEl) bitsEl.textContent = o.bits || "";
        } else if (net === "vcc") {
          if (valEl) valEl.textContent = "0x1";
          if (bitsEl) bitsEl.textContent = "1";
        } else {
          if (valEl) valEl.textContent = "—";
          if (bitsEl) bitsEl.textContent = "";
        }
      } else if (c.type === "clk") {
      }
    }

    // Update FPGA pin indicators
    const fpgaEl = $("blCanvas")?.querySelector(".bl-comp.is-fpga");
    if (fpgaEl) {
      for (const pin of fpgaEl.querySelectorAll(".bl-fpga-pin")) {
        const port = pin.dataset.port;
        const bit = pin.dataset.bit;
        const dir = pin.dataset.dir;
        let hi = false;

        if (dir === "in") {
          if (port === clockPort) {
            hi = true;
          } else if (inputs[port]) {
            if (bit !== undefined) {
              const pdef = BL.ports.find((x) => x.name === port);
              if (pdef && pdef.vector) {
                const w = portWidth(pdef);
                const msb = pdef.msb ?? (w - 1);
                const lsb = pdef.lsb ?? 0;
                const isDownto = msb >= lsb;
                const offset = isDownto ? (msb - parseInt(bit, 10)) : (parseInt(bit, 10) - msb);
                hi = (inputs[port] || "")[offset] === "1";
              }
            } else {
              hi = (inputs[port] || "")[0] === "1";
            }
          }
        } else if (outputs[port]) {
          const o = outputs[port];
          if (bit !== undefined) {
            const pdef = BL.ports.find((x) => x.name === port);
            if (pdef && pdef.vector) {
              const w = portWidth(pdef);
              const msb = pdef.msb ?? (w - 1);
              const lsb = pdef.lsb ?? 0;
              const isDownto = msb >= lsb;
              const offset = isDownto ? (msb - parseInt(bit, 10)) : (parseInt(bit, 10) - msb);
              hi = (o.bits || "")[offset] === "1";
            }
          } else {
            hi = o.value === 1 || (o.width > 1 && (o.value & 1) === 1);
          }
        }
        if (pin._lastHi !== hi) {
          pin._lastHi = hi;
          pin.classList.toggle("is-hi", hi);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Component Schematics & Properties Modal (Proteus Style)
   * ------------------------------------------------------------------ */

  let activePropsTarget = null;

  function getSegSchematicSVG(activePin) {
    const isAct = (k) => activePin === k ? "active" : "";
    return `<svg viewBox="0 0 240 240" width="220" height="220">
      <!-- Package frame -->
      <rect x="42" y="32" width="156" height="176" rx="8" fill="#0d141e" stroke="#2a3c54" stroke-width="2"/>
      <text x="120" y="47" fill="#5c6b7d" font-size="8.5" font-family="monospace" text-anchor="middle" letter-spacing="1">7-SEG DISPLAY</text>

      <!-- Center Display Screen -->
      <rect x="68" y="54" width="104" height="132" rx="6" fill="#140f0f" stroke="#332422" stroke-width="1.8"/>

      <!-- 7 Segments inside Display Screen (clickable) -->
      <!-- a -->
      <polygon class="sch-pin ${isAct('a')}" data-pin="a" points="84,62 136,62 143,68 136,74 84,74 77,68"
               fill="${activePin === 'a' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'a' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="110" y="71" fill="${activePin === 'a' ? '#000' : '#d5dfe9'}" font-size="8.5" font-family="monospace" text-anchor="middle" font-weight="bold">A</text>

      <!-- b -->
      <polygon class="sch-pin ${isAct('b')}" data-pin="b" points="144,70 150,77 150,111 144,117 138,111 138,77"
               fill="${activePin === 'b' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'b' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="144" y="96" fill="${activePin === 'b' ? '#000' : '#d5dfe9'}" font-size="8.5" font-family="monospace" text-anchor="middle" font-weight="bold">B</text>

      <!-- c -->
      <polygon class="sch-pin ${isAct('c')}" data-pin="c" points="144,123 150,129 150,163 144,169 138,163 138,129"
               fill="${activePin === 'c' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'c' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="144" y="148" fill="${activePin === 'c' ? '#000' : '#d5dfe9'}" font-size="8.5" font-family="monospace" text-anchor="middle" font-weight="bold">C</text>

      <!-- d -->
      <polygon class="sch-pin ${isAct('d')}" data-pin="d" points="84,165 136,165 143,171 136,177 84,177 77,171"
               fill="${activePin === 'd' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'd' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="110" y="174" fill="${activePin === 'd' ? '#000' : '#d5dfe9'}" font-size="8.5" font-family="monospace" text-anchor="middle" font-weight="bold">D</text>

      <!-- e -->
      <polygon class="sch-pin ${isAct('e')}" data-pin="e" points="76,123 82,129 82,163 76,169 70,163 70,129"
               fill="${activePin === 'e' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'e' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="76" y="148" fill="${activePin === 'e' ? '#000' : '#d5dfe9'}" font-size="8.5" font-family="monospace" text-anchor="middle" font-weight="bold">E</text>

      <!-- f -->
      <polygon class="sch-pin ${isAct('f')}" data-pin="f" points="76,70 82,77 82,111 76,117 70,111 70,77"
               fill="${activePin === 'f' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'f' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="76" y="96" fill="${activePin === 'f' ? '#000' : '#d5dfe9'}" font-size="8.5" font-family="monospace" text-anchor="middle" font-weight="bold">F</text>

      <!-- g -->
      <polygon class="sch-pin ${isAct('g')}" data-pin="g" points="84,114 136,114 143,120 136,126 84,126 77,120"
               fill="${activePin === 'g' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'g' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="110" y="123" fill="${activePin === 'g' ? '#000' : '#d5dfe9'}" font-size="8.5" font-family="monospace" text-anchor="middle" font-weight="bold">G</text>

      <!-- dp -->
      <circle class="sch-pin ${isAct('dp')}" data-pin="dp" cx="158" cy="172" r="5.5"
              fill="${activePin === 'dp' ? '#2ee66b' : '#ff5038'}" opacity="${activePin === 'dp' ? '1' : '0.45'}" stroke="#ff5038" stroke-width="1"/>
      <text x="158" y="163" fill="#8b99ab" font-size="7.5" font-family="monospace" text-anchor="middle">DP</text>

      <!-- Top Terminal Pins (G, F, A, B) -->
      ${[
        { key: "g", label: "G", x: 62 },
        { key: "f", label: "F", x: 97 },
        { key: "a", label: "A", x: 143 },
        { key: "b", label: "B", x: 178 },
      ].map(p => `
        <line x1="${p.x}" y1="32" x2="${p.x}" y2="12" stroke="#5c6b7d" stroke-width="2"/>
        <circle class="sch-pin ${isAct(p.key)}" data-pin="${p.key}" cx="${p.x}" cy="12" r="5"
                fill="${activePin === p.key ? '#2ee66b' : '#5fd3f0'}" stroke="#2a3c54" stroke-width="1.5"/>
        <text class="sch-pin ${isAct(p.key)}" data-pin="${p.key}" x="${p.x}" y="7" fill="${activePin === p.key ? '#2ee66b' : '#5fd3f0'}"
              font-size="9.5" font-family="monospace" font-weight="bold" text-anchor="middle">${p.label}</text>
      `).join("")}

      <!-- Bottom Terminal Pins (E, D, C, DP) -->
      ${[
        { key: "e", label: "E", x: 62 },
        { key: "d", label: "D", x: 97 },
        { key: "c", label: "C", x: 143 },
        { key: "dp", label: "DP", x: 178 },
      ].map(p => `
        <line x1="${p.x}" y1="208" x2="${p.x}" y2="228" stroke="#5c6b7d" stroke-width="2"/>
        <circle class="sch-pin ${isAct(p.key)}" data-pin="${p.key}" cx="${p.x}" cy="228" r="5"
                fill="${activePin === p.key ? '#2ee66b' : (p.key === 'dp' ? '#ff5038' : '#5fd3f0')}" stroke="#2a3c54" stroke-width="1.5"/>
        <text class="sch-pin ${isAct(p.key)}" data-pin="${p.key}" x="${p.x}" y="238" fill="${activePin === p.key ? '#2ee66b' : (p.key === 'dp' ? '#ff5038' : '#5fd3f0')}"
              font-size="9.5" font-family="monospace" font-weight="bold" text-anchor="middle">${p.label}</text>
      `).join("")}
    </svg>`;
  }

  function getDipSchematicSVG(activePin, width) {
    const w = width || 8;
    const pins = [];
    const spacing = 180 / (w + 1);
    for (let i = 0; i < w; i++) {
      const x = 30 + (i + 1) * spacing;
      pins.push(`
        <line x1="${x}" y1="20" x2="${x}" y2="50" stroke="#5c6b7d" stroke-width="2"/>
        <circle class="sch-pin ${activePin==='b'+i?'active':''}" data-pin="b${i}" cx="${x}" cy="20" r="4" fill="#5fd3f0"/>
        <text x="${x}" y="12" fill="#5fd3f0" font-size="9" font-family="monospace" text-anchor="middle">${i}</text>
        <rect x="${x - 5}" y="65" width="10" height="30" rx="2" fill="#1a2332" stroke="#2b3b52"/>
        <rect x="${x - 4}" y="70" width="8" height="12" rx="1.5" fill="#46d96c"/>
        <line x1="${x}" y1="110" x2="${x}" y2="140" stroke="#5c6b7d" stroke-width="2"/>
      `);
    }
    return `<svg viewBox="0 0 240 180" width="230" height="170">
      <rect x="25" y="48" width="190" height="64" rx="6" fill="#0d131c" stroke="#2a3c54" stroke-width="2"/>
      ${pins.join("")}
      <line x1="30" y1="140" x2="210" y2="140" stroke="#8b99ab" stroke-width="3"/>
      <circle class="sch-pin ${activePin==='com'?'active':''}" data-pin="com" cx="120" cy="160" r="5" fill="#c3ccd8"/>
      <line x1="120" y1="140" x2="120" y2="160" stroke="#8b99ab" stroke-width="2"/>
      <text x="120" y="174" fill="#c3ccd8" font-size="10" font-family="monospace" font-weight="bold" text-anchor="middle">COM (Common)</text>
    </svg>`;
  }

  function getDecoderSchematicSVG(activePin) {
    const inPins = ["d3", "d2", "d1", "d0"];
    const outPins = ["a", "b", "c", "d", "e", "f", "g"];
    return `<svg viewBox="0 0 240 180" width="230" height="170">
      <rect x="50" y="18" width="140" height="144" rx="8" fill="#0d141e" stroke="#2a3c54" stroke-width="2"/>
      <text x="120" y="82" fill="#5fd3f0" font-size="12" font-family="monospace" font-weight="bold" text-anchor="middle">7447 / 7448</text>
      <text x="120" y="100" fill="#8b99ab" font-size="8.5" font-family="monospace" text-anchor="middle">BCD to 7-SEG</text>
      <!-- Inputs (left) -->
      ${inPins.map((p, i) => {
        const y = 38 + i * 30;
        const act = activePin === p ? "active" : "";
        return `
          <line x1="15" y1="${y}" x2="50" y2="${y}" stroke="#5c6b7d" stroke-width="2"/>
          <circle class="sch-pin ${act}" data-pin="${p}" cx="15" cy="${y}" r="5" fill="#5fd3f0"/>
          <text x="24" y="${y - 6}" fill="#5fd3f0" font-size="8.5" font-family="monospace">${p.toUpperCase()}</text>
        `;
      }).join("")}
      <!-- Outputs (right) -->
      ${outPins.map((p, i) => {
        const y = 28 + i * 19;
        const act = activePin === p ? "active" : "";
        return `
          <line x1="190" y1="${y}" x2="225" y2="${y}" stroke="#5c6b7d" stroke-width="2"/>
          <circle class="sch-pin ${act}" data-pin="${p}" cx="225" cy="${y}" r="5" fill="#2ee66b"/>
          <text x="216" y="${y - 5}" fill="#2ee66b" font-size="8.5" font-family="monospace" text-anchor="end">${p.toUpperCase()}</text>
        `;
      }).join("")}
    </svg>`;
  }

  function getLedSchematicSVG(activePin, color) {
    const col = color === "red" ? "#ff4d4d" : "#2ee66b";
    return `<svg viewBox="0 0 240 160" width="230" height="150">
      <!-- Outer enclosure circle -->
      <circle cx="120" cy="80" r="46" fill="#0d141e" stroke="#1f2f42" stroke-width="2"/>
      <!-- Anode Lead (left) -->
      <line x1="20" y1="80" x2="95" y2="80" stroke="#5c6b7d" stroke-width="3"/>
      <circle class="sch-pin ${activePin==='a'?'active':''}" data-pin="a" cx="20" cy="80" r="6" fill="#5fd3f0" stroke="#fff" stroke-width="1.8"/>
      <text x="20" y="62" fill="#5fd3f0" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">A (Anode)</text>
      <!-- Cathode Lead (right) -->
      <line x1="145" y1="80" x2="220" y2="80" stroke="#5c6b7d" stroke-width="3"/>
      <circle class="sch-pin ${activePin==='k'?'active':''}" data-pin="k" cx="220" cy="80" r="6" fill="#ff6b6b" stroke="#fff" stroke-width="1.8"/>
      <text x="220" y="62" fill="#ff6b6b" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">K (Cathode)</text>
      <!-- Diode Triangle -->
      <polygon points="95,52 145,80 95,108" fill="${col}" opacity="0.85" stroke="${col}" stroke-width="2.5"/>
      <!-- Cathode Bar -->
      <line x1="145" y1="46" x2="145" y2="114" stroke="${col}" stroke-width="4" stroke-linecap="round"/>
      <!-- Light Emission Rays (Arrows) -->
      <g stroke="${col}" stroke-width="2.5" stroke-linecap="round">
        <line x1="125" y1="50" x2="152" y2="23"/>
        <polygon points="152,23 140,26 149,35" fill="${col}"/>
        <line x1="140" y1="62" x2="167" y2="35"/>
        <polygon points="167,35 155,38 164,47" fill="${col}"/>
      </g>
    </svg>`;
  }

  function getClkSchematicSVG(activePin, freq, unit) {
    return `<svg viewBox="0 0 240 150" width="220" height="140">
      <rect x="40" y="25" width="130" height="100" rx="8" fill="#0e1724" stroke="#25415f" stroke-width="2"/>
      <path d="M60,85 L80,85 L80,55 L105,55 L105,85 L130,85 L130,55 L145,55" stroke="#5fd3f0" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <text x="105" y="112" fill="#7fe3a8" font-size="12" font-family="monospace" font-weight="bold" text-anchor="middle">${esc(freq)} ${esc(unit)}</text>
      <line x1="170" y1="75" x2="220" y2="75" stroke="#5c6b7d" stroke-width="3"/>
      <circle class="sch-pin ${activePin==='out'?'active':''}" data-pin="out" cx="220" cy="75" r="5" fill="#5fd3f0" stroke="#fff" stroke-width="1.5"/>
      <text x="220" y="60" fill="#5fd3f0" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">OUT</text>
    </svg>`;
  }

  function getPushSchematicSVG(activePin) {
    return `<svg viewBox="0 0 240 150" width="220" height="140">
      <circle class="sch-pin ${activePin==='a'?'active':''}" data-pin="a" cx="40" cy="85" r="5" fill="#5fd3f0" stroke="#fff" stroke-width="1.5"/>
      <text x="40" y="68" fill="#5fd3f0" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">Pin A</text>
      <circle class="sch-pin ${activePin==='com'?'active':''}" data-pin="com" cx="200" cy="85" r="5" fill="#c3ccd8" stroke="#fff" stroke-width="1.5"/>
      <text x="200" y="68" fill="#c3ccd8" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">COM</text>
      <circle cx="80" cy="85" r="4" fill="#8b99ab"/>
      <line x1="45" y1="85" x2="76" y2="85" stroke="#5c6b7d" stroke-width="2.5"/>
      <circle cx="160" cy="85" r="4" fill="#8b99ab"/>
      <line x1="164" y1="85" x2="195" y2="85" stroke="#5c6b7d" stroke-width="2.5"/>
      <line x1="75" y1="70" x2="165" y2="70" stroke="#2ee66b" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="120" y1="70" x2="120" y2="40" stroke="#8b99ab" stroke-width="3"/>
      <rect x="100" y="32" width="40" height="8" rx="2" fill="#3a4b60"/>
    </svg>`;
  }

  function getFpgaSchematicSVG(activePin) {
    return `<svg viewBox="0 0 240 240" width="220" height="220">
      <rect x="45" y="35" width="150" height="170" rx="8" fill="#111822" stroke="#255168" stroke-width="2"/>
      <text x="120" y="90" fill="#5fd3f0" font-size="13" font-family="monospace" font-weight="bold" text-anchor="middle">FPGA</text>
      <text x="120" y="115" fill="#8b99ab" font-size="11" font-family="monospace" text-anchor="middle">${esc(BL.entity || "DUT")}</text>
      <text x="120" y="140" fill="#46d96c" font-size="9" font-family="monospace" text-anchor="middle">Proteus Nets</text>
      <path d="M45,110 A10,10 0 0,1 45,130" stroke="#255168" stroke-width="2" fill="none"/>
      ${[50, 70, 90, 110, 130, 150, 170, 190].map(y => `
        <line x1="20" y1="${y}" x2="45" y2="${y}" stroke="#5c6b7d" stroke-width="2"/>
        <circle cx="20" cy="${y}" r="3" fill="#5fd3f0"/>
      `).join("")}
      ${[50, 70, 90, 110, 130, 150, 170, 190].map(y => `
        <line x1="195" y1="${y}" x2="220" y2="${y}" stroke="#5c6b7d" stroke-width="2"/>
        <circle cx="220" cy="${y}" r="3" fill="#ff6b4a"/>
      `).join("")}
    </svg>`;
  }

  function openPropsModal(target) {
    activePropsTarget = target;
    const modal = $("blPropsModal");
    if (!modal) return;
    modal.classList.remove("hidden");

    const isFpga = target === "__fpga";
    const comp = isFpga ? null : target;
    const type = isFpga ? "fpga" : comp.type;

    $("blPropsTitle").textContent = isFpga
      ? `FPGA Device Pins (${esc(BL.entity || "DUT")})`
      : (type === "text" ? "Text Label Properties"
      : (type.startsWith("shape_") ? "Geometric Shape Properties"
      : `${esc(comp.label)} Properties`));

    $("blPropsSubtitle").textContent = isFpga
      ? "Assign Proteus net labels to FPGA entity ports & vector bit pins"
      : (type === "text" ? "Configure text content, font size, color and weight"
      : (type.startsWith("shape_") ? "Configure dimensions, line color, thickness and style"
      : "Assign net labels to component pins"));

    const isText = type === "text";
    const isShape = type.startsWith("shape_");
    const isDip = type.startsWith("dip");
    const isClk = type === "clk";

    // Toggle panels
    $("blPropsClockOptions")?.classList.toggle("hidden", !isClk);
    $("blPropsBusOptions")?.classList.toggle("hidden", !isDip);
    $("blPropsTextOptions")?.classList.toggle("hidden", !isText);
    $("blPropsShapeOptions")?.classList.toggle("hidden", !isShape);
    $("blPropsPinsList")?.classList.toggle("hidden", isText || isShape);
    $("blPropsPinsLabel")?.classList.toggle("hidden", isText || isShape);
    $("blPropsPinsDesc")?.classList.toggle("hidden", isText || isShape);

    if (isClk) {
      if ($("blPropClkFreq")) $("blPropClkFreq").value = comp.freq || 50;
      if ($("blPropClkUnit")) $("blPropClkUnit").value = comp.unit || "MHz";
    }

    if (isDip) {
      if ($("blPropBusNet")) $("blPropBusNet").value = comp.busNet || "";
    }

    if (isText) {
      if ($("blPropTextContent")) $("blPropTextContent").value = comp.text || "Text Label";
      if ($("blPropTextSize")) $("blPropTextSize").value = comp.fontSize || 14;
      if ($("blPropTextColor")) $("blPropTextColor").value = comp.color || "#d5dfe9";
      if ($("blPropTextBold")) $("blPropTextBold").checked = !!comp.bold;
    }

    if (isShape) {
      if ($("blPropShapeW")) $("blPropShapeW").value = comp.width || 120;
      if ($("blPropShapeH")) $("blPropShapeH").value = comp.height || 80;
      if ($("blPropShapeStroke")) $("blPropShapeStroke").value = comp.stroke || "#5fd3f0";
      if ($("blPropShapeStrokeW")) $("blPropShapeStrokeW").value = comp.strokeWidth || 2;
      if ($("blPropShapeDash")) $("blPropShapeDash").value = comp.dash || "solid";
      if ($("blPropShapeFillType")) $("blPropShapeFillType").value = comp.fill === "color" ? "color" : "none";
      if ($("blPropShapeFillColor")) {
        $("blPropShapeFillColor").value = comp.fillColor || "#121820";
        $("blPropShapeFillColor").style.display = comp.fill === "color" ? "inline-block" : "none";
      }
      // Line doesn't have height or fill
      const isLine = type === "shape_line";
      if ($("blPropShapeHLabel")) $("blPropShapeHLabel").style.display = isLine ? "none" : "flex";
      if ($("blPropShapeFillLabel")) $("blPropShapeFillLabel").style.display = isLine ? "none" : "flex";
    }

    renderSchematicPreview(type, comp, "");
    if (!isText && !isShape) {
      renderPropsPinsList(type, comp);
    }
  }

  function closePropsModal() {
    $("blPropsModal")?.classList.add("hidden");
    activePropsTarget = null;
  }

  function renderSchematicPreview(type, comp, activePin) {
    const box = $("blSchematicBox");
    if (!box) return;

    if (type === "seg") {
      box.innerHTML = getSegSchematicSVG(activePin);
    } else if (type.startsWith("dip")) {
      box.innerHTML = getDipSchematicSVG(activePin, comp ? comp.width : 8);
    } else if (type === "bcd7seg") {
      box.innerHTML = getDecoderSchematicSVG(activePin);
    } else if (type === "led" || type === "ledR") {
      box.innerHTML = getLedSchematicSVG(activePin, comp ? comp.color : "green");
    } else if (type === "clk") {
      box.innerHTML = getClkSchematicSVG(activePin, comp ? (comp.freq || 50) : 50, comp ? (comp.unit || "MHz") : "MHz");
    } else if (type === "push") {
      box.innerHTML = getPushSchematicSVG(activePin);
    } else if (type === "fpga") {
      box.innerHTML = getFpgaSchematicSVG(activePin);
    } else if (type === "text") {
      box.innerHTML = `<div style="padding:15px;text-align:center;font-size:${comp?.fontSize || 14}px;color:${comp?.color || '#d5dfe9'};font-weight:${comp?.bold ? 'bold' : 'normal'};background:#0b1016;border-radius:6px;border:1px dashed #2a3547;max-width:200px;margin:20px auto">${esc(comp?.text || "Text Label")}</div>`;
    } else if (type === "shape_line") {
      box.innerHTML = `<svg viewBox="0 0 220 80" width="220" height="80"><line x1="20" y1="40" x2="200" y2="40" stroke="${esc(comp?.stroke || '#5fd3f0')}" stroke-width="${Math.min(10, Math.max(2, comp?.strokeWidth || 2))}" stroke-dasharray="${comp?.dash === 'dashed' ? '8 5' : (comp?.dash === 'dotted' ? '3 3' : 'none')}" stroke-linecap="round"/></svg>`;
    } else if (type === "shape_rect") {
      const fillVal = comp?.fill === "color" ? (comp?.fillColor || "#121820") : "none";
      box.innerHTML = `<svg viewBox="0 0 220 130" width="220" height="130"><rect x="30" y="25" width="160" height="80" rx="4" fill="${esc(fillVal)}" stroke="${esc(comp?.stroke || '#5fd3f0')}" stroke-width="${Math.min(10, Math.max(2, comp?.strokeWidth || 2))}" stroke-dasharray="${comp?.dash === 'dashed' ? '8 5' : (comp?.dash === 'dotted' ? '3 3' : 'none')}"/></svg>`;
    } else if (type === "shape_circle") {
      const fillVal = comp?.fill === "color" ? (comp?.fillColor || "#121820") : "none";
      box.innerHTML = `<svg viewBox="0 0 220 130" width="220" height="130"><ellipse cx="110" cy="65" rx="70" ry="45" fill="${esc(fillVal)}" stroke="${esc(comp?.stroke || '#5fd3f0')}" stroke-width="${Math.min(10, Math.max(2, comp?.strokeWidth || 2))}" stroke-dasharray="${comp?.dash === 'dashed' ? '8 5' : (comp?.dash === 'dotted' ? '3 3' : 'none')}"/></svg>`;
    } else {
      box.innerHTML = `<div style="color:#5c6b7d;font-size:12px;font-family:monospace">${esc(type.toUpperCase())} SYMBOL</div>`;
    }

    box.querySelectorAll(".sch-pin").forEach((pEl) => {
      pEl.addEventListener("click", () => {
        const pinKey = pEl.dataset.pin;
        if (!pinKey) return;
        const row = $(`blPinRow_${pinKey}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "nearest" });
          const inp = row.querySelector("input");
          if (inp) inp.focus();
        }
      });
      pEl.addEventListener("mouseenter", () => {
        const pinKey = pEl.dataset.pin;
        if (pinKey) $(`blPinRow_${pinKey}`)?.classList.add("highlighted");
      });
      pEl.addEventListener("mouseleave", () => {
        const pinKey = pEl.dataset.pin;
        if (pinKey) $(`blPinRow_${pinKey}`)?.classList.remove("highlighted");
      });
    });
  }

  function renderPropsPinsList(type, comp) {
    const host = $("blPropsPinsList");
    if (!host) return;
    host.innerHTML = "";

    if (type === "fpga") {
      for (const p of BL.ports) {
        const isVec = !!p.vector;
        const dirBadge = `<span style="font-size:9.5px;padding:1px 4px;border-radius:3px;background:${p.dir==='in'?'#173024':'#321d1b'};color:${p.dir==='in'?'#46d96c':'#ff7b72'}">${p.dir.toUpperCase()}</span>`;

        if (!isVec) {
          const row = document.createElement("div");
          row.className = "bl-pin-row";
          row.id = `blPinRow_${p.name}`;
          const currentNet = BL.pinNames?.[p.name] || "";
          row.innerHTML = `
            <div class="bl-pin-meta">
              <span class="bl-pin-name">${esc(p.name)}</span>
              ${dirBadge}
              <span class="bl-pin-desc">std_logic</span>
            </div>
            <div class="bl-pin-input-wrap">
              <input class="bl-pin-input" data-fpga-key="${esc(p.name)}" value="${esc(currentNet)}" placeholder="net label">
            </div>`;
          host.appendChild(row);
        } else {
          const w = portWidth(p);
          const msb = p.msb ?? (w - 1);
          const lsb = p.lsb ?? 0;
          const isDownto = msb >= lsb;
          const bitIndices = [];
          if (isDownto) { for (let i = msb; i >= lsb; i--) bitIndices.push(i); }
          else { for (let i = msb; i <= lsb; i++) bitIndices.push(i); }

          const busRow = document.createElement("div");
          busRow.className = "bl-pin-row";
          busRow.id = `blPinRow_${p.name}`;
          busRow.style.background = "#131b26";
          busRow.innerHTML = `
            <div class="bl-pin-meta">
              <span class="bl-pin-name" style="color:#5fd3f0">${esc(p.name)}</span>
              ${dirBadge}
              <span class="bl-pin-desc">[${msb}:${lsb}] Bus Net</span>
            </div>
            <div class="bl-pin-input-wrap">
              <input class="bl-pin-input" data-fpga-key="${esc(p.name)}" value="${esc(BL.pinNames?.[p.name] || '')}" placeholder="whole bus net">
            </div>`;
          host.appendChild(busRow);

          for (const b of bitIndices) {
            const bitKey = `${p.name}(${b})`;
            const bitRow = document.createElement("div");
            bitRow.className = "bl-pin-row";
            bitRow.id = `blPinRow_${bitKey}`;
            bitRow.style.paddingLeft = "18px";
            const currentBitNet = BL.pinNames?.[bitKey] || "";
            bitRow.innerHTML = `
              <div class="bl-pin-meta">
                <span class="bl-pin-name" style="font-size:10.5px">${esc(p.name)}(${b})</span>
                <span class="bl-pin-desc">Bit ${b}</span>
              </div>
              <div class="bl-pin-input-wrap">
                <input class="bl-pin-input" data-fpga-key="${esc(bitKey)}" value="${esc(currentBitNet)}" placeholder="e.g. sw${b} or net">
              </div>`;
            host.appendChild(bitRow);
          }
        }
      }
    } else {
      const pinDescMap = {
        seg: { a: "Segment A", b: "Segment B", c: "Segment C", d: "Segment D", e: "Segment E", f: "Segment F", g: "Segment G", dp: "Decimal Point (DP)", bus: "Optional 4-bit / 7-bit Bus" },
        dip: { com: "Common Rail (VCC / GND)" },
        dip4: { com: "Common Rail (VCC / GND)" },
        dip2: { com: "Common Rail (VCC / GND)" },
        dip1: { com: "Common Rail (VCC / GND)" },
        bcd7seg: {
          d3: "Data In Bit 3 (MSB)",
          d2: "Data In Bit 2",
          d1: "Data In Bit 1",
          d0: "Data In Bit 0 (LSB)",
          a: "Output Segment A",
          b: "Output Segment B",
          c: "Output Segment C",
          d: "Output Segment D",
          e: "Output Segment E",
          f: "Output Segment F",
          g: "Output Segment G",
        },
        push: { a: "Switch Terminal A", com: "Common Terminal (COM)" },
        led: { a: "Anode (+)", k: "Cathode (−)" },
        ledR: { a: "Anode (+)", k: "Cathode (−)" },
        clk: { out: "Clock Signal Output" },
        hex: { bus: "Display Input Bus" },
        vcc: { p: "VCC (+)" },
        gnd: { p: "GND (−)" }
      };

      for (const t of comp.terms) {
        const row = document.createElement("div");
        row.className = "bl-pin-row";
        row.id = `blPinRow_${t.key}`;
        const desc = (pinDescMap[comp.type] && pinDescMap[comp.type][t.key])
          || (t.key.startsWith("b") ? `Switch Bit ${t.key.slice(1)}` : `Pin ${t.key.toUpperCase()}`);

        row.innerHTML = `
          <div class="bl-pin-meta">
            <span class="bl-pin-name">${esc(t.key.toUpperCase())}</span>
            <span class="bl-pin-desc">${esc(desc)}</span>
          </div>
          <div class="bl-pin-input-wrap">
            <input class="bl-pin-input" data-term-key="${esc(t.key)}" value="${esc(t.name || '')}" placeholder="net label" ${t.fixed ? "readonly" : ""}>
          </div>`;

        const inp = row.querySelector("input");
        inp.addEventListener("focus", () => renderSchematicPreview(type, comp, t.key));
        inp.addEventListener("blur", () => renderSchematicPreview(type, comp, ""));
        host.appendChild(row);
      }
    }
  }

  function savePropsModal() {
    if (!activePropsTarget) return;
    pushUndo();

    if (activePropsTarget === "__fpga") {
      BL.pinNames = BL.pinNames || {};
      const inputs = $("blPropsPinsList")?.querySelectorAll("input[data-fpga-key]");
      if (inputs) {
        inputs.forEach((inp) => {
          const key = inp.dataset.fpgaKey;
          const val = inp.value.trim();
          if (val) BL.pinNames[key] = val;
          else delete BL.pinNames[key];
        });
      }
    } else {
      const comp = activePropsTarget;
      if (comp.type === "clk") {
        const freqInp = $("blPropClkFreq");
        const unitSel = $("blPropClkUnit");
        if (freqInp) comp.freq = parseFloat(freqInp.value) || 50;
        if (unitSel) comp.unit = unitSel.value || "MHz";
      } else if (comp.type === "text") {
        if ($("blPropTextContent")) comp.text = $("blPropTextContent").value || "Text Label";
        if ($("blPropTextSize")) comp.fontSize = parseInt($("blPropTextSize").value, 10) || 14;
        if ($("blPropTextColor")) comp.color = $("blPropTextColor").value || "#d5dfe9";
        if ($("blPropTextBold")) comp.bold = !!$("blPropTextBold").checked;
      } else if (comp.type.startsWith("shape_")) {
        if ($("blPropShapeW")) comp.width = Math.max(10, parseInt($("blPropShapeW").value, 10) || 120);
        if ($("blPropShapeH")) comp.height = Math.max(10, parseInt($("blPropShapeH").value, 10) || 80);
        if ($("blPropShapeStroke")) comp.stroke = $("blPropShapeStroke").value || "#5fd3f0";
        if ($("blPropShapeStrokeW")) comp.strokeWidth = Math.max(1, parseInt($("blPropShapeStrokeW").value, 10) || 2);
        if ($("blPropShapeDash")) comp.dash = $("blPropShapeDash").value || "solid";
        if ($("blPropShapeFillType")) comp.fill = $("blPropShapeFillType").value || "none";
        if ($("blPropShapeFillColor")) comp.fillColor = $("blPropShapeFillColor").value || "#121820";
      } else if (comp.type.startsWith("dip")) {
        if ($("blPropBusNet")) comp.busNet = ($("blPropBusNet").value || "").trim();
      }

      const inputs = $("blPropsPinsList")?.querySelectorAll("input[data-term-key]");
      if (inputs) {
        inputs.forEach((inp) => {
          const key = inp.dataset.termKey;
          const t = comp.terms.find((x) => x.key === key);
          if (t && !t.fixed) {
            t.name = inp.value.trim();
          }
        });
      }
    }

    closePropsModal();
    renderCanvas();
    saveBench();
    maybeLive();
  }

  /* ------------------------------------------------------------------ *
   *  log & status
   * ------------------------------------------------------------------ */

  function renderBoardLog(log) {
    const host = $("blLog");
    host.innerHTML = "";
    if (!log || !log.length) {
      host.innerHTML = `<span class="bl-log-dim">— no runs yet —</span>`;
      return;
    }
    let hasErr = false;
    for (const entry of log) {
      const line = document.createElement("div");
      const lvl = entry.level || "";
      if (lvl === "error") hasErr = true;
      line.className = lvl === "cmd" ? "bl-log-cmd"
        : (lvl === "error" ? "bl-log-err" : (lvl === "success" ? "bl-log-ok" : ""));
      line.textContent = entry.text || "";
      host.appendChild(line);
    }
    host.scrollTop = host.scrollHeight;
    if (hasErr) {
      $("blLogPanel")?.classList.remove("hidden");
      $("blLogPanel")?.classList.remove("is-collapsed");
      const btn = $("blBtnLogToggle");
      if (btn) {
        btn.classList.add("active");
        btn.textContent = "Log ▾";
      }
    }
  }

  function blLogLine(level, text) {
    const host = $("blLog");
    host.innerHTML = "";
    const line = document.createElement("div");
    line.className = level === "err" ? "bl-log-err" : (level === "ok" ? "bl-log-ok" : "bl-log-cmd");
    line.textContent = text;
    host.appendChild(line);
    if (level === "err") {
      $("blLogPanel")?.classList.remove("hidden");
      $("blLogPanel")?.classList.remove("is-collapsed");
      const btn = $("blBtnLogToggle");
      if (btn) {
        btn.classList.add("active");
        btn.textContent = "Log ▾";
      }
    }
  }

  function setDot(kind, text) {
    const dot = $("blDotState");
    dot.className = "bl-dot" + (kind === "ok" ? " ok" : kind === "bad" ? " bad" : kind === "run" ? " run" : "");
    $("blStateText").textContent = text;
  }

  function updateStatus() {
    $("blEntityChip").textContent = BL.entity ? `entity ${BL.entity}` : "no entity";
    $("blStageTitle").textContent = BL.entity ? `${BL.entity} bench` : "Board Lab";
  }

  /* ------------------------------------------------------------------ *
   *  open / close / persistence (localStorage)
   * ------------------------------------------------------------------ */

  function getStoreKey() {
    const p = getProject();
    const id = p ? (p.name || p.folder || p.entity || "default") : "default";
    return `bl_bench_v1_${id}`;
  }

  function getBench() {
    return {
      comps: BL.comps.map((c) => ({
        type: c.type, x: c.x, y: c.y, on: c.on, terms: c.terms,
        freq: c.freq, unit: c.unit, busNet: c.busNet || "",
        text: c.text, fontSize: c.fontSize, color: c.color, bold: c.bold,
        width: c.width, height: c.height, stroke: c.stroke, strokeWidth: c.strokeWidth,
        fill: c.fill, fillColor: c.fillColor, dash: c.dash,
        dx: c.dx !== undefined ? c.dx : (c.width || 140),
        dy: c.dy !== undefined ? c.dy : (c.height || 0),
      })),
      fpgaPos: BL.fpgaPos || null,
      pinNames: BL.pinNames || null,
    };
  }

  let saveBenchTimer = null;
  function saveBench() {
    const bench = getBench();
    try {
      localStorage.setItem(getStoreKey(), JSON.stringify(bench));
    } catch (e) { /* storage unavailable */ }

    const p = getProject();
    if (p) {
      p.board_bench = bench;
      const projName = p.folder || p.name;
      if (projName) {
        if (saveBenchTimer) clearTimeout(saveBenchTimer);
        saveBenchTimer = setTimeout(() => {
          saveBenchTimer = null;
          fetch("/api/board/save_bench", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project: projName,
              board_bench: bench
            })
          }).catch(() => {});
        }, 250);
      }
    }
  }

  function loadBench() {
    try {
      let d = null;
      const p = getProject();
      if (p && p.board_bench && Array.isArray(p.board_bench.comps)) {
        d = p.board_bench;
      } else {
        const raw = localStorage.getItem(getStoreKey());
        if (raw) d = JSON.parse(raw);
      }
      if (!d || !Array.isArray(d.comps)) return false;
      BL.comps = d.comps.map((c) => {
        const comp = makeComp(c.type, c.x || 40, c.y || 40);
        comp.on = c.on || {};
        if (c.freq !== undefined) comp.freq = c.freq;
        if (c.unit !== undefined) comp.unit = c.unit;
        if (c.busNet !== undefined) comp.busNet = c.busNet;
        if (c.text !== undefined) comp.text = c.text;
        if (c.fontSize !== undefined) comp.fontSize = c.fontSize;
        if (c.color !== undefined) comp.color = c.color;
        if (c.bold !== undefined) comp.bold = c.bold;
        if (c.width !== undefined) comp.width = c.width;
        if (c.height !== undefined) comp.height = c.height;
        if (c.stroke !== undefined) comp.stroke = c.stroke;
        if (c.strokeWidth !== undefined) comp.strokeWidth = c.strokeWidth;
        if (c.fill !== undefined) comp.fill = c.fill;
        if (c.fillColor !== undefined) comp.fillColor = c.fillColor;
        if (c.dash !== undefined) comp.dash = c.dash;
        if (c.dx !== undefined) comp.dx = c.dx;
        else if (c.width !== undefined) comp.dx = c.width;
        if (c.dy !== undefined) comp.dy = c.dy;
        else if (c.height !== undefined) comp.dy = c.height;
        if (Array.isArray(c.terms)) {
          for (const st of c.terms) {
            const found = comp.terms.find((t) => t.key === st.key);
            if (found) found.name = st.name;
            else comp.terms.push({ ...st });
          }
        }
        return comp;
      });
      BL.fpgaPos = d.fpgaPos || null;
      BL.pinNames = d.pinNames || null;
      return BL.comps.length > 0;
    } catch (e) { return false; }
  }

  function openBoardLab() {
    refreshEntity();
    if (!loadBench() && BL.ports.length && !BL.comps.length) {
      // first open: FPGA chip + a starter DIP + LED
      BL.fpgaPos = { x: 60, y: 24 };
      const nIn = BL.ports.filter((p) => p.dir === "in").length;
      const nOut = BL.ports.filter((p) => p.dir !== "in").length;
      if (nIn) placeSilent("dip", 480, 40);
      if (nOut) placeSilent("led", 480, 260);
    }
    $("boardLab").classList.add("bl-open");
    BL.open = true;
    render();
    updateUndoRedoUI();
    setDot("", "idle — configure nets and click Run");
  }

  function closeBoardLab() {
    saveBench();
    closePropsModal();
    setActiveTool(null);
    stopLiveLoop();
    $("boardLab").classList.remove("bl-open");
    BL.open = false;
    BL.live = false;
    BL.pendingLive = false;
    $("blBtnLive").textContent = "Live: off";
    $("blBtnLive").classList.remove("bl-btn--run");
  }

  /* ------------------------------------------------------------------ *
   *  Paint-style live canvas drawing
   * ------------------------------------------------------------------ */

  function wireCanvasDrawing() {
    const canvas = $("blCanvas");
    const overlay = $("blDrawOverlay");
    const hud = $("blDrawHud");
    if (!canvas) return;

    let isDrawing = false;
    let startX = 0, startY = 0;

    canvas.addEventListener("mousedown", (e) => {
      if (!BL.activeTool) return;
      if (e.button !== 0) return;
      if (e.target.closest("input, button, .bl-shape-handle, .bl-dip, .bl-push")) return;

      const r = canvas.getBoundingClientRect();
      const z = BL.zoom || 1;
      startX = Math.round((e.clientX - r.left - BL.panX) / z);
      startY = Math.round((e.clientY - r.top - BL.panY) / z);
      isDrawing = true;
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDrawing || !BL.activeTool) return;
      const r = canvas.getBoundingClientRect();
      const z = BL.zoom || 1;
      const curX = Math.round((e.clientX - r.left - BL.panX) / z);
      const curY = Math.round((e.clientY - r.top - BL.panY) / z);

      if (overlay) {
        overlay.innerHTML = "";
        if (BL.activeTool === "shape_line") {
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", startX);
          line.setAttribute("y1", startY);
          line.setAttribute("x2", curX);
          line.setAttribute("y2", curY);
          line.setAttribute("stroke", "#5fd3f0");
          line.setAttribute("stroke-width", "2.5");
          line.setAttribute("stroke-linecap", "round");
          overlay.appendChild(line);

          const dx = curX - startX;
          const dy = curY - startY;
          const len = Math.round(Math.sqrt(dx * dx + dy * dy));
          const deg = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
          if (hud) {
            hud.classList.remove("hidden");
            hud.style.left = (curX + 15) + "px";
            hud.style.top = (curY + 10) + "px";
            hud.textContent = `${len}px · ${deg}°`;
          }
        } else if (BL.activeTool === "shape_rect") {
          const rx = Math.min(startX, curX);
          const ry = Math.min(startY, curY);
          const rw = Math.abs(curX - startX);
          const rh = Math.abs(curY - startY);
          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", rx);
          rect.setAttribute("y", ry);
          rect.setAttribute("width", rw);
          rect.setAttribute("height", rh);
          rect.setAttribute("rx", "4");
          rect.setAttribute("fill", "rgba(95, 211, 240, 0.08)");
          rect.setAttribute("stroke", "#5fd3f0");
          rect.setAttribute("stroke-width", "2");
          rect.setAttribute("stroke-dasharray", "6 4");
          overlay.appendChild(rect);

          if (hud) {
            hud.classList.remove("hidden");
            hud.style.left = (curX + 15) + "px";
            hud.style.top = (curY + 10) + "px";
            hud.textContent = `${rw} × ${rh} px`;
          }
        } else if (BL.activeTool === "shape_circle") {
          const rx = Math.min(startX, curX);
          const ry = Math.min(startY, curY);
          const rw = Math.abs(curX - startX);
          const rh = Math.abs(curY - startY);
          const elp = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
          elp.setAttribute("cx", rx + rw / 2);
          elp.setAttribute("cy", ry + rh / 2);
          elp.setAttribute("rx", Math.max(1, rw / 2));
          elp.setAttribute("ry", Math.max(1, rh / 2));
          elp.setAttribute("fill", "rgba(95, 211, 240, 0.08)");
          elp.setAttribute("stroke", "#5fd3f0");
          elp.setAttribute("stroke-width", "2");
          elp.setAttribute("stroke-dasharray", "6 4");
          overlay.appendChild(elp);

          if (hud) {
            hud.classList.remove("hidden");
            hud.style.left = (curX + 15) + "px";
            hud.style.top = (curY + 10) + "px";
            hud.textContent = `${rw} × ${rh} px`;
          }
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (!isDrawing) return;
      isDrawing = false;
      if (overlay) overlay.innerHTML = "";
      if (hud) hud.classList.add("hidden");

      const r = canvas.getBoundingClientRect();
      const z = BL.zoom || 1;
      const curX = Math.round((e.clientX - r.left - BL.panX) / z);
      const curY = Math.round((e.clientY - r.top - BL.panY) / z);

      const dx = curX - startX;
      const dy = curY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 8) {
        // Simple click without dragging: deselect any selected component
        for (const s of canvas.querySelectorAll(".bl-comp.is-selected")) s.classList.remove("is-selected");
        return; // ignore tiny accidental clicks
      }

      let newComp = null;
      if (BL.activeTool === "shape_line") {
        newComp = makeComp("shape_line", startX, startY);
        newComp.dx = dx;
        newComp.dy = dy;
        newComp.width = Math.round(dist);
      } else if (BL.activeTool === "shape_rect") {
        const rx = Math.min(startX, curX);
        const ry = Math.min(startY, curY);
        const rw = Math.max(15, Math.abs(dx));
        const rh = Math.max(15, Math.abs(dy));
        newComp = makeComp("shape_rect", rx, ry);
        newComp.width = rw;
        newComp.height = rh;
      } else if (BL.activeTool === "shape_circle") {
        const rx = Math.min(startX, curX);
        const ry = Math.min(startY, curY);
        const rw = Math.max(15, Math.abs(dx));
        const rh = Math.max(15, Math.abs(dy));
        newComp = makeComp("shape_circle", rx, ry);
        newComp.width = rw;
        newComp.height = rh;
      }

      if (newComp) {
        pushUndo();
        BL.comps.push(newComp);
        renderCanvas();
        // Select the newly drawn component immediately
        const el = canvas.querySelector(`[data-id="${newComp.id}"]`);
        if (el) {
          for (const s of canvas.querySelectorAll(".bl-comp.is-selected")) s.classList.remove("is-selected");
          el.classList.add("is-selected");
        }
        saveBench();
        // Exit tool mode so user can interact with/adjust the new shape or click empty space to deselect
        setActiveTool(null);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  rubber-band marquee selection
   * ------------------------------------------------------------------ */

  let justMarqueeSelected = false;

  function wireCanvasMarquee() {
    const canvas = $("blCanvas");
    if (!canvas) return;

    let isSelecting = false;
    let startX = 0, startY = 0;
    let marqueeEl = null;

    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (BL.activeTool) return;
      if (canvas.classList.contains("is-panning") || canvas.classList.contains("is-panning-active")) return;
      // Do not start marquee if clicked on a component, handle, control, or toolbar
      if (e.target.closest(".bl-comp, .bl-palette, .bl-props-modal, .bl-modal, .eda-menubar, .eda-toolbar, .bl-shape-handle, .bl-zoom-controls, input, button, select, textarea")) return;

      const r = canvas.getBoundingClientRect();
      const z = BL.zoom || 1;
      startX = Math.round((e.clientX - r.left - BL.panX) / z);
      startY = Math.round((e.clientY - r.top - BL.panY) / z);

      isSelecting = true;

      if (!e.shiftKey && !e.ctrlKey) {
        for (const el of document.querySelectorAll(".bl-comp.is-selected")) {
          el.classList.remove("is-selected");
        }
      }

      let world = $("blCanvasWorld") || canvas;
      marqueeEl = $("blMarqueeBox");
      if (!marqueeEl) {
        marqueeEl = document.createElement("div");
        marqueeEl.id = "blMarqueeBox";
        marqueeEl.className = "bl-marquee-box";
        world.appendChild(marqueeEl);
      }
      marqueeEl.style.left = startX + "px";
      marqueeEl.style.top = startY + "px";
      marqueeEl.style.width = "0px";
      marqueeEl.style.height = "0px";
      marqueeEl.style.display = "block";

      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isSelecting || !marqueeEl) return;
      const r = canvas.getBoundingClientRect();
      const z = BL.zoom || 1;
      const curX = Math.round((e.clientX - r.left - BL.panX) / z);
      const curY = Math.round((e.clientY - r.top - BL.panY) / z);

      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      marqueeEl.style.left = left + "px";
      marqueeEl.style.top = top + "px";
      marqueeEl.style.width = width + "px";
      marqueeEl.style.height = height + "px";

      if (width > 4 || height > 4) {
        const right = left + width;
        const bottom = top + height;

        const compEls = canvas.querySelectorAll(".bl-comp");
        for (const compEl of compEls) {
          let cLeft = compEl.offsetLeft;
          let cTop = compEl.offsetTop;
          let cRight = cLeft + (compEl.offsetWidth || 50);
          let cBottom = cTop + (compEl.offsetHeight || 40);

          if (compEl.dataset.type === "shape_line") {
            const comp = BL.comps.find(x => x.id === compEl.dataset.id);
            if (comp) {
              cLeft = Math.min(comp.x, comp.x + (comp.dx || 0));
              cRight = Math.max(comp.x, comp.x + (comp.dx || 0));
              cTop = Math.min(comp.y, comp.y + (comp.dy || 0));
              cBottom = Math.max(comp.y, comp.y + (comp.dy || 0));
            }
          }

          const overlaps = !(cLeft > right || cRight < left || cTop > bottom || cBottom < top);
          if (overlaps) {
            compEl.classList.add("is-selected");
          } else if (!e.shiftKey && !e.ctrlKey) {
            compEl.classList.remove("is-selected");
          }
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (!isSelecting) return;
      isSelecting = false;
      if (marqueeEl) {
        marqueeEl.style.display = "none";
      }

      const r = canvas.getBoundingClientRect();
      const z = BL.zoom || 1;
      const curX = Math.round((e.clientX - r.left - BL.panX) / z);
      const curY = Math.round((e.clientY - r.top - BL.panY) / z);
      if (Math.abs(curX - startX) > 4 || Math.abs(curY - startY) > 4) {
        justMarqueeSelected = true;
        setTimeout(() => { justMarqueeSelected = false; }, 100);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  pan & zoom
   * ------------------------------------------------------------------ */

  function applyCanvasTransform() {
    const world = $("blCanvasWorld");
    const canvas = $("blCanvas");
    if (!world || !canvas) return;
    world.style.transform = `translate(${BL.panX}px, ${BL.panY}px) scale(${BL.zoom})`;
    const bgSize = Math.max(10, Math.round(22 * BL.zoom));
    canvas.style.backgroundSize = `${bgSize}px ${bgSize}px`;
    canvas.style.backgroundPosition = `${BL.panX % bgSize}px ${BL.panY % bgSize}px`;
    const zoomLevelEl = $("blZoomLevel");
    if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(BL.zoom * 100)}%`;
  }

  function zoomCanvas(delta, centerScreenX, centerScreenY) {
    const canvas = $("blCanvas");
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const cx = (centerScreenX !== undefined ? centerScreenX : (r.left + r.width / 2)) - r.left;
    const cy = (centerScreenY !== undefined ? centerScreenY : (r.top + r.height / 2)) - r.top;

    const oldZoom = BL.zoom;
    const factor = delta > 0 ? 1.2 : 0.833;
    const newZoom = Math.min(3.0, Math.max(0.25, Math.round(oldZoom * factor * 100) / 100));
    if (newZoom === oldZoom) return;

    BL.panX = Math.round(cx - (cx - BL.panX) * (newZoom / oldZoom));
    BL.panY = Math.round(cy - (cy - BL.panY) * (newZoom / oldZoom));
    BL.zoom = newZoom;
    applyCanvasTransform();
  }

  function fitCanvasContent() {
    const canvas = $("blCanvas");
    if (!canvas) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (BL.ports.length) {
      const fx = BL.fpgaPos?.x ?? 40;
      const fy = BL.fpgaPos?.y ?? 40;
      minX = Math.min(minX, fx);
      minY = Math.min(minY, fy);
      maxX = Math.max(maxX, fx + 320);
      maxY = Math.max(maxY, fy + 240);
    }
    for (const c of BL.comps) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      const w = c.width || 120;
      const h = c.height || 80;
      maxX = Math.max(maxX, c.x + w);
      maxY = Math.max(maxY, c.y + h);
    }
    if (!isFinite(minX) || maxX <= minX) {
      BL.zoom = 1.0;
      BL.panX = 0;
      BL.panY = 0;
      applyCanvasTransform();
      return;
    }
    const cw = canvas.clientWidth - 80;
    const ch = canvas.clientHeight - 80;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const z = Math.min(1.5, Math.max(0.4, Math.min(cw / contentW, ch / contentH)));
    BL.zoom = Math.round(z * 100) / 100;
    BL.panX = Math.round(40 + (cw - contentW * BL.zoom) / 2 - minX * BL.zoom);
    BL.panY = Math.round(40 + (ch - contentH * BL.zoom) / 2 - minY * BL.zoom);
    applyCanvasTransform();
  }

  function goToOrigin() {
    const canvas = $("blCanvas");
    if (!canvas) return;
    BL.zoom = 1.0;
    BL.panX = 60;
    BL.panY = 50;
    applyCanvasTransform();

    const marker = $("blOriginMarker");
    if (marker) {
      marker.classList.remove("is-pulsing");
      void marker.offsetWidth;
      marker.classList.add("is-pulsing");
      setTimeout(() => marker.classList.remove("is-pulsing"), 800);
    }
  }

  function wireCanvasPanZoom() {
    const canvas = $("blCanvas");
    if (!canvas) return;

    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let initialPanX = 0, initialPanY = 0;
    let spaceDown = false;

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !spaceDown && BL.open && !e.target.closest("input, textarea")) {
        spaceDown = true;
        canvas.classList.add("is-panning");
      }
      if ((e.code === "Home" || e.key === "Home") && BL.open && !e.target.closest("input, textarea, select")) {
        e.preventDefault();
        goToOrigin();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        spaceDown = false;
        if (!isPanning) canvas.classList.remove("is-panning");
      }
    });

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomCanvas(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }, { passive: false });

    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        initialPanX = BL.panX;
        initialPanY = BL.panY;
        canvas.classList.add("is-panning-active");
        e.preventDefault();
        e.stopPropagation();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      BL.panX = initialPanX + (e.clientX - panStartX);
      BL.panY = initialPanY + (e.clientY - panStartY);
      applyCanvasTransform();
    });

    window.addEventListener("mouseup", () => {
      if (isPanning) {
        isPanning = false;
        canvas.classList.remove("is-panning-active");
        if (!spaceDown) canvas.classList.remove("is-panning");
      }
    });

    canvas.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".bl-comp, .bl-props-modal")) return;
      e.preventDefault();
    });

    $("blBtnZoomIn")?.addEventListener("click", () => zoomCanvas(1));
    $("blBtnZoomOut")?.addEventListener("click", () => zoomCanvas(-1));
    $("blZoomLevel")?.addEventListener("click", () => {
      BL.zoom = 1.0;
      BL.panX = 0;
      BL.panY = 0;
      applyCanvasTransform();
    });
    $("blBtnZoomFit")?.addEventListener("click", fitCanvasContent);
    $("blBtnOrigin")?.addEventListener("click", goToOrigin);
  }

  /* Central, leak-free window drag and resize coordinator --------------- */
  function wireCentralDragAndResize() {
    window.addEventListener("mousemove", (e) => {
      const z = BL.zoom || 1;

      // Handle component / multi-component drag
      if (activeDrag) {
        const dx = (e.clientX - activeDrag.sx) / z;
        const dy = (e.clientY - activeDrag.sy) / z;
        for (const item of activeDrag.startPositions) {
          item.el.style.left = Math.round(item.ox + dx) + "px";
          item.el.style.top = Math.round(item.oy + dy) + "px";
        }
        drawWires();
      }

      // Handle shape resize
      if (activeResize) {
        const ar = activeResize;
        if (ar.kind === "line-end") {
          const newDx = Math.round(ar.initDx + (e.clientX - ar.startX) / z);
          const newDy = Math.round(ar.initDy + (e.clientY - ar.startY) / z);
          ar.c.dx = newDx;
          ar.c.dy = newDy;
          ar.c.width = Math.round(Math.sqrt(newDx * newDx + newDy * newDy));
          updateLineShapeDOM(ar.c, ar.body);
        } else if (ar.kind === "line-start") {
          const dX = (e.clientX - ar.sx) / z;
          const dY = (e.clientY - ar.sy) / z;
          ar.c.x = Math.round(ar.origX + dX);
          ar.c.y = Math.round(ar.origY + dY);
          ar.c.dx = Math.round(ar.origDx - dX);
          ar.c.dy = Math.round(ar.origDy - dY);
          ar.c.width = Math.round(Math.sqrt(ar.c.dx * ar.c.dx + ar.c.dy * ar.c.dy));
          ar.el.style.left = ar.c.x + "px";
          ar.el.style.top = ar.c.y + "px";
          updateLineShapeDOM(ar.c, ar.body);
        } else if (ar.kind === "rect-se") {
          const newW = Math.max(15, Math.round(ar.origW + (e.clientX - ar.sx) / z));
          const newH = Math.max(15, Math.round(ar.origH + (e.clientY - ar.sy) / z));
          ar.c.width = newW;
          ar.c.height = newH;
          ar.body.style.width = newW + "px";
          ar.body.style.height = newH + "px";
          const rectHit = ar.body.querySelector(".bl-rect-hit");
          const rectVis = ar.body.querySelector(".bl-rect-vis");
          if (rectHit) {
            rectHit.setAttribute("width", Math.max(2, newW - ar.sw));
            rectHit.setAttribute("height", Math.max(2, newH - ar.sw));
          }
          if (rectVis) {
            rectVis.setAttribute("width", Math.max(2, newW - ar.sw));
            rectVis.setAttribute("height", Math.max(2, newH - ar.sw));
          }
          ar.seHandle.style.left = newW + "px";
          ar.seHandle.style.top = newH + "px";
        } else if (ar.kind === "circle-se") {
          const newW = Math.max(15, Math.round(ar.origW + (e.clientX - ar.sx) / z));
          const newH = Math.max(15, Math.round(ar.origH + (e.clientY - ar.sy) / z));
          ar.c.width = newW;
          ar.c.height = newH;
          ar.body.style.width = newW + "px";
          ar.body.style.height = newH + "px";
          const elpHit = ar.body.querySelector(".bl-circle-hit");
          const elpVis = ar.body.querySelector(".bl-circle-vis");
          if (elpHit) {
            elpHit.setAttribute("cx", newW / 2);
            elpHit.setAttribute("cy", newH / 2);
            elpHit.setAttribute("rx", Math.max(2, (newW - ar.sw) / 2));
            elpHit.setAttribute("ry", Math.max(2, (newH - ar.sw) / 2));
          }
          if (elpVis) {
            elpVis.setAttribute("cx", newW / 2);
            elpVis.setAttribute("cy", newH / 2);
            elpVis.setAttribute("rx", Math.max(2, (newW - ar.sw) / 2));
            elpVis.setAttribute("ry", Math.max(2, (newH - ar.sw) / 2));
          }
          ar.seHandle.style.left = newW + "px";
          ar.seHandle.style.top = newH + "px";
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (activeDrag) {
        const ad = activeDrag;
        activeDrag = null;

        let anyMoved = false;
        for (const item of ad.startPositions) {
          item.el.classList.remove("is-drag");
          const newX = item.el.offsetLeft;
          const newY = item.el.offsetTop;
          if (newX !== item.ox || newY !== item.oy) anyMoved = true;
          if (item.id === "__fpga") {
            BL.fpgaPos = { x: newX, y: newY };
          } else {
            const c = BL.comps.find((x) => x.id === item.id);
            if (c) { c.x = newX; c.y = newY; }
          }
        }

        if (anyMoved && ad.dragSnap) {
          if (!BL.undoStack.length || BL.undoStack[BL.undoStack.length - 1] !== ad.dragSnap) {
            BL.undoStack.push(ad.dragSnap);
            if (BL.undoStack.length > MAX_UNDO) BL.undoStack.shift();
            BL.redoStack = [];
            updateUndoRedoUI();
          }
        } else if (!anyMoved && !e.shiftKey && !e.ctrlKey && ad.startPositions.length > 1) {
          for (const s of document.querySelectorAll(".bl-comp.is-selected")) {
            if (s !== ad.el) s.classList.remove("is-selected");
          }
        }
        saveBench();
      }

      if (activeResize) {
        const ar = activeResize;
        activeResize = null;
        ar.el.classList.remove("is-resizing");
        if (ar.snap && ar.snap !== getBoardSnapshot()) {
          BL.undoStack.push(ar.snap);
          if (BL.undoStack.length > MAX_UNDO) BL.undoStack.shift();
          BL.redoStack = [];
          updateUndoRedoUI();
        }
        saveBench();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  wiring (events)
   * ------------------------------------------------------------------ */

  function wire() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && BL.open) {
        if (BL.activeTool) {
          setActiveTool(null);
          return;
        }
        const modal = $("blPropsModal");
        if (modal && !modal.classList.contains("hidden")) {
          closePropsModal();
          return;
        }
        closeBoardLab();
      }
      if (e.key === "F8") {
        e.preventDefault();
        if (BL.open) closeBoardLab(); else openBoardLab();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && BL.open) {
        const modal = $("blPropsModal");
        if (modal && !modal.classList.contains("hidden")) return;
        if (e.target.closest("input, textarea")) return;
        const sels = Array.from(document.querySelectorAll(".bl-comp.is-selected"));
        const toDeleteIds = sels.map((s) => s.dataset.id).filter((id) => id && id !== "__fpga");
        if (toDeleteIds.length) {
          e.preventDefault();
          pushUndo();
          BL.comps = BL.comps.filter((x) => !toDeleteIds.includes(x.id));
          renderCanvas();
          saveBench();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && BL.open) {
        if (e.target.closest("input, textarea")) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && BL.open) {
        if (e.target.closest("input, textarea")) return;
        e.preventDefault();
        redo();
      }
    });

    $("blBtnClose")?.addEventListener("click", closeBoardLab);
    $("blBtnUndo")?.addEventListener("click", undo);
    $("blBtnRedo")?.addEventListener("click", redo);
    $("blBtnRun")?.addEventListener("click", runBoard);
    $("blBtnLive")?.addEventListener("click", () => {
      BL.live = !BL.live;
      $("blBtnLive").textContent = BL.live ? "Live: on" : "Live: off";
      $("blBtnLive").classList.toggle("bl-btn--run", BL.live);
      if (BL.live) {
        startLiveLoop();
      } else {
        stopLiveLoop();
      }
    });
    $("blBtnClearBoard")?.addEventListener("click", () => {
      pushUndo();
      stopLiveLoop();
      BL.clockCycles = 0;
      BL.comps = [];
      BL.fpgaPos = null;
      try { localStorage.removeItem(getStoreKey()); } catch (e) {}
      renderCanvas();
    });
    function updateLogUI() {
      const p = $("blLogPanel");
      const btn = $("blBtnLogToggle");
      const isHidden = p?.classList.contains("hidden");
      const isCollapsed = p?.classList.contains("is-collapsed");
      if (btn) {
        btn.classList.toggle("active", !isHidden && !isCollapsed);
        btn.textContent = (isHidden || isCollapsed) ? "Log ▴" : "Log ▾";
      }
      const tBtn = $("blLogToggle");
      if (tBtn) {
        tBtn.textContent = isCollapsed ? "▴" : "▾";
      }
    }

    $("blLogToggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      $("blLogPanel")?.classList.toggle("is-collapsed");
      updateLogUI();
    });
    $("blLogHead")?.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      $("blLogPanel")?.classList.toggle("is-collapsed");
      updateLogUI();
    });
    $("blLogClose")?.addEventListener("click", (e) => {
      e.stopPropagation();
      $("blLogPanel")?.classList.add("hidden");
      updateLogUI();
    });
    $("blBtnLogToggle")?.addEventListener("click", () => {
      const p = $("blLogPanel");
      if (!p) return;
      if (p.classList.contains("hidden")) {
        p.classList.remove("hidden");
        p.classList.remove("is-collapsed");
      } else {
        p.classList.toggle("is-collapsed");
      }
      updateLogUI();
    });
    $("blClockFreq")?.addEventListener("change", () => {
      const f = parseFloat($("blClockFreq").value) || 50;
      for (const c of BL.comps) {
        if (c.type !== "clk") continue;
        c.freq = f;
        c.unit = "MHz";
        const el = $("blCanvas")?.querySelector(`[data-id="${c.id}"]`);
        if (el) {
          const lbl = el.querySelector(".bl-clk-f");
          if (lbl) lbl.textContent = f + " MHz";
          updateTagRow(c, el);
        }
      }
      saveBench();
      maybeLive();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && BL.playback && BL.playback.running) {
        // Resync baseline time when returning from background tab to prevent burst updates
        BL.playback.startTime = performance.now() - (BL.playback.currentStep * BL.playback.intervalMs);
      }
    });
    document.addEventListener("mousedown", (e) => {
      if (!BL.open) return;
      if (e.target.closest("#blCanvas, .bl-comp, .bl-palette, .bl-stage-head, .bl-props-modal, .bl-modal, .eda-menubar, .eda-toolbar, .bl-shape-handle, .bl-zoom-controls, .bl-logpanel, .bl-log-btn")) return;
      for (const el of document.querySelectorAll(".bl-comp.is-selected")) el.classList.remove("is-selected");
    });

    // Global push-button release handler on window to prevent listener accumulation
    window.addEventListener("mouseup", () => {
      let changed = false;
      for (const c of BL.comps) {
        if (c.type === "push" && c.on && c.on[0]) {
          c.on[0] = 0;
          changed = true;
          const el = $("blCanvas")?.querySelector(`[data-id="${c.id}"]`);
          if (el) {
            el.querySelector(".bl-push")?.classList.remove("is-on");
            el.classList.remove("is-on");
            updateTagRow(c, el);
          }
        }
      }
      if (changed) {
        saveBench();
        maybeLive();
      }
    });

    // Properties Modal wiring
    $("blPropsClose")?.addEventListener("click", closePropsModal);
    $("blPropsCancel")?.addEventListener("click", closePropsModal);
    $("blPropsSave")?.addEventListener("click", savePropsModal);
    $("blPropsModal")?.addEventListener("click", (e) => {
      if (e.target === $("blPropsModal")) closePropsModal();
    });

    // Bus auto-assign button for DIP switches
    $("blBtnAutoBus")?.addEventListener("click", () => {
      const busNet = ($("blPropBusNet")?.value || "").trim();
      if (!busNet) return;
      const inputs = $("blPropsPinsList")?.querySelectorAll("input[data-term-key]");
      if (inputs) {
        inputs.forEach((inp) => {
          const key = inp.dataset.termKey;
          if (key && key.startsWith("b")) {
            const bitIdx = key.slice(1);
            inp.value = `${busNet}(${bitIdx})`;
          }
        });
      }
    });

    // Shape fill type toggle
    $("blPropShapeFillType")?.addEventListener("change", (e) => {
      const isCol = e.target.value === "color";
      if ($("blPropShapeFillColor")) {
        $("blPropShapeFillColor").style.display = isCol ? "inline-block" : "none";
      }
    });

    wireCanvasDrop();
    wireCanvasDrawing();
    wireCanvasPanZoom();
    wireCanvasMarquee();
    wireCentralDragAndResize();
    window.addEventListener("resize", () => { if (BL.open) drawWires(); });
  }

  window.BoardLab = {
    open: openBoardLab,
    close: closeBoardLab,
    refresh: refreshEntity,
    run: runBoard,
    getBench: getBench,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
