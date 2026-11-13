/* ==========================================================================
 * Digital Systems Laboratory 2 — Waveform Viewer
 * ---------------------------------------------------------------------------
 * A self-contained SVG timing-diagram renderer fed by the raw transition
 * data produced by the backend (signal -> [[t_ns, value], ...]).
 *
 * Features
 *   - true-time axis (ns) with adaptive tick spacing
 *   - wheel zoom around the mouse, drag-to-pan, Fit button
 *   - per-signal color: default GREEN, "Auto colors" palette, click a name
 *     to cycle its color manually
 *   - scalar signals: full-swing traces; buses: hexagonal segments with the
 *     value written inside, formatted as hex / dec / bin
 *   - measurement cursor (click) with a live readout of every signal value
 *   - export as PNG (canvas) and as true vector SVG (standalone file)
 * ========================================================================== */
"use strict";

(function () {

  /* ------------------------------------------------------------------ *
   * Palette & constants
   * ------------------------------------------------------------------ */
  const GREEN = "#2ee66b";
  const AUTO_COLORS = [
    "#2ee66b", "#5fd3f0", "#ffc861", "#ff8fa3", "#b48cff",
    "#6fe7c0", "#7ab8ff", "#f0a35e", "#ff6b6b", "#9ddf5c",
  ];
  const X_UNKNOWN = "#ff5f5f";
  const BG = "#0b1016";          // window background
  const PLOT_BG = "#0a0f16";     // plot area background
  const GRID = "#182230";
  const AXIS = "#3a4a5e";
  const TEXT = "#c9d6e2";
  const MUTED = "#5c6b7d";
  const LANE_H = 34;             // px per signal lane
  const TOP_PAD = 26;            // room for the time axis
  const SCALAR_H = 18;           // peak-to-peak height of a scalar trace
  const BUS_H = 22;              // height of a bus hexagon
  const MONO = "JetBrains Mono, Consolas, monospace";
  const UI = "Inter, Segoe UI, sans-serif";

  /* ------------------------------------------------------------------ *
   * Viewer state
   * ------------------------------------------------------------------ */
  const V = {
    signals: [],            // [{name, width, tv:[[t,v],...], color, autoIdx, radix, hidden}]
    visible: [],            // indices after filtering
    t0: 0, t1: 100,         // visible time window [ns]
    tMax: 100,              // total simulated time
    format: "hex",
    cursorA: null,          // measurement cursor A position (ns) | null
    cursorB: null,          // measurement cursor B position (ns) | null
    paneW: 800, paneH: 400,
    namesScroll: 0,
    snap: true,             // magnetic snap to nearest transition edge
    showStats: false,       // timing stats panel drawer open/closed
    maximized: false,       // window maximized state
    savedBounds: null,      // previous bounds before maximize {left, top, width, height}
    signalPrefs: {},        // user preferences per signal name: { color, radix, hidden }
    signalOrder: [],        // user ordering of signals: [name1, name2, ...]
  };

  const el = {};
  ["waveModal", "wvWindow", "wvTitlebar", "wvClose", "wvSub", "wvZoomIn",
   "wvZoomOut", "wvFit", "wvFormat", "wvAutoColors", "wvResetColors",
   "wvClearCursors", "wvUnhideAll", "wvPrevEdge", "wvNextEdge",
   "wvSavePng", "wvSaveSvg", "wvFilter", "wvNamesInner", "wvWaves", "wvSvg",
   "wvCrossA", "wvCrossB", "wvDeltaRegion", "wvStatusL", "wvGrip",
   "wvMax", "wvMaxIcon", "wvSnap", "wvStats", "wvStatsPanel", "wvStatsTbody",
   "wvCopyStats", "wvSaveCsv", "wvSaveVcd"].forEach(id => {
     el[id] = document.getElementById(id);
   });

  const svg = el.wvSvg;
  const NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs || {}) node.setAttribute(k, attrs[k]);
    return node;
  }

  /* ------------------------------------------------------------------ *
   * Value formatting (hex / dec / bin) for bus values
   * ------------------------------------------------------------------ */
  function normBits(v) {
    let s = String(v).toLowerCase();
    if (s[0] === "b") s = s.slice(1);
    return s;
  }

  function isBinary(s) { return /^[01]+$/.test(s); }

  function fmtValue(v, width, format) {
    const s = normBits(v);
    if (!isBinary(s)) return s.toUpperCase() || "?";      // x / z / u
    if (width === 1) return s;
    if (format === "bin") {
      return s.length < width ? s.padStart(width, "0") : s;
    }
    const val = parseInt(s, 2);
    if (format === "dec") return String(val);
    const hexw = Math.max(2, Math.ceil(width / 4));
    return "0x" + val.toString(16).toUpperCase().padStart(hexw, "0");
  }

  function valAt(tv, t) {
    if (!tv || !tv.length) return "0";
    let lo = 0, hi = tv.length - 1, r = tv[0][1];
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (tv[m][0] <= t) { r = tv[m][1]; lo = m + 1; } else hi = m - 1;
    }
    return r;
  }

  /* ------------------------------------------------------------------ *
   * Preference persistence & edge snapping (HPLP-inspired)
   * ------------------------------------------------------------------ */
  function saveSignalPrefs(s) {
    if (!s || !s.name) return;
    V.signalPrefs[s.name] = {
      color: s.color,
      radix: s.radix,
      hidden: !!s.hidden,
    };
  }

  function saveSignalOrder() {
    V.signalOrder = V.signals.map(s => s.name);
  }

  function snapToNearestEdge(tTarget, pxRadius = 18) {
    if (!V.snap || !V.signals.length) return tTarget;
    let closestT = tTarget;
    let minPxDist = Infinity;
    const targetPx = tToPx(tTarget);

    for (const idx of V.visible) {
      const s = V.signals[idx];
      if (!s || !s.tv) continue;
      for (const [t] of s.tv) {
        const px = tToPx(t);
        const dist = Math.abs(px - targetPx);
        if (dist <= pxRadius && dist < minPxDist) {
          minPxDist = dist;
          closestT = t;
        }
      }
    }
    return closestT;
  }

  /* ------------------------------------------------------------------ *
   * Loading data
   * ------------------------------------------------------------------ */
  function loadWaveform(simResult) {
    const raw = (simResult && simResult.raw) || [];

    // Construct signals, preserving custom colors, radices, and hidden states
    const loadedSignals = raw.map((s, i) => {
      const pref = V.signalPrefs[s.name] || {};
      return {
        name: s.name,
        width: s.width || 1,
        tv: (s.tv || []).map(([t, v]) => [t, v]),
        color: pref.color || GREEN,
        autoIdx: i % AUTO_COLORS.length,
        radix: pref.radix || null,
        hidden: typeof pref.hidden === "boolean" ? pref.hidden : false,
      };
    });

    // Reorder signals if user previously customized signal ordering
    if (V.signalOrder && V.signalOrder.length) {
      const orderMap = new Map();
      V.signalOrder.forEach((name, idx) => orderMap.set(name, idx));
      loadedSignals.sort((a, b) => {
        const orderA = orderMap.has(a.name) ? orderMap.get(a.name) : 99999;
        const orderB = orderMap.has(b.name) ? orderMap.get(b.name) : 99999;
        return orderA - orderB;
      });
    }

    V.signals = loadedSignals;
    const maxSignalT = Math.max(0, ...V.signals.map(s => (s.tv.length ? s.tv[s.tv.length - 1][0] : 0)));
    const simEndT = (simResult && typeof simResult.end_time_ns === "number") ? simResult.end_time_ns : 0;
    V.tMax = Math.max(1, maxSignalT, simEndT);

    // Ensure all signals extend up to V.tMax so steady-state values at the end of the simulation are visible
    V.signals.forEach(s => {
      if (s.tv && s.tv.length > 0) {
        const lastT = s.tv[s.tv.length - 1][0];
        if (lastT < V.tMax) {
          s.tv.push([V.tMax, s.tv[s.tv.length - 1][1]]);
        }
      }
    });

    V.cursorA = null;
    V.cursorB = null;
    V.namesScroll = 0;
    el.wvFilter.value = "";
    applyFilter();
    fitView();
    render();
    if (V.showStats) updateStatsPanel();
  }

  function applyFilter() {
    const f = el.wvFilter.value.trim().toLowerCase();
    V.visible = V.signals
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !s.hidden && (!f || s.name.toLowerCase().includes(f)))
      .map(({ i }) => i);
    const anyHidden = V.signals.some(s => s.hidden);
    if (el.wvUnhideAll) el.wvUnhideAll.classList.toggle("hidden", !anyHidden);
  }

  /* ------------------------------------------------------------------ *
   * Time axis helpers
   * ------------------------------------------------------------------ */
  function niceStep(target) {
    const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
                   1, 2, 5, 10, 20, 50, 100, 200, 500,
                   1000, 2000, 5000, 10000, 20000, 50000];
    for (const s of steps) if (s >= target) return s;
    return 100000;
  }

  function fmtTime(ns) {
    if (ns === 0) return "0";
    if (Math.abs(ns) < 1) return ns.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    if (Math.abs(ns) < 1000) return String(Math.round(ns * 1000) / 1000);
    if (Math.abs(ns) < 1e6) return (Math.round(ns / 100) / 10) + "k";   // us as "1k"
    return (Math.round(ns / 1e5) / 10) + "M";
  }
  const tToPx = (t) => (t - V.t0) / (V.t1 - V.t0) * V.paneW;
  const pxToT = (x) => V.t0 + x / V.paneW * (V.t1 - V.t0);

  /* ------------------------------------------------------------------ *
   * Signal geometry helpers
   * ------------------------------------------------------------------ */
  function laneY(k) { return TOP_PAD + k * LANE_H + LANE_H / 2; }

  function scalarPath(tv, color, k) {
    const yHi = laneY(k) - SCALAR_H / 2;
    const yLo = laneY(k) + SCALAR_H / 2;
    const yMid = (yHi + yLo) / 2;
    const g = svgEl("g", {});

    const edges = [Math.max(V.t0, tv.length ? tv[0][0] : 0)];
    for (const [t] of tv) if (t > V.t0 && t < V.t1) edges.push(t);
    edges.push(V.t1);
    const uniq = [...new Set(edges)].sort((a, b) => a - b);

    let prevLevel = null;
    let prevWasUnknown = false;

    for (let e = 0; e < uniq.length - 1; e++) {
      const tA = uniq[e], tB = uniq[e + 1];
      const x1 = Math.max(0, tToPx(tA));
      const x2 = Math.min(V.paneW, tToPx(tB));
      if (x2 - x1 < 0.2) continue;

      const v = normBits(valAt(tv, tA + (tB - tA) * 0.001));
      const isX = /^[xuw\-]$/i.test(v);
      const isZ = v === "z";
      const isOne = v === "1";
      const curLevel = isOne ? yHi : (isZ ? yMid : (isX ? yMid : yLo));

      // Draw vertical transition line from previous segment
      if (prevLevel !== null && (prevLevel !== curLevel || prevWasUnknown || isX)) {
        const transColor = (prevWasUnknown || isX) ? "#ff4d4f" : color;
        const yTopTrans = (prevWasUnknown || isX) ? yHi : Math.min(prevLevel, curLevel);
        const yBotTrans = (prevWasUnknown || isX) ? yLo : Math.max(prevLevel, curLevel);
        g.appendChild(svgEl("line", {
          x1, y1: yTopTrans, x2: x1, y2: yBotTrans,
          stroke: transColor, "stroke-width": 1.8, "stroke-linecap": "round"
        }));
      }

      if (isX) {
        // --- X / Contention / Unknown state: Vivid Red Hazard Box ---
        // 1. Shaded red rect
        g.appendChild(svgEl("rect", {
          x: x1, y: yHi, width: x2 - x1, height: yLo - yHi,
          fill: "#ff4d4f", opacity: 0.24, stroke: "#ff4d4f", "stroke-width": 1.5,
          "shape-rendering": "crispEdges"
        }));
        // 2. High & low red rails
        g.appendChild(svgEl("line", {
          x1, y1: yHi, x2, y2: yHi, stroke: "#ff4d4f", "stroke-width": 1.8
        }));
        g.appendChild(svgEl("line", {
          x1, y1: yLo, x2, y2: yLo, stroke: "#ff4d4f", "stroke-width": 1.8
        }));
        // 3. Red glow underlay
        g.appendChild(svgEl("line", {
          x1, y1: yMid, x2, y2: yMid, stroke: "#ff4d4f", "stroke-width": 5, opacity: 0.3
        }));
        // 4. Center label "X" or cross lines
        if (x2 - x1 >= 14) {
          const txt = svgEl("text", {
            x: (x1 + x2) / 2, y: yMid + 4,
            "text-anchor": "middle", fill: "#ff4d4f",
            "font-family": MONO, "font-size": 11.5, "font-weight": 700
          });
          txt.textContent = v.toUpperCase() || "X";
          g.appendChild(txt);
        } else {
          g.appendChild(svgEl("line", {
            x1, y1: yHi, x2, y2: yLo, stroke: "#ff4d4f", "stroke-width": 1.2
          }));
          g.appendChild(svgEl("line", {
            x1, y1: yLo, x2, y2: yHi, stroke: "#ff4d4f", "stroke-width": 1.2
          }));
        }
      } else if (isZ) {
        // --- Z state (High-Impedance / Floating) ---
        g.appendChild(svgEl("line", {
          x1, y1: yMid, x2, y2: yMid, stroke: "#5fd3f0", "stroke-width": 1.8,
          "stroke-dasharray": "4,3"
        }));
        if (x2 - x1 >= 18) {
          const txt = svgEl("text", {
            x: (x1 + x2) / 2, y: yMid - 3,
            "text-anchor": "middle", fill: "#5fd3f0",
            "font-family": MONO, "font-size": 9.5, "font-weight": 700
          });
          txt.textContent = "Z";
          g.appendChild(txt);
        }
      } else {
        // --- Normal '0' or '1' Logic Level ---
        // Glow underlay
        g.appendChild(svgEl("line", {
          x1, y1: curLevel, x2, y2: curLevel,
          stroke: color, "stroke-width": 5, opacity: 0.14, "stroke-linecap": "round"
        }));
        // Main trace
        g.appendChild(svgEl("line", {
          x1, y1: curLevel, x2, y2: curLevel,
          stroke: color, "stroke-width": 1.8, "stroke-linecap": "round"
        }));
      }

      prevLevel = curLevel;
      prevWasUnknown = isX;
    }
    return g;
  }

  function busGroup(tv, color, k, width, name, radix) {
    const yTop = laneY(k) - BUS_H / 2;
    const yBot = laneY(k) + BUS_H / 2;
    const yMid = (yTop + yBot) / 2;
    const g = svgEl("g", {});
    const slant = 6;
    const fontPx = Math.min(12, Math.max(9, BUS_H - 9));
    const activeFormat = radix || V.format;

    // segments = visible transitions + window boundaries
    const edges = [Math.max(V.t0, tv.length ? tv[0][0] : 0)];
    for (const [t] of tv) if (t > V.t0 && t < V.t1) edges.push(t);
    edges.push(V.t1);
    const uniq = [...new Set(edges)].sort((a, b) => a - b);

    for (let e = 0; e < uniq.length - 1; e++) {
      const x1 = Math.max(0, tToPx(uniq[e]));
      const x2 = Math.min(V.paneW, tToPx(uniq[e + 1]));
      if (x2 - x1 < 0.5) continue;
      const v = normBits(valAt(tv, uniq[e] + (uniq[e + 1] - uniq[e]) * 0.001));
      const binary = isBinary(v);

      if (binary) {
        const isStart = (x1 <= 0.5);
        const isEnd = (x2 >= V.paneW - 0.5);
        const sL = isStart ? 0 : Math.min(slant, (x2 - x1) / 3);
        const sR = isEnd ? 0 : Math.min(slant, (x2 - x1) / 3);

        let d;
        if (isStart && isEnd) {
          d = `M ${x1} ${yTop} L ${x2} ${yTop} L ${x2} ${yBot} L ${x1} ${yBot} Z`;
        } else if (isStart) {
          d = [
            `M ${x1} ${yTop}`,
            `L ${x2 - sR} ${yTop}`,
            `L ${x2} ${yMid}`,
            `L ${x2 - sR} ${yBot}`,
            `L ${x1} ${yBot}`,
            "Z",
          ].join(" ");
        } else if (isEnd) {
          d = [
            `M ${x1} ${yMid}`,
            `L ${x1 + sL} ${yTop}`,
            `L ${x2} ${yTop}`,
            `L ${x2} ${yBot}`,
            `L ${x1 + sL} ${yBot}`,
            "Z",
          ].join(" ");
        } else {
          d = [
            `M ${x1} ${yMid}`,
            `L ${x1 + sL} ${yTop}`,
            `L ${x2 - sR} ${yTop}`,
            `L ${x2} ${yMid}`,
            `L ${x2 - sR} ${yBot}`,
            `L ${x1 + sL} ${yBot}`,
            "Z",
          ].join(" ");
        }

        g.appendChild(svgEl("path", {
          d, fill: hexA(color, 0.16), stroke: color, "stroke-width": 1.6,
          "stroke-linejoin": "round",
        }));
        // value label when the segment is wide enough
        if (x2 - x1 > 34) {
          const txt = svgEl("text", {
            x: (x1 + x2) / 2, y: yMid + fontPx * 0.36,
            "text-anchor": "middle", fill: color,
            "font-family": MONO, "font-size": fontPx, "font-weight": 500,
          });
          txt.textContent = fmtValue(v, width, activeFormat);
          g.appendChild(txt);
        }
      } else {
        // X / Z / U segment: prominent red hazard box for contention / unknown
        const hasUnknown = /[xuw\-]/i.test(v);
        const bStroke = hasUnknown ? "#ff4d4f" : "#5fd3f0";
        const bFill = hasUnknown ? "#ff4d4f" : "#5fd3f0";
        const bOpacity = hasUnknown ? 0.26 : 0.14;

        g.appendChild(svgEl("rect", {
          x: x1, y: yTop, width: x2 - x1, height: yBot - yTop,
          fill: bFill, opacity: bOpacity, stroke: bStroke,
          "stroke-width": 1.8,
          "stroke-dasharray": hasUnknown ? "none" : "3,2",
        }));
        if (x2 - x1 > 20) {
          const txt = svgEl("text", {
            x: (x1 + x2) / 2, y: yMid + fontPx * 0.36,
            "text-anchor": "middle", fill: bStroke,
            "font-family": MONO, "font-size": fontPx, "font-weight": 700,
          });
          txt.textContent = v.toUpperCase() || "?";
          g.appendChild(txt);
        }
      }
    }
    return g;
  }

  function hexA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16),
          b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* ------------------------------------------------------------------ *
   * Full render (axis + lanes + names + cursor)
   * ------------------------------------------------------------------ */
  function render() {
    const rect = el.wvWaves.getBoundingClientRect();
    V.paneW = Math.max(200, Math.round(rect.width));
    V.paneH = Math.max(120, Math.round(rect.height));

    // keep the time window within [0, tMax] with a little slack
    clampView();

    svg.setAttribute("viewBox", `0 0 ${V.paneW} ${V.paneH}`);
    svg.setAttribute("width", V.paneW);
    svg.setAttribute("height", V.paneH);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const plotH = Math.max(V.paneH, TOP_PAD + V.visible.length * LANE_H + 8);

    // background
    svg.appendChild(svgEl("rect", {
      x: 0, y: 0, width: V.paneW, height: plotH, fill: PLOT_BG,
    }));

    // vertical grid + time labels (strictly no negative time)
    const span = Math.max(0.001, V.t1 - V.t0);
    const step = niceStep(span / 10);
    const gridG = svgEl("g", {});
    svg.appendChild(gridG);
    const startT = Math.max(0, Math.ceil(V.t0 / step) * step);
    for (let t = startT; t <= V.t1 + 1e-9; t += step) {
      if (t < 0) continue;
      const x = tToPx(t);
      gridG.appendChild(svgEl("line", {
        x1: x, y1: 0, x2: x, y2: plotH, stroke: GRID, "stroke-width": 1,
      }));
      const lbl = svgEl("text", {
        x: x, y: 14, "text-anchor": t === V.t0 ? "start" : "middle",
        fill: MUTED, "font-family": MONO, "font-size": 10.5,
      });
      lbl.textContent = fmtTime(t);
      gridG.appendChild(lbl);
    }
    // unit caption on the left of the axis
    const unit = svgEl("text", {
      x: 4, y: 14, fill: MUTED, "font-family": MONO, "font-size": 10.5,
      "font-weight": 700,
    });
    unit.textContent = "ns";
    gridG.appendChild(unit);

    // zebra striping across visible lanes
    V.visible.forEach((idx, k) => {
      if (k % 2 === 1) {
        svg.appendChild(svgEl("rect", {
          x: 0, y: TOP_PAD + k * LANE_H, width: V.paneW, height: LANE_H,
          fill: "#101826", opacity: 0.45,
        }));
      }
    });

    // horizontal lane separators
    V.visible.forEach((idx, k) => {
      if (k === 0) return;
      svg.appendChild(svgEl("line", {
        x1: 0, y1: TOP_PAD + k * LANE_H, x2: V.paneW, y2: TOP_PAD + k * LANE_H,
        stroke: "#141c28", "stroke-width": 1,
      }));
    });

    // signal traces
    V.visible.forEach((idx, k) => {
      const s = V.signals[idx];
      if (!s.tv.length) return;
      if (s.width > 1) {
        svg.appendChild(busGroup(s.tv, s.color, k, s.width, s.name, s.radix));
      } else {
        svg.appendChild(scalarPath(s.tv, s.color, k));
      }
    });

    renderNames();
    renderCursor();
    updateStatus();
    if (V.showStats) updateStatsPanel();
  }

  let draggedSigIdx = null;

  function renderNames() {
    const inner = el.wvNamesInner;
    inner.innerHTML = "";
    const curT = V.cursorA !== null ? V.cursorA : (V.cursorB !== null ? V.cursorB : null);

    V.visible.forEach((idx, k) => {
      const s = V.signals[idx];
      const row = document.createElement("div");
      row.className = "wv-name" + (k % 2 === 1 ? " zebra" : "");
      row.draggable = true;
      row.dataset.sigIdx = idx;

      // Drag & Drop reordering (HPLP-inspired)
      row.addEventListener("dragstart", (e) => {
        draggedSigIdx = idx;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(idx));
      });

      row.addEventListener("dragend", () => {
        draggedSigIdx = null;
        row.classList.remove("dragging");
        document.querySelectorAll(".wv-name").forEach(r => {
          r.classList.remove("drag-over-top", "drag-over-bottom");
        });
      });

      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = row.getBoundingClientRect();
        const midY = r.top + r.height / 2;
        if (e.clientY < midY) {
          row.classList.add("drag-over-top");
          row.classList.remove("drag-over-bottom");
        } else {
          row.classList.remove("drag-over-top");
          row.classList.add("drag-over-bottom");
        }
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over-top", "drag-over-bottom");
      });

      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over-top", "drag-over-bottom");
        const srcIdx = draggedSigIdx !== null ? draggedSigIdx : parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (isNaN(srcIdx) || srcIdx === idx) return;

        const r = row.getBoundingClientRect();
        const midY = r.top + r.height / 2;
        const insertAfter = e.clientY >= midY;

        const movedItem = V.signals.splice(srcIdx, 1)[0];
        let targetIdx = V.signals.indexOf(s);
        if (insertAfter) targetIdx++;
        V.signals.splice(targetIdx, 0, movedItem);

        saveSignalOrder();
        applyFilter();
        render();
        if (V.showStats) updateStatsPanel();
      });
      
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.cssText =
        `width:9px;height:9px;border-radius:50%;background:${s.color};flex:0 0 9px;cursor:pointer;` +
        `box-shadow:0 0 6px ${hexA(s.color, 0.8)}`;
      dot.title = "Click to cycle color";
      dot.addEventListener("click", () => cycleSignalColor(idx));

      const label = document.createElement("span");
      label.className = "wv-name-label";
      label.textContent = s.name;
      label.title = `${s.name} (${s.width} bit${s.width > 1 ? "s" : ""}) — drag to reorder / click to change color`;
      label.addEventListener("click", () => cycleSignalColor(idx));

      // Value inspector badge at cursor
      let valStr = "";
      let isUnknown = false;
      if (curT !== null && s.tv.length) {
        const rawV = normBits(valAt(s.tv, curT));
        valStr = fmtValue(rawV, s.width, s.radix || V.format);
        isUnknown = /[xuw\-]/i.test(rawV);
      }
      const valBadge = document.createElement("span");
      valBadge.className = "wv-val-badge" + (valStr ? " active" : "") + (isUnknown ? " bad-val" : "");
      valBadge.textContent = valStr || "—";
      valBadge.title = curT !== null ? `Signal '${s.name}' @ ${fmtTime(curT)} ns = ${valStr}` : "Place measurement cursor to inspect value";

      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(valBadge);

      const actions = document.createElement("div");
      actions.className = "wv-name-actions";

      // Radix toggle pill for multi-bit buses
      if (s.width > 1) {
        const curRadix = s.radix || V.format;
        const rPill = document.createElement("button");
        rPill.className = "radix-pill";
        rPill.textContent = curRadix;
        rPill.title = "Toggle radix (Hex / Dec / Bin)";
        rPill.addEventListener("click", (e) => {
          e.stopPropagation();
          const next = curRadix === "hex" ? "dec" : curRadix === "dec" ? "bin" : "hex";
          s.radix = next;
          saveSignalPrefs(s);
          render();
        });
        actions.appendChild(rPill);
      }

      // Move Up button
      const btnUp = document.createElement("button");
      btnUp.className = "sig-btn";
      btnUp.innerHTML = "&uarr;";
      btnUp.title = "Move signal up";
      btnUp.addEventListener("click", (e) => {
        e.stopPropagation();
        if (idx > 0) {
          const tmp = V.signals[idx];
          V.signals[idx] = V.signals[idx - 1];
          V.signals[idx - 1] = tmp;
          saveSignalOrder();
          applyFilter();
          render();
        }
      });
      actions.appendChild(btnUp);

      // Move Down button
      const btnDown = document.createElement("button");
      btnDown.className = "sig-btn";
      btnDown.innerHTML = "&darr;";
      btnDown.title = "Move signal down";
      btnDown.addEventListener("click", (e) => {
        e.stopPropagation();
        if (idx < V.signals.length - 1) {
          const tmp = V.signals[idx];
          V.signals[idx] = V.signals[idx + 1];
          V.signals[idx + 1] = tmp;
          saveSignalOrder();
          applyFilter();
          render();
        }
      });
      actions.appendChild(btnDown);

      // Hide button
      const btnHide = document.createElement("button");
      btnHide.className = "sig-btn";
      btnHide.innerHTML = "&times;";
      btnHide.title = "Hide signal";
      btnHide.addEventListener("click", (e) => {
        e.stopPropagation();
        s.hidden = true;
        saveSignalPrefs(s);
        applyFilter();
        render();
      });
      actions.appendChild(btnHide);

      row.appendChild(actions);
      inner.appendChild(row);
    });
    // keep names vertically aligned with lanes while the wave area scrolls
    inner.style.transform = `translateY(${-V.namesScroll}px)`;
  }

  function renderCursor() {
    const crossA = el.wvCrossA;
    const crossB = el.wvCrossB;
    const delta = el.wvDeltaRegion;

    const renderOne = (cross, t) => {
      if (!cross) return;
      if (t === null || t < V.t0 || t > V.t1) {
        cross.style.display = "none";
        return;
      }
      cross.style.display = "block";
      cross.style.left = tToPx(t) + "px";
      cross.dataset.t = fmtTime(Math.round(t * 1000) / 1000) + " ns";
    };

    renderOne(crossA, V.cursorA);
    renderOne(crossB, V.cursorB);

    if (delta) {
      if (V.cursorA !== null && V.cursorB !== null) {
        const minT = Math.min(V.cursorA, V.cursorB);
        const maxT = Math.max(V.cursorA, V.cursorB);
        const x1 = Math.max(0, Math.min(V.paneW, tToPx(minT)));
        const x2 = Math.max(0, Math.min(V.paneW, tToPx(maxT)));
        if (x2 - x1 > 0.5) {
          delta.style.display = "block";
          delta.style.left = x1 + "px";
          delta.style.width = (x2 - x1) + "px";
        } else {
          delta.style.display = "none";
        }
      } else {
        delta.style.display = "none";
      }
    }
  }

  function updateStatus() {
    const n = V.visible.length;
    let text =
      `${n} signal${n === 1 ? "" : "s"} · window ` +
      `${fmtTime(Math.round(V.t0 * 100) / 100)} … ${fmtTime(Math.round(V.t1 * 100) / 100)} ns` +
      ` · ${fmtTime(Math.round((V.t1 - V.t0) * 100) / 100)} ns/div-step ×10`;

    if (V.cursorA !== null && V.cursorB !== null) {
      const tA = Math.round(V.cursorA * 1000) / 1000;
      const tB = Math.round(V.cursorB * 1000) / 1000;
      const dt = Math.abs(tB - tA);
      let fStr = "";
      if (dt > 1e-6) {
        const freqMhz = 1000 / dt;
        fStr = freqMhz >= 1000
          ? ` (f = ${(freqMhz / 1000).toFixed(2)} GHz)`
          : freqMhz >= 1
            ? ` (f = ${freqMhz.toFixed(2)} MHz)`
            : ` (f = ${(freqMhz * 1000).toFixed(1)} kHz)`;
      }
      text += ` · A: ${fmtTime(tA)} ns | B: ${fmtTime(tB)} ns | Δt: ${fmtTime(Math.round(dt * 1000) / 1000)} ns${fStr}`;
    } else if (V.cursorA !== null) {
      text += ` · Cursor A @ ${fmtTime(Math.round(V.cursorA * 1000) / 1000)} ns (Shift+click/right-click for Cursor B)`;
    } else if (V.cursorB !== null) {
      text += ` · Cursor B @ ${fmtTime(Math.round(V.cursorB * 1000) / 1000)} ns`;
    }
    el.wvStatusL.textContent = text;
  }

  function clampView() {
    const minSpan = 0.001;
    if (V.t1 - V.t0 < minSpan) V.t1 = V.t0 + minSpan;
    // Strictly prevent negative time (t0 >= 0)
    if (V.t0 < 0) {
      const d = -V.t0;
      V.t0 = 0;
      V.t1 += d;
    }
    const maxT = Math.max(1, V.tMax * 1.05);
    if (V.t1 > maxT) {
      const d = V.t1 - maxT;
      V.t0 = Math.max(0, V.t0 - d);
      V.t1 = maxT;
    }
    if (V.t0 < 0) V.t0 = 0;
  }

  function fitView() {
    V.t0 = 0;
    V.t1 = Math.max(1, V.tMax * 1.02);
  }

  /* ------------------------------------------------------------------ *
   * Zoom / pan / cursor interactions
   * ------------------------------------------------------------------ */
  function zoomAt(pxX, factor) {
    const t = Math.max(0, pxToT(pxX));
    const span = (V.t1 - V.t0) * factor;
    if (span < 1e-4 || span > V.tMax * 50) return;
    V.t0 = Math.max(0, t - (t - V.t0) * factor);
    V.t1 = Math.max(V.t0 + 0.001, t + (V.t1 - t) * factor);
    clampView();
    render();
  }

  function jumpClockEdge(direction) {
    // direction: -1 for prev edge, +1 for next edge
    if (!V.signals.length) return;
    let ref = V.signals.find(s => !s.hidden && /\b(clk|clock)\b/i.test(s.name));
    if (!ref) {
      ref = V.signals.find(s => !s.hidden && s.tv.length > 1);
    }
    if (!ref && V.visible.length) {
      ref = V.signals[V.visible[0]];
    }
    if (!ref || !ref.tv.length) return;

    const curT = V.cursorA !== null ? V.cursorA : 0;
    const eps = 1e-4;
    let target = null;

    if (direction < 0) {
      for (let i = ref.tv.length - 1; i >= 0; i--) {
        if (ref.tv[i][0] < curT - eps) {
          target = ref.tv[i][0];
          break;
        }
      }
    } else {
      for (let i = 0; i < ref.tv.length; i++) {
        if (ref.tv[i][0] > curT + eps) {
          target = ref.tv[i][0];
          break;
        }
      }
    }

    if (target !== null) {
      V.cursorA = Math.max(0, Math.round(target * 1000) / 1000);
      if (V.cursorA < V.t0 || V.cursorA > V.t1) {
        const span = V.t1 - V.t0;
        V.t0 = Math.max(0, V.cursorA - span / 2);
        V.t1 = V.t0 + span;
        clampView();
      }
      render();
      toastInApp(`Cursor @ ${ref.name} edge: ${fmtTime(V.cursorA)} ns`);
    } else {
      toastInApp(direction < 0 ? "No earlier transition" : "No later transition");
    }
  }

  /* ------------------------------------------------------------------ *
   * Timing statistics, reports & CSV export (HPLP-inspired)
   * ------------------------------------------------------------------ */
  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[m]);
  }

  function computeSignalStats(s) {
    if (!s || !s.tv || !s.tv.length) return null;
    const tv = s.tv;
    const tTotal = Math.max(0.001, V.tMax);
    let edgeCount = Math.max(0, tv.length - 1);
    let risingCount = 0;
    let highDuration = 0;

    for (let i = 0; i < tv.length; i++) {
      const tStart = tv[i][0];
      const tEnd = (i + 1 < tv.length) ? tv[i + 1][0] : V.tMax;
      const val = normBits(tv[i][1]);
      const dur = Math.max(0, tEnd - tStart);

      if (s.width === 1) {
        if (val === "1") {
          highDuration += dur;
        }
        if (i > 0) {
          const prevVal = normBits(tv[i - 1][1]);
          if (prevVal === "0" && val === "1") risingCount++;
        }
      }
    }

    let highPct = "—";
    let lowPct = "—";
    let estFreq = "—";

    if (s.width === 1) {
      const hp = Math.min(100, Math.max(0, (highDuration / tTotal) * 100));
      highPct = hp.toFixed(1) + "%";
      lowPct = (100 - hp).toFixed(1) + "%";

      if (risingCount > 0 && tTotal > 0) {
        const fHz = risingCount / (tTotal * 1e-9);
        if (fHz >= 1e9) estFreq = (fHz / 1e9).toFixed(2) + " GHz";
        else if (fHz >= 1e6) estFreq = (fHz / 1e6).toFixed(2) + " MHz";
        else if (fHz >= 1e3) estFreq = (fHz / 1e3).toFixed(2) + " kHz";
        else estFreq = fHz.toFixed(1) + " Hz";
      }
    } else {
      if (edgeCount > 0 && tTotal > 0) {
        const rate = edgeCount / (tTotal * 1e-9);
        if (rate >= 1e6) estFreq = (rate / 1e6).toFixed(1) + " MT/s";
        else if (rate >= 1e3) estFreq = (rate / 1e3).toFixed(1) + " kT/s";
        else estFreq = rate.toFixed(0) + " T/s";
      }
    }

    const valA = V.cursorA !== null ? fmtValue(normBits(valAt(tv, V.cursorA)), s.width, s.radix || V.format) : "—";
    const valB = V.cursorB !== null ? fmtValue(normBits(valAt(tv, V.cursorB)), s.width, s.radix || V.format) : "—";

    return {
      name: s.name,
      width: s.width,
      color: s.color,
      edges: edgeCount,
      highPct,
      lowPct,
      estFreq,
      valA,
      valB,
    };
  }

  function updateStatsPanel() {
    if (!el.wvStatsTbody) return;
    el.wvStatsTbody.innerHTML = "";

    V.visible.forEach((idx) => {
      const s = V.signals[idx];
      const st = computeSignalStats(s);
      if (!st) return;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="color:${st.color};font-weight:600;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${st.color};margin-right:6px;vertical-align:middle;"></span>${escapeHtml(st.name)}</td>
        <td>${st.width}</td>
        <td>${st.edges}</td>
        <td>${st.highPct}</td>
        <td>${st.lowPct}</td>
        <td>${st.estFreq}</td>
        <td class="v-cell">${escapeHtml(st.valA)}</td>
        <td class="v-cell">${escapeHtml(st.valB)}</td>
      `;
      el.wvStatsTbody.appendChild(tr);
    });
  }

  function toggleStatsPanel() {
    V.showStats = !V.showStats;
    if (el.wvStatsPanel) el.wvStatsPanel.classList.toggle("hidden", !V.showStats);
    if (el.wvStats) el.wvStats.classList.toggle("active", V.showStats);
    if (V.showStats) updateStatsPanel();
  }

  function copyStatsText() {
    const lines = [];
    lines.push(`Signal Timing Statistics (Total Sim Time: ${fmtTime(V.tMax)} ns)`);
    if (V.cursorA !== null || V.cursorB !== null) {
      let curInfo = `Cursor A: ${V.cursorA !== null ? fmtTime(V.cursorA) + " ns" : "None"}`;
      curInfo += ` | Cursor B: ${V.cursorB !== null ? fmtTime(V.cursorB) + " ns" : "None"}`;
      if (V.cursorA !== null && V.cursorB !== null) {
        const dt = Math.abs(V.cursorB - V.cursorA);
        curInfo += ` | Δt: ${fmtTime(dt)} ns`;
        if (dt > 0) curInfo += ` (1/Δt = ${(1000 / dt).toFixed(2)} MHz)`;
      }
      lines.push(curInfo);
    }
    lines.push("");
    lines.push("| Signal | Width | Edges | High % | Low % | Est. Freq | Value @ A | Value @ B |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |");

    V.visible.forEach((idx) => {
      const s = V.signals[idx];
      const st = computeSignalStats(s);
      if (st) {
        lines.push(`| ${st.name} | ${st.width} | ${st.edges} | ${st.highPct} | ${st.lowPct} | ${st.estFreq} | ${st.valA} | ${st.valB} |`);
      }
    });

    const text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        toastInApp("Timing statistics copied to clipboard");
      }).catch(() => {
        toastInApp("Failed to copy to clipboard", true);
      });
    } else {
      toastInApp("Clipboard not supported in this browser", true);
    }
  }

  function exportCsv() {
    if (!V.signals.length) {
      toastInApp("No signals to export", true);
      return;
    }
    const timeSet = new Set();
    timeSet.add(0);
    timeSet.add(V.tMax);
    V.signals.forEach(s => {
      (s.tv || []).forEach(([t]) => timeSet.add(t));
    });
    const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);

    const sigs = V.visible.map(idx => V.signals[idx]);
    const headers = ["Time_ns", ...sigs.map(s => `${s.name}${s.width > 1 ? `[${s.width - 1}:0]` : ""}`)];
    const rows = [headers.join(",")];

    for (const t of sortedTimes) {
      const row = [t];
      for (const s of sigs) {
        const rawV = normBits(valAt(s.tv, t));
        const val = fmtValue(rawV, s.width, s.radix || V.format);
        row.push(`"${val}"`);
      }
      rows.push(row.join(","));
    }

    const csvContent = "\uFEFF" + rows.join("\r\n"); // UTF-8 BOM for Excel
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `waveform_${Date.now()}.csv`, "CSV exported");
  }

  function downloadVcd() {
    const tb = (V && V.doc && V.doc.tb_entity) ? V.doc.tb_entity : "wave";
    const filename = `${tb}.vcd`;
    const url = `/api/simulation/vcd?name=${encodeURIComponent(filename)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toastInApp(`Downloading IEEE-1364 VCD trace (${filename})...`);
  }

  function wireInteractions() {
    el.wvWaves.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = el.wvWaves.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.deltaY > 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });

    // Right-click = set Cursor B (with magnetic edge snap)
    el.wvWaves.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const rect = el.wvWaves.getBoundingClientRect();
      const rawT = pxToT(e.clientX - rect.left);
      V.cursorB = Math.max(0, Math.min(V.tMax, snapToNearestEdge(rawT)));
      render();
    });

    let pan = null;
    el.wvWaves.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const rect = el.wvWaves.getBoundingClientRect();
      pan = { x: e.clientX - rect.left, t0: V.t0, t1: V.t1, moved: false };
      el.wvWaves.classList.add("panning");
    });
    window.addEventListener("mousemove", (e) => {
      if (!pan) return;
      const rect = el.wvWaves.getBoundingClientRect();
      const dx = e.clientX - rect.left - pan.x;
      if (Math.abs(dx) > 3) pan.moved = true;
      const dt = dx / V.paneW * (pan.t1 - pan.t0);
      V.t0 = Math.max(0, pan.t0 - dt);
      V.t1 = Math.max(V.t0 + 0.001, pan.t1 - dt);
      clampView();
      render();
    });
    window.addEventListener("mouseup", (e) => {
      if (pan && !pan.moved) {                    // click -> place cursor A or B (with magnetic edge snap)
        const rect = el.wvWaves.getBoundingClientRect();
        const rawT = pxToT(pan.x);
        const t = Math.max(0, Math.min(V.tMax, snapToNearestEdge(rawT)));
        if (e.shiftKey) {
          V.cursorB = t;
        } else {
          V.cursorA = t;
        }
        render();
      }
      pan = null;
      el.wvWaves.classList.remove("panning");
    });

    el.wvZoomIn.addEventListener("click", () => zoomAt(V.paneW / 2, 1 / 1.35));
    el.wvZoomOut.addEventListener("click", () => zoomAt(V.paneW / 2, 1.35));
    el.wvFit.addEventListener("click", () => { fitView(); render(); });

    if (el.wvPrevEdge) {
      el.wvPrevEdge.addEventListener("click", () => jumpClockEdge(-1));
    }
    if (el.wvNextEdge) {
      el.wvNextEdge.addEventListener("click", () => jumpClockEdge(1));
    }

    if (el.wvSnap) {
      el.wvSnap.addEventListener("click", () => {
        V.snap = !V.snap;
        el.wvSnap.classList.toggle("active", V.snap);
        el.wvSnap.textContent = V.snap ? "Snap: ON" : "Snap: OFF";
      });
    }

    if (el.wvStats) {
      el.wvStats.addEventListener("click", toggleStatsPanel);
    }

    if (el.wvCopyStats) {
      el.wvCopyStats.addEventListener("click", copyStatsText);
    }

    if (el.wvSaveCsv) {
      el.wvSaveCsv.addEventListener("click", exportCsv);
    }

    if (el.wvSaveVcd) {
      el.wvSaveVcd.addEventListener("click", downloadVcd);
    }

    el.wvFormat.addEventListener("change", () => {
      V.format = el.wvFormat.value;
      render();
    });

    el.wvFilter.addEventListener("input", () => { applyFilter(); render(); });

    el.wvAutoColors.addEventListener("click", () => {
      V.signals.forEach(s => {
        s.color = AUTO_COLORS[s.autoIdx];
        saveSignalPrefs(s);
      });
      render();
    });
    el.wvResetColors.addEventListener("click", () => {
      V.signals.forEach(s => {
        s.color = GREEN;
        saveSignalPrefs(s);
      });
      render();
    });

    if (el.wvClearCursors) {
      el.wvClearCursors.addEventListener("click", () => {
        V.cursorA = null;
        V.cursorB = null;
        render();
      });
    }

    if (el.wvUnhideAll) {
      el.wvUnhideAll.addEventListener("click", () => {
        V.signals.forEach(s => {
          s.hidden = false;
          saveSignalPrefs(s);
        });
        applyFilter();
        render();
      });
    }

    el.wvSaveSvg.addEventListener("click", saveSvg);
    el.wvSavePng.addEventListener("click", savePng);
  }

  function cycleSignalColor(idx) {
    const s = V.signals[idx];
    const i = AUTO_COLORS.indexOf(s.color);
    s.color = i === -1 || i === AUTO_COLORS.length - 1 ? GREEN : AUTO_COLORS[i + 1];
    saveSignalPrefs(s);
    render();
  }

  /* ------------------------------------------------------------------ *
   * Export — SVG (vector) and PNG (raster)
   * ------------------------------------------------------------------ */
  function buildExportSvg() {
    // Full-time-range, all-visible-signals standalone SVG document
    const saveT0 = V.t0, saveT1 = V.t1;
    V.t0 = 0;
    V.t1 = Math.max(1, V.tMax * 1.02);

    const NAME_W = 180;
    const PLOT_W = Math.max(760, Math.min(3600, Math.round(V.t1 * 3) || 760));
    const TOTAL_W = NAME_W + PLOT_W;
    const H = TOP_PAD + V.visible.length * LANE_H + 36;
    const saveW = V.paneW;
    V.paneW = PLOT_W;

    const out = svgEl("svg", {
      xmlns: NS, width: TOTAL_W, height: H, viewBox: `0 0 ${TOTAL_W} ${H}`,
    });
    const style = svgEl("style", {});
    style.textContent = `text{font-family:${MONO};font-size:11px;}` +
      `@font-face{font-family:'JetBrains Mono';src:local('JetBrains Mono');}`;
    out.appendChild(style);

    // Plot and left column background
    out.appendChild(svgEl("rect", { x: 0, y: 0, width: TOTAL_W, height: H, fill: PLOT_BG }));
    out.appendChild(svgEl("rect", { x: 0, y: 0, width: NAME_W, height: H, fill: "#0c131d" }));
    out.appendChild(svgEl("line", {
      x1: NAME_W, y1: 0, x2: NAME_W, y2: H, stroke: "#1f2e42", "stroke-width": 1.5,
    }));

    // Header branding & author credit
    const title = svgEl("text", {
      x: 14, y: 17, fill: TEXT, "font-size": 11.5, "font-weight": 700,
    });
    title.textContent = "Digital Systems Lab 2";
    out.appendChild(title);

    // Time axis inside plot area (offset by NAME_W)
    const axisY = TOP_PAD - 6;
    const step = niceStep((V.t1 - V.t0) / Math.max(6, PLOT_W / 140));
    for (let t = 0; t <= V.t1 + 1e-9; t += step) {
      if (t < 0) continue;
      const xPlot = tToPx(t);
      const xTotal = NAME_W + xPlot;
      out.appendChild(svgEl("line", {
        x1: xTotal, y1: TOP_PAD, x2: xTotal, y2: H - 24, stroke: GRID, "stroke-width": 1,
      }));
      const lbl = svgEl("text", {
        x: xTotal, y: axisY, "text-anchor": "middle", fill: MUTED, "font-size": 10,
      });
      lbl.textContent = fmtTime(t);
      out.appendChild(lbl);
    }
    const unit = svgEl("text", {
      x: NAME_W + 6, y: axisY, fill: MUTED, "font-size": 10, "font-weight": 700,
    });
    unit.textContent = "ns";
    out.appendChild(unit);

    // Signal lanes: zebra striping, names in left column, traces inside plot area
    V.visible.forEach((idx, k) => {
      const yLane = TOP_PAD + k * LANE_H;
      // zebra background
      if (k % 2 === 1) {
        out.appendChild(svgEl("rect", {
          x: 0, y: yLane, width: TOTAL_W, height: LANE_H,
          fill: "#121b27", opacity: 0.55,
        }));
      }
      // lane separator line
      out.appendChild(svgEl("line", {
        x1: 0, y1: yLane, x2: TOTAL_W, y2: yLane, stroke: "#15202e", "stroke-width": 1,
      }));

      const s = V.signals[idx];

      // Signal color indicator dot
      out.appendChild(svgEl("circle", {
        cx: 16, cy: laneY(k), r: 4, fill: s.color,
      }));

      // Signal name in left column
      const nameText = svgEl("text", {
        x: 26, y: laneY(k) + 4, fill: TEXT, "font-size": 11, "font-weight": 600,
      });
      nameText.textContent = s.name.length > 15 ? s.name.slice(0, 14) + "…" : s.name;
      out.appendChild(nameText);

      // Radix / width indicator in left column
      if (s.width > 1) {
        const rText = svgEl("text", {
          x: NAME_W - 8, y: laneY(k) + 3.5, "text-anchor": "end",
          fill: MUTED, "font-size": 9.5,
        });
        rText.textContent = `[${s.radix || V.format}]`;
        out.appendChild(rText);
      }

      // Signal waveform trace in plot area (offset by NAME_W so it never touches names)
      if (s.tv.length) {
        const traceGroup = s.width > 1
          ? busGroup(s.tv, s.color, k, s.width, s.name, s.radix)
          : scalarPath(s.tv, s.color, k);
        traceGroup.setAttribute("transform", `translate(${NAME_W}, 0)`);
        out.appendChild(traceGroup);
      }
    });

    // Footer copyright
    const footText = svgEl("text", {
      x: 14, y: H - 10, fill: MUTED, "font-size": 9,
    });
    footText.textContent = "© 2026 S.M.M.Mahmoodi · Timing Diagram Export · Digital Systems Laboratory 2";
    out.appendChild(footText);

    // restore interactive state
    V.paneW = saveW; V.t0 = saveT0; V.t1 = saveT1;

    const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!-- Digital Systems Laboratory 2 - timing diagram export by S.M.M.Mahmoodi -->\n`;
    return header + new XMLSerializer().serializeToString(out);
  }

  function saveSvg() {
    const blob = new Blob([buildExportSvg()], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(blob, "waveform.svg", "SVG saved");
  }

  function savePng() {
    const svgText = buildExportSvg();
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    const img = new Image();
    img.onload = () => {
      const scale = 2;                       // crisp retina export
      const W = img.naturalWidth || img.width || 1200;
      const H = img.naturalHeight || img.height || 600;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = PLOT_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => triggerDownload(b, "waveform.png", "PNG saved"), "image/png");
    };
    img.onerror = () => {
      toastInApp("PNG export failed — try Save SVG instead", true);
    };
    img.src = url;
  }

  function triggerDownload(blob, filename, okMsg) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 400);
    toastInApp(okMsg + " — " + filename);
  }

  function toastInApp(msg, isErr) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle("err", !!isErr);
    t.classList.add("show");
    clearTimeout(toastInApp._t);
    toastInApp._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ------------------------------------------------------------------ *
   * Window chrome: open / close / drag / resize / maximize
   * ------------------------------------------------------------------ */
  function openWindow(simResult, subtitle) {
    el.wvSub.textContent = subtitle || "";
    el.waveModal.classList.remove("hidden");
    loadWaveform(simResult);
    // center the window on first open if it has no custom position yet
    if (!el.wvWindow.style.left) {
      const r = el.wvWindow.getBoundingClientRect();
      el.wvWindow.style.left =
        Math.max(8, (window.innerWidth - r.width) / 2) + "px";
      el.wvWindow.style.top =
        Math.max(8, (window.innerHeight - r.height) / 2.4) + "px";
    }
    requestAnimationFrame(render);
  }

  function closeWindow() {
    el.waveModal.classList.add("hidden");
  }

  function toggleMaximize() {
    V.maximized = !V.maximized;
    const win = el.wvWindow;
    if (V.maximized) {
      V.savedBounds = {
        left: win.style.left,
        top: win.style.top,
        width: win.style.width,
        height: win.style.height,
      };
      win.classList.add("maximized");
      win.style.left = "0px";
      win.style.top = "0px";
      win.style.width = "100vw";
      win.style.height = "100vh";
      if (el.wvMaxIcon) {
        el.wvMaxIcon.innerHTML = `<rect x="4.5" y="1.5" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 5.5v9h9" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
      }
      if (el.wvMax) el.wvMax.title = "Restore Window (Double-click titlebar)";
    } else {
      win.classList.remove("maximized");
      if (V.savedBounds) {
        win.style.left = V.savedBounds.left || "";
        win.style.top = V.savedBounds.top || "";
        win.style.width = V.savedBounds.width || "";
        win.style.height = V.savedBounds.height || "";
      }
      if (el.wvMaxIcon) {
        el.wvMaxIcon.innerHTML = `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
      }
      if (el.wvMax) el.wvMax.title = "Maximize Window (Double-click titlebar)";
    }
    render();
    if (V.showStats) updateStatsPanel();
  }

  function wireWindowChrome() {
    el.wvClose.addEventListener("click", closeWindow);

    if (el.wvMax) {
      el.wvMax.addEventListener("click", toggleMaximize);
    }

    // drag by titlebar
    el.wvTitlebar.addEventListener("mousedown", (e) => {
      if (e.target.closest(".wv-close") || e.target.closest(".wv-win-actions")) return;
      const win = el.wvWindow;
      const r = win.getBoundingClientRect();
      const offX = e.clientX - r.left, offY = e.clientY - r.top;
      const move = (ev) => {
        if (V.maximized) {
          V.maximized = false;
          win.classList.remove("maximized");
          if (el.wvMaxIcon) {
            el.wvMaxIcon.innerHTML = `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
          }
        }
        win.style.left = Math.min(window.innerWidth - 120,
                          Math.max(-r.width + 160, ev.clientX - offX)) + "px";
        win.style.top = Math.min(window.innerHeight - 60,
                          Math.max(0, ev.clientY - offY)) + "px";
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      e.preventDefault();
    });

    // double-click titlebar = maximize / restore
    el.wvTitlebar.addEventListener("dblclick", (e) => {
      if (e.target.closest(".wv-close") || e.target.closest(".wv-win-actions")) return;
      toggleMaximize();
    });

    // resize from the bottom-right grip
    el.wvGrip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const win = el.wvWindow;
      const r = win.getBoundingClientRect();
      const move = (ev) => {
        if (V.maximized) {
          V.maximized = false;
          win.classList.remove("maximized");
          if (el.wvMaxIcon) {
            el.wvMaxIcon.innerHTML = `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
          }
        }
        const w = Math.max(560, Math.min(window.innerWidth - r.left - 4, ev.clientX - r.left));
        const h = Math.max(340, Math.min(window.innerHeight - r.top - 4, ev.clientY - r.top));
        win.style.width = w + "px";
        win.style.height = h + "px";
        render();
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });

    // keep in sync when the main window resizes
    window.addEventListener("resize", () => {
      if (!el.waveModal.classList.contains("hidden")) render();
    });

    // click the dark backdrop = close
    el.waveModal.addEventListener("mousedown", (e) => {
      if (e.target === el.waveModal) closeWindow();
    });
  }

  /* ------------------------------------------------------------------ *
   * Public API + boot
   * ------------------------------------------------------------------ */
  window.WaveViewer = {
    open: openWindow,
    close: closeWindow,
    isOpen: () => !el.waveModal.classList.contains("hidden"),
    updateData: (simResult, subtitle) => {
      loadWaveform(simResult);
      el.wvSub.textContent = subtitle || "";
      render();
    },
    getSvgString: buildExportSvg,
    downloadVcd: downloadVcd,
  };

  wireInteractions();
  wireWindowChrome();
})();
