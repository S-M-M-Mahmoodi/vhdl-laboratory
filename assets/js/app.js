/* ==========================================================================
 * VHDL Laboratory — Application Logic & EDA Controller
 * ---------------------------------------------------------------------------
 * Copyright (c) 2026 S.M.M.Mahmoodi.
 * Licensed under the MIT License.
 * Software Architecture & Engineering: S.M.M.Mahmoodi
 * ========================================================================== */
"use strict";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const VHDL_IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const VHDL_FILE_RE = /^[A-Za-z][A-Za-z0-9_]*\.(vhd|vhdl)$/i;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch (_) { return iso; }
}

async function copyToClipboard(text, successMsg) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(successMsg || "Copied to clipboard");
  } catch (err) {
    toast("Clipboard copy failed: " + err.message, true);
  }
}

/* ------------------------------------------------------------------ *
 * Code Generation & Port Parsing
 * ------------------------------------------------------------------ */
function portType(p) {
  return p.vector
    ? `std_logic_vector(${p.msb} downto ${p.lsb})`
    : "std_logic";
}

function genDesignSkeleton(cfg) {
  const author = (cfg.author || state.project?.author || "").trim() || "(Unspecified)";
  const dateStr = cfg.date || cfg.created || state.project?.created || new Date().toISOString().slice(0, 10);
  const std = cfg.standard || state.project?.standard || "08";
  const stdLabel = `VHDL-${std === "08" ? "2008" : std.toUpperCase()}`;

  const L = [];
  L.push("----------------------------------------------------------------------------------");
  L.push(`-- Project Name : ${cfg.projectName || state.project?.name || cfg.entity}`);
  L.push(`-- Module Name  : ${cfg.filename || `${cfg.entity}.vhd`}`);
  L.push(`-- Entity Name  : ${cfg.entity}`);
  L.push(`-- Architecture : ${cfg.architecture || "Behavioral"}`);
  L.push(`-- Target Lang  : ${stdLabel}`);
  L.push(`-- Engineer     : ${author}`);
  L.push(`-- Create Date  : ${dateStr}`);
  L.push("-- Tool Versions: GHDL 6.0.0");
  L.push("----------------------------------------------------------------------------------");
  L.push("");
  L.push("library ieee;");
  L.push("use ieee.std_logic_1164.all;");
  L.push("use ieee.numeric_std.all;");
  L.push("");
  L.push(`entity ${cfg.entity} is`);
  if (cfg.ports && cfg.ports.length) {
    L.push("  port (");
    const lines = cfg.ports.map(p =>
      `    ${p.name.padEnd(12)} : ${p.dir.padEnd(5)} ${portType(p)}`);
    L.push(lines.join(";\n"));
    L.push("  );");
  } else {
    L.push("  -- no ports declared");
  }
  L.push(`end entity ${cfg.entity};`);
  L.push("");
  L.push(`architecture ${cfg.architecture || "Behavioral"} of ${cfg.entity} is`);
  L.push("begin");
  L.push("");
  L.push("  -- design implementation goes here");
  L.push("");
  L.push(`end architecture ${cfg.architecture || "Behavioral"};`);
  return L.join("\n") + "\n";
}

function parseEntityPorts(vhdlCode) {
  const m = /\bentity\s+[A-Za-z][A-Za-z0-9_]*\s+is[\s\S]*?\bport\s*\(([\s\S]*?)\)\s*;/i
    .exec(vhdlCode || "");
  if (!m) return [];
  const cleaned = m[1]
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const ports = [];
  for (const chunk of cleaned.split(";")) {
    const pm = /^\s*([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*)\s*:\s*(in|out|inout|buffer)\s+(.+)$/i
      .exec(chunk.trim());
    if (!pm) continue;
    const names = pm[1].split(",").map(s => s.trim());
    const dir = pm[2].toLowerCase();
    const type = pm[3].trim();
    const vector = /std_logic_vector/i.test(type);
    let msb = 7, lsb = 0;
    const rm = /\(\s*(\d+)\s+(?:downto|to)\s+(\d+)\s*\)/i.exec(type);
    if (rm) { msb = parseInt(rm[1], 10); lsb = parseInt(rm[2], 10); }
    names.forEach(name => ports.push({ name, dir, vector, msb, lsb }));
  }
  return ports;
}

function genTestbenchSkeleton(dutEntity, dutCode, clockPeriodStr, cfg = {}) {
  const tbEntity = `tb_${dutEntity}`;
  let ports = parseEntityPorts(dutCode);
  const maps = ports.map(p => `      ${p.name.padEnd(10)} => ${p.name}`);
  const sigs = ports.map(p =>
    `  signal ${p.name.padEnd(10)} : ${portType(p)} := ${p.vector ? `(others => '0')` : "'0'"};`);
  const clkPeriod = clockPeriodStr || "10 ns";
  const author = (cfg.author || state.project?.author || "").trim() || "(Unspecified)";
  const dateStr = cfg.date || cfg.created || state.project?.created || new Date().toISOString().slice(0, 10);
  const std = cfg.standard || state.project?.standard || "08";
  const stdLabel = `VHDL-${std === "08" ? "2008" : std.toUpperCase()}`;

  const L = [];
  L.push("----------------------------------------------------------------------------------");
  L.push(`-- Project Name : ${cfg.projectName || state.project?.name || dutEntity}`);
  L.push(`-- Testbench For: ${dutEntity}`);
  L.push(`-- Module Name  : ${tbEntity}.vhd`);
  L.push(`-- Entity Name  : ${tbEntity}`);
  L.push(`-- Target Lang  : ${stdLabel}`);
  L.push(`-- Engineer     : ${author}`);
  L.push(`-- Create Date  : ${dateStr}`);
  L.push("-- Tool Versions: GHDL 6.0.0");
  L.push("----------------------------------------------------------------------------------");
  L.push("");
  L.push("library ieee;");
  L.push("use ieee.std_logic_1164.all;");
  L.push("use ieee.numeric_std.all;");
  L.push("");
  L.push(`entity ${tbEntity} is`);
  L.push(`end entity ${tbEntity};`);
  L.push("");
  L.push(`architecture sim of ${tbEntity} is`);
  L.push("");
  L.push(`  -- clock period constant`);
  L.push(`  constant CLK_PERIOD : time := ${clkPeriod};`);
  L.push("");
  L.push("  -- internal interconnect & stimulus signals");
  if (sigs.length) L.push(sigs.join("\n"));
  L.push("");
  L.push("begin");
  L.push("");
  L.push("  -- instantiate unit under test (DUT)");
  L.push(`  dut : entity work.${dutEntity}`);
  if (ports.length) {
    L.push("    port map (");
    L.push(maps.join(",\n"));
    L.push("    );");
  } else {
    L.push("    ;");
  }
  L.push("");

  const hasClk = ports.some(p => /clk|clock/i.test(p.name) && p.dir === "in");
  if (hasClk) {
    L.push("  -- clock generator process");
    L.push("  clk_gen : process");
    L.push("  begin");
    L.push("    clk <= '0';");
    L.push("    wait for CLK_PERIOD / 2;");
    L.push("    clk <= '1';");
    L.push("    wait for CLK_PERIOD / 2;");
    L.push("  end process clk_gen;");
    L.push("");
  }

  L.push("  -- stimulus process: drive input vectors");
  L.push("  stim_proc : process");
  L.push("  begin");
  const ins = ports.filter(p => p.dir === "in" && !/clk|clock/i.test(p.name));
  if (ins.length) {
    L.push("    -- initial stimulus state");
    ins.forEach(p => L.push(`    ${p.name} <= ${p.vector ? `(others => '0')` : "'0'"};`));
    L.push("    wait for 20 ns;");
    L.push("");
  }
  L.push("    -- TODO: Add verification stimulus vectors here");
  L.push("    wait for 100 ns;");
  L.push("");
  L.push("    wait; -- simulation complete");
  L.push("  end process stim_proc;");
  L.push("");
  L.push(`end architecture sim;`);
  return L.join("\n") + "\n";
}

function genComponentDeclSnippet(entity, ports) {
  const pLines = (ports || []).map(p =>
    `      ${p.name.padEnd(12)} : ${p.dir.padEnd(5)} ${portType(p)}`);
  const pBlock = pLines.length ? `    port (\n${pLines.join(";\n")}\n    );` : "    -- no ports";
  return (
    `  -- Component declaration for ${entity}\n` +
    `  component ${entity} is\n` +
    `${pBlock}\n` +
    `  end component ${entity};`
  );
}

function genPortMapSnippet(entity, ports, instName) {
  const inst = instName || `U_${entity}`;
  const mLines = (ports || []).map(p => `      ${p.name.padEnd(12)} => ${p.name}`);
  const mBlock = mLines.length ? `    port map (\n${mLines.join(",\n")}\n    );` : "    ;";
  return (
    `  -- Instance port map for ${entity}\n` +
    `  ${inst} : ${entity}\n` +
    `${mBlock}`
  );
}

/* ------------------------------------------------------------------ *
 * Application State
 * ------------------------------------------------------------------ */
const state = {
  screen: "welcome",        // welcome | app
  project: null,            // normalized project object
  openTabs: [],             // array of open filenames, e.g. ["half_adder.vhd"]
  activeFile: null,         // current filename showing in editor
  busy: false,
  design_ok: false,
  tb_ok: false,
  waveDocs: null,
  dirty: false,
  fontSize: 13.5,
};

let cm = null;              // single active CodeMirror instance
const fileDocs = new Map(); // filename -> CodeMirror.Doc

/* ------------------------------------------------------------------ *
 * Toast, Console & Status Indicators
 * ------------------------------------------------------------------ */
let toastTimer = null;
function toast(msg, isError) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle("err", !!isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function setStatus(kind, text) {
  $("dot").className = "dot " + kind;
  $("statusText").textContent = text;
}

function consoleLine(level, text) {
  const div = document.createElement("div");
  div.className = "c-line c-" + level;
  const m = /^(.+?):(\d+):(\d+):\s*(.*)$/.exec(text);
  if (m && /\.(vhd|vhdl)$/i.test(m[1])) {
    const loc = document.createElement("span");
    loc.className = "c-loc";
    loc.textContent = `${m[1]}:${m[2]}:${m[3]}:`;
    loc.title = "Click to jump to this line in editor";
    loc.addEventListener("click", () => jumpToLine(m[1], Number(m[2])));
    div.appendChild(loc);
    div.appendChild(document.createTextNode(" " + m[4]));
  } else {
    div.textContent = text;
  }
  const c = $("console");
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}

function renderLog(log) {
  (log || []).forEach(e => consoleLine(e.level, e.text));
}

function jumpToLine(filename, line) {
  const fn = (filename || "").toLowerCase();
  const fileObj = state.project?.files?.find(f => f.filename.toLowerCase() === fn);
  if (fileObj) {
    switchToFile(fileObj.filename);
  }
  if (!cm) return;
  const ln = Math.max(0, Math.min(line - 1, cm.lineCount() - 1));
  cm.scrollIntoView({ line: ln, ch: 0 }, cm.getScrollInfo().clientHeight / 3);
  cm.setCursor({ line: ln, ch: 0 });
  cm.focus();
}

/* ------------------------------------------------------------------ *
 * CodeMirror Editor & Document Management
 * ------------------------------------------------------------------ */
function clearDocErrors(doc) {
  if (!doc) return;
  doc.cm?.clearGutter("error-gutter");
  for (let i = 0; i < doc.lineCount(); i++) {
    doc.removeLineClass(i, "background", "cm-error-line");
  }
  if (doc._errorMarks) {
    doc._errorMarks.forEach(m => m.clear());
    doc._errorMarks = [];
  }
}

function markDocError(doc, line, col, message) {
  if (!doc) return;
  const ln = Math.max(0, Math.min(line - 1, doc.lineCount() - 1));
  const marker = document.createElement("span");
  marker.className = "err-gutter-marker";
  marker.innerHTML = "&times;";
  marker.title = message;
  doc.setGutterMarker(ln, "error-gutter", marker);
  doc.addLineClass(ln, "background", "cm-error-line");

  if (!doc._errorMarks) doc._errorMarks = [];
  const lineText = doc.getLine(ln) || "";
  const startCh = Math.max(0, (col ? col - 1 : 0));
  const endCh = Math.min(lineText.length, startCh > 0 ? startCh + 6 : lineText.length || 1);
  const mark = doc.markText(
    { line: ln, ch: startCh },
    { line: ln, ch: Math.max(endCh, startCh + 1) },
    { className: "cm-error-text", title: message }
  );
  doc._errorMarks.push(mark);
}

function getFileDoc(fileObj) {
  if (fileDocs.has(fileObj.filename)) {
    return fileDocs.get(fileObj.filename);
  }
  const doc = new CodeMirror.Doc(fileObj.code || "", "vhdl");
  doc.on("change", () => {
    fileObj.code = doc.getValue();
    fileObj.dirty = true;
    state.dirty = true;
    state.design_ok = false;
    state.tb_ok = false;
    clearDocErrors(doc);
    renderEditorTabs();
    scheduleAutoSave();
    gateWorkflow();
  });
  doc.on("cursorActivity", () => updateCursorPos(doc));
  fileDocs.set(fileObj.filename, doc);
  return doc;
}

function switchToFile(filename) {
  if (!state.project) return;
  const fileObj = state.project.files.find(f => f.filename === filename);
  if (!fileObj) return;

  if (!state.openTabs.includes(filename)) {
    state.openTabs.push(filename);
  }
  state.activeFile = filename;

  const doc = getFileDoc(fileObj);
  cm.swapDoc(doc);
  cm.refresh();
  cm.focus();

  updateEditorInfo();
  updateCursorPos(doc);
  renderEditorTabs();
  renderProjectNavigator();
}

function closeFileTab(filename, ev) {
  if (ev) ev.stopPropagation();
  const idx = state.openTabs.indexOf(filename);
  if (idx < 0) return;
  state.openTabs.splice(idx, 1);

  if (state.activeFile === filename) {
    if (state.openTabs.length > 0) {
      const nextIdx = Math.max(0, idx - 1);
      switchToFile(state.openTabs[nextIdx]);
    } else if (state.project.files.length > 0) {
      switchToFile(state.project.files[0].filename);
    } else {
      state.activeFile = null;
      cm.swapDoc(new CodeMirror.Doc("-- No open files in project\n", "vhdl"));
    }
  }
  renderEditorTabs();
}

function updateCursorPos(doc) {
  const pos = doc ? doc.getCursor() : cm?.getCursor();
  if (!pos) return;
  const el = $("editorCursorPos");
  if (el) el.textContent = `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
}

function updateEditorInfo() {
  const info = $("editorInfo");
  if (!info || !state.project || !state.activeFile) {
    if (info) info.textContent = "";
    return;
  }
  const fileObj = state.project.files.find(f => f.filename === state.activeFile);
  const n = cm ? cm.lineCount() : 0;
  info.textContent = `${n} lines · ${fileObj?.type === "simulation" ? "Testbench" : "Design Source"} · ${state.activeFile}`;
}

function setFontSize(px) {
  state.fontSize = Math.max(9, Math.min(28, px));
  if (cm) {
    cm.getWrapperElement().style.fontSize = state.fontSize + "px";
    cm.refresh();
  }
  $("fontVal").textContent =
    (state.fontSize % 1 ? state.fontSize.toFixed(1) : state.fontSize) + "px";
}

let autoSaveTimer = null;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (state.project && state.dirty) {
      saveProject(false);
    }
  }, 2000);
}

function makeCM(textarea) {
  const cmInstance = CodeMirror.fromTextArea(textarea, {
    mode: "vhdl",
    theme: "dracula",
    lineNumbers: true,
    gutters: ["CodeMirror-linenumbers", "error-gutter"],
    lineWrapping: false,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: true,
    extraKeys: {
      "Ctrl-S": () => saveProject(true),
      "Cmd-S": () => saveProject(true),
      "Ctrl-/": cm => cm.toggleComment(),
      "Cmd-/": cm => cm.toggleComment(),
      "Shift-Alt-F": () => formatCurrentEditor(),
      "F7": () => runCheckSyntax(),
      "Ctrl-B": () => runCheckSyntax(),
      "F5": () => runSimulate(),
      "Ctrl-Enter": () => runSimulate(),
    },
  });

  cmInstance.getWrapperElement().addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setFontSize(state.fontSize + (e.deltaY < 0 ? 0.5 : -0.5));
  }, { passive: false });

  return cmInstance;
}

function initEditor() {
  cm = makeCM($("codeEditor"));
  setFontSize(state.fontSize);
  const savedTheme = localStorage.getItem("vhdl_theme") || "dracula";
  applyTheme(savedTheme);
}

/* ------------------------------------------------------------------ *
 * Dynamic Tab Strip Rendering
 * ------------------------------------------------------------------ */
function renderEditorTabs() {
  const bar = $("editorTabs");
  if (!bar || !state.project) return;
  bar.innerHTML = "";

  state.openTabs.forEach(filename => {
    const fileObj = state.project.files.find(f => f.filename === filename);
    if (!fileObj) return;

    const isActive = filename === state.activeFile;
    const isTb = fileObj.type === "simulation";

    const tab = document.createElement("div");
    tab.className = `editor-tab ${isActive ? "active" : ""}`;
    tab.title = `${fileObj.filename} (${fileObj.entity})`;

    const iconSvg = isTb
      ? `<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 12l3-8 3 5 2-3 4 6z" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>`
      : `<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2 1.5 8 4 14M12 2l2.5 6L12 14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    tab.innerHTML = `
      ${iconSvg}
      <span class="editor-tab-name">${esc(fileObj.filename)}</span>
      <span class="unsaved-dot ${fileObj.dirty ? "dirty" : ""}"></span>
      <span class="editor-tab-close" title="Close tab">&times;</span>
    `;

    tab.addEventListener("click", () => switchToFile(filename));
    tab.querySelector(".editor-tab-close").addEventListener("click", (e) => closeFileTab(filename, e));
    bar.appendChild(tab);
  });
}

/* ------------------------------------------------------------------ *
 * Project Navigator Tree & Context Menu
 * ------------------------------------------------------------------ */
let contextTargetFile = null;

function parseModuleInstances(vhdlCode, allDesignFiles) {
  if (!vhdlCode || !allDesignFiles || !allDesignFiles.length) return [];
  const instances = [];
  const seenInsts = new Set();
  const clean = vhdlCode.replace(/--[^\n]*/g, " ");

  const entityMap = new Map();
  allDesignFiles.forEach(f => {
    if (f.entity) entityMap.set(f.entity.toLowerCase(), f);
    const stem = f.filename.replace(/\.(vhd|vhdl)$/i, "").toLowerCase();
    entityMap.set(stem, f);
  });

  // 1. Direct entity instantiations: U1 : entity work.my_module
  const directRe = /\b([A-Za-z][A-Za-z0-9_]*)\s*:\s*entity\s+(?:work\.)?([A-Za-z][A-Za-z0-9_]*)\b/gi;
  let m;
  while ((m = directRe.exec(clean)) !== null) {
    const instName = m[1];
    const entName = m[2];
    const key = `${instName.toLowerCase()}_${entName.toLowerCase()}`;
    if (!seenInsts.has(key)) {
      seenInsts.add(key);
      const targetFile = entityMap.get(entName.toLowerCase()) || {
        filename: `${entName}.vhd`.toLowerCase(),
        entity: entName,
        type: "design"
      };
      instances.push({ instName, entityName: entName, file: targetFile });
    }
  }

  // 2. Component instantiations: U1 : my_module port map (
  const compRe = /\b([A-Za-z][A-Za-z0-9_]*)\s*:\s*([A-Za-z][A-Za-z0-9_]*)\s+(?:generic\s+map\s*\([\s\S]*?\)\s*)?port\s+map\b/gi;
  while ((m = compRe.exec(clean)) !== null) {
    const instName = m[1];
    const compName = m[2];
    const reserved = /^(process|block|generate|for|if|case|loop|component|entity|architecture|package)$/i;
    if (reserved.test(instName) || reserved.test(compName)) continue;
    const key = `${instName.toLowerCase()}_${compName.toLowerCase()}`;
    if (!seenInsts.has(key)) {
      seenInsts.add(key);
      const targetFile = entityMap.get(compName.toLowerCase()) || {
        filename: `${compName}.vhd`.toLowerCase(),
        entity: compName,
        type: "design"
      };
      instances.push({ instName, entityName: compName, file: targetFile });
    }
  }

  return instances;
}

function renderProjectNavigator() {
  const tree = $("navTree");
  if (!tree || !state.project) return;

  if ($("navInfoFolder")) {
    const fld = state.project.folder || state.project.name || "project";
    $("navInfoFolder").textContent = `projects/${fld}/`;
    $("navInfoFolder").title = `Files are saved in: projects/${fld}/`;
  }
  if ($("navInfoStd")) {
    const std = state.project.standard || "08";
    $("navInfoStd").textContent = `VHDL-${std === "08" ? "2008" : std.toUpperCase()}`;
  }

  tree.innerHTML = "";

  const filterText = ($("navFilter")?.value || "").trim().toLowerCase();

  const designFiles = (state.project.files || []).filter(f => f.type === "design");
  const simFiles = (state.project.files || []).filter(f => f.type === "simulation");

  const filteredDesign = filterText
    ? designFiles.filter(f => f.filename.toLowerCase().includes(filterText) || f.entity.toLowerCase().includes(filterText))
    : designFiles;
  const filteredSim = filterText
    ? simFiles.filter(f => f.filename.toLowerCase().includes(filterText) || f.entity.toLowerCase().includes(filterText))
    : simFiles;

  // Group 1: Design Sources (Hierarchical Vivado/ISE tree)
  const gDesign = document.createElement("div");
  gDesign.className = "tree-group";
  gDesign.innerHTML = `
    <div class="tree-group-head" title="VHDL Architecture &amp; Component Sources Hierarchy">
      <svg viewBox="0 0 16 16" width="11" height="11"><path d="M1.5 2.5h4l1.5 2h7.5v8.5h-13z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
      <span>Design Sources</span>
      <span class="tree-badge-count">${designFiles.length}</span>
    </div>
    <div class="tree-group-items" id="treeDesignItems"></div>
  `;
  const designItemsContainer = gDesign.querySelector("#treeDesignItems");
  if (filteredDesign.length === 0) {
    designItemsContainer.innerHTML = `<div class="tree-empty">No design modules</div>`;
  } else {
    if (filterText) {
      filteredDesign.forEach(f => {
        const isTop = (f.entity.toLowerCase() === (state.project.top_entity || "").toLowerCase()) ||
                      (f.filename.toLowerCase() === `${(state.project.top_entity || "").toLowerCase()}.vhd`);
        const isActive = f.filename === state.activeFile;
        const item = document.createElement("div");
        item.className = `tree-item ${isActive ? "active" : ""}`;
        item.innerHTML = `
          <svg class="tree-item-icon" viewBox="0 0 16 16" width="12" height="12"><path d="M4 2 1.5 8 4 14M12 2l2.5 6L12 14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="tree-item-name" title="${esc(f.filename)} (${esc(f.entity)})">${esc(f.filename)}</span>
          ${isTop ? '<span class="tree-badge-top" title="Top-Level Synthesis Entity">TOP</span>' : ""}
        `;
        item.addEventListener("click", () => switchToFile(f.filename));
        item.addEventListener("contextmenu", (e) => showContextMenu(e, f));
        designItemsContainer.appendChild(item);
      });
    } else {
      // Find Top-Level module
      const topEntityName = (state.project.top_entity || "").toLowerCase();
      const topFile = designFiles.find(f => (f.entity && f.entity.toLowerCase() === topEntityName) ||
                                            (f.filename && f.filename.toLowerCase() === `${topEntityName}.vhd`)) || designFiles[0];

      state.navExpanded = state.navExpanded || new Set();
      const hierarchicalSet = new Set();
      if (topFile) hierarchicalSet.add(topFile.filename.toLowerCase());

      function renderHierarchyTree(parentFile, container, visited) {
        if (!parentFile) return;
        const code = fileDocs.get(parentFile.filename)?.getValue() || parentFile.code || "";
        const instances = parseModuleInstances(code, designFiles);
        const hasChildren = instances.length > 0;
        const expandKey = `exp_${parentFile.filename}`;
        if (!state.navExpanded.has(`_init_${expandKey}`)) {
          state.navExpanded.add(`_init_${expandKey}`);
          state.navExpanded.add(expandKey); // default expanded
        }
        const isExpanded = state.navExpanded.has(expandKey);

        const isTop = parentFile === topFile;
        const isActive = parentFile.filename === state.activeFile;

        const row = document.createElement("div");
        row.className = `tree-item ${isActive ? "active" : ""}`;
        row.innerHTML = `
          ${hasChildren ? `<span class="tree-chevron ${isExpanded ? "expanded" : ""}">▶</span>` : `<span style="width:14px;flex:0 0 14px"></span>`}
          <svg class="tree-item-icon" viewBox="0 0 16 16" width="12" height="12"><path d="M4 2 1.5 8 4 14M12 2l2.5 6L12 14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="tree-item-name" title="${esc(parentFile.filename)} (${esc(parentFile.entity)})">${esc(parentFile.filename)}</span>
          ${isTop ? '<span class="tree-badge-top" title="Top-Level Synthesis Entity">TOP</span>' : ""}
        `;

        const chevron = row.querySelector(".tree-chevron");
        if (chevron) {
          chevron.addEventListener("click", (e) => {
            e.stopPropagation();
            if (state.navExpanded.has(expandKey)) state.navExpanded.delete(expandKey);
            else state.navExpanded.add(expandKey);
            renderProjectNavigator();
          });
        }
        row.addEventListener("click", () => switchToFile(parentFile.filename));
        row.addEventListener("contextmenu", (e) => showContextMenu(e, parentFile));
        container.appendChild(row);

        if (hasChildren && isExpanded) {
          const childrenCont = document.createElement("div");
          childrenCont.className = "tree-children-container";
          instances.forEach((inst, idx) => {
            const isLast = (idx === instances.length - 1);
            const instFile = inst.file;
            if (instFile) hierarchicalSet.add(instFile.filename.toLowerCase());

            const subRow = document.createElement("div");
            subRow.className = `tree-sub-item ${instFile?.filename === state.activeFile ? "active" : ""}`;
            subRow.innerHTML = `
              <span class="tree-branch-line">${isLast ? "└──" : "├──"}</span>
              <svg class="tree-item-icon" viewBox="0 0 16 16" width="11" height="11"><path d="M2 3h5v5H2zM9 3h5v5H9zM2 10h5v5H2zM9 10h5v5H9z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
              <span class="tree-sub-inst" title="Instance: ${esc(inst.instName)}">${esc(inst.instName)}:</span>
              <span class="tree-sub-entity" title="Entity: ${esc(inst.entityName)}">${esc(inst.entityName)}</span>
              <span class="tree-file-dim">(${esc(instFile?.filename || `${inst.entityName}.vhd`)})</span>
            `;
            subRow.addEventListener("click", () => {
              if (instFile) switchToFile(instFile.filename);
            });
            subRow.addEventListener("contextmenu", (e) => {
              if (instFile) showContextMenu(e, instFile);
            });
            childrenCont.appendChild(subRow);

            // Recursive sub-hierarchy if the child itself instantiates blocks
            if (instFile && !visited.has(instFile.filename.toLowerCase())) {
              const nextVisited = new Set(visited);
              nextVisited.add(instFile.filename.toLowerCase());
              const subCode = fileDocs.get(instFile.filename)?.getValue() || instFile.code || "";
              const grandChildren = parseModuleInstances(subCode, designFiles);
              if (grandChildren.length > 0) {
                const subExpKey = `exp_${inst.instName}_${instFile.filename}`;
                if (!state.navExpanded.has(`_init_${subExpKey}`)) {
                  state.navExpanded.add(`_init_${subExpKey}`);
                  state.navExpanded.add(subExpKey);
                }
                const isSubExp = state.navExpanded.has(subExpKey);
                const subChildrenCont = document.createElement("div");
                subChildrenCont.className = "tree-children-container";
                if (isSubExp) {
                  grandChildren.forEach((gc, gcIdx) => {
                    const gcLast = (gcIdx === grandChildren.length - 1);
                    if (gc.file) hierarchicalSet.add(gc.file.filename.toLowerCase());
                    const gcRow = document.createElement("div");
                    gcRow.className = `tree-sub-item ${gc.file?.filename === state.activeFile ? "active" : ""}`;
                    gcRow.innerHTML = `
                      <span class="tree-branch-line">${gcLast ? "└──" : "├──"}</span>
                      <svg class="tree-item-icon" viewBox="0 0 16 16" width="10" height="10"><path d="M2 3h5v5H2zM9 3h5v5H9zM2 10h5v5H2zM9 10h5v5H9z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
                      <span class="tree-sub-inst">${esc(gc.instName)}:</span>
                      <span class="tree-sub-entity">${esc(gc.entityName)}</span>
                    `;
                    gcRow.addEventListener("click", () => { if (gc.file) switchToFile(gc.file.filename); });
                    gcRow.addEventListener("contextmenu", (e) => { if (gc.file) showContextMenu(e, gc.file); });
                    subChildrenCont.appendChild(gcRow);
                  });
                  childrenCont.appendChild(subChildrenCont);
                }
              }
            }
          });
          container.appendChild(childrenCont);
        }
      }

      // 1. Render Top Hierarchy Tree
      if (topFile) {
        const visited = new Set([topFile.filename.toLowerCase()]);
        renderHierarchyTree(topFile, designItemsContainer, visited);
      }

      // 2. Render any unreferenced / standalone design files
      const unreferenced = designFiles.filter(f => !hierarchicalSet.has(f.filename.toLowerCase()));
      if (unreferenced.length > 0) {
        const unrefHead = document.createElement("div");
        unrefHead.className = "dim sm-text";
        unrefHead.style.cssText = "padding:6px 10px 2px 14px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;";
        unrefHead.textContent = "Unreferenced Design Modules";
        designItemsContainer.appendChild(unrefHead);

        unreferenced.forEach(f => {
          const item = document.createElement("div");
          item.className = `tree-item ${f.filename === state.activeFile ? "active" : ""}`;
          item.innerHTML = `
            <svg class="tree-item-icon" viewBox="0 0 16 16" width="12" height="12"><path d="M4 2 1.5 8 4 14M12 2l2.5 6L12 14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="tree-item-name" title="${esc(f.filename)} (${esc(f.entity)})">${esc(f.filename)}</span>
          `;
          item.addEventListener("click", () => switchToFile(f.filename));
          item.addEventListener("contextmenu", (e) => showContextMenu(e, f));
          designItemsContainer.appendChild(item);
        });
      }
    }
  }
  tree.appendChild(gDesign);

  // Group 2: Simulation Sources
  const gSim = document.createElement("div");
  gSim.className = "tree-group";
  gSim.innerHTML = `
    <div class="tree-group-head" title="Testbench verification sources">
      <svg viewBox="0 0 16 16" width="11" height="11"><path d="M2 12l3-8 3 5 2-3 4 6z" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>
      <span>Simulation Sources</span>
      <span class="tree-badge-count">${simFiles.length}</span>
    </div>
    <div class="tree-group-items" id="treeSimItems"></div>
  `;
  const simItemsContainer = gSim.querySelector("#treeSimItems");
  if (filteredSim.length === 0) {
    simItemsContainer.innerHTML = `<div class="tree-empty">No testbenches</div>`;
  } else {
    filteredSim.forEach(f => {
      const isActiveTb = (f.filename.toLowerCase() === (state.project.active_tb || "").toLowerCase());
      const isActive = f.filename === state.activeFile;
      const item = document.createElement("div");
      item.className = `tree-item ${isActive ? "active" : ""}`;
      item.innerHTML = `
        <svg class="tree-item-icon" viewBox="0 0 16 16" width="12" height="12"><path d="M2 12l3-8 3 5 2-3 4 6z" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>
        <span class="tree-item-name" title="${esc(f.filename)} (${esc(f.entity)})">${esc(f.filename)}</span>
        ${isActiveTb ? '<span class="tree-badge-tb" title="Active Target Testbench">ACTIVE TB</span>' : ""}
      `;
      item.addEventListener("click", () => switchToFile(f.filename));
      item.addEventListener("contextmenu", (e) => showContextMenu(e, f));
      simItemsContainer.appendChild(item);
    });
  }
  tree.appendChild(gSim);

  // Background contextmenu
  tree.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".tree-item")) return;
    showContextMenu(e, null);
  });
}

function showContextMenu(e, fileObj) {
  e.preventDefault();
  contextTargetFile = fileObj;
  const menu = $("navContextMenu");
  if (!menu) return;

  const isDesign = fileObj && fileObj.type === "design";
  const isSim = fileObj && fileObj.type === "simulation";

  $("ctxSetTop").style.display = isDesign ? "flex" : "none";
  $("ctxSetActiveTb").style.display = isSim ? "flex" : "none";
  $("ctxSimulateThis").style.display = isSim ? "flex" : "none";
  $("ctxGenTb").style.display = isDesign ? "flex" : "none";
  $("ctxCopyComponent").style.display = isDesign ? "flex" : "none";
  $("ctxCopyMap").style.display = isDesign ? "flex" : "none";
  $("ctxRename").style.display = fileObj ? "flex" : "none";
  $("ctxDelete").style.display = fileObj ? "flex" : "none";
  $("ctxSep1").style.display = (isDesign || isSim) ? "block" : "none";
  $("ctxSep2").style.display = fileObj ? "block" : "none";

  menu.style.left = `${Math.min(window.innerWidth - 240, e.clientX)}px`;
  menu.style.top = `${Math.min(window.innerHeight - 300, e.clientY)}px`;
  menu.classList.remove("hidden");
}

function hideContextMenu() {
  $("navContextMenu")?.classList.add("hidden");
  contextTargetFile = null;
}

function wireContextMenu() {
  window.addEventListener("click", hideContextMenu);

  $("ctxSetTop")?.addEventListener("click", () => {
    if (!contextTargetFile || !state.project) return;
    state.project.top_entity = contextTargetFile.entity;
    toast(`"${contextTargetFile.entity}" set as Top-Level Module`);
    renderProjectNavigator();
    saveProject(false);
  });

  $("ctxSetActiveTb")?.addEventListener("click", () => {
    if (!contextTargetFile || !state.project) return;
    state.project.active_tb = contextTargetFile.filename;
    syncSimTargetDropdown();
    toast(`"${contextTargetFile.filename}" set as Active Testbench`);
    renderProjectNavigator();
    gateWorkflow();
    saveProject(false);
  });

  $("ctxSimulateThis")?.addEventListener("click", () => {
    if (!contextTargetFile || !state.project) return;
    state.project.active_tb = contextTargetFile.filename;
    syncSimTargetDropdown();
    renderProjectNavigator();
    runSimulate();
  });

  $("ctxGenTb")?.addEventListener("click", () => {
    if (!contextTargetFile) return;
    openAddSourceModal("simulation", contextTargetFile.entity);
  });

  $("ctxCopyComponent")?.addEventListener("click", () => {
    if (!contextTargetFile) return;
    const ports = parseEntityPorts(contextTargetFile.code) || contextTargetFile.ports || [];
    const snippet = genComponentDeclSnippet(contextTargetFile.entity, ports);
    copyToClipboard(snippet, `Component declaration for "${contextTargetFile.entity}" copied`);
  });

  $("ctxCopyMap")?.addEventListener("click", () => {
    if (!contextTargetFile) return;
    const ports = parseEntityPorts(contextTargetFile.code) || contextTargetFile.ports || [];
    const snippet = genPortMapSnippet(contextTargetFile.entity, ports);
    copyToClipboard(snippet, `Port map instantiation for "${contextTargetFile.entity}" copied`);
  });

  $("ctxAddSource")?.addEventListener("click", () => {
    openAddSourceModal("design");
  });

  $("ctxRename")?.addEventListener("click", () => {
    if (!contextTargetFile) return;
    openRenameModal(contextTargetFile);
  });

  $("ctxDelete").addEventListener("click", () => {
    if (!contextTargetFile || !state.project) return;
    const fn = contextTargetFile.filename;
    if (!confirm(`Delete source file "${fn}" from project? This cannot be undone.`)) return;

    state.project.files = state.project.files.filter(f => f.filename !== fn);
    fileDocs.delete(fn);

    if (state.project.top_entity === contextTargetFile.entity) {
      const remainingDesign = state.project.files.find(f => f.type === "design");
      state.project.top_entity = remainingDesign ? remainingDesign.entity : "";
    }
    if (state.project.active_tb === fn) {
      const remainingSim = state.project.files.find(f => f.type === "simulation");
      state.project.active_tb = remainingSim ? remainingSim.filename : "";
    }

    closeFileTab(fn);
    syncSimTargetDropdown();
    renderProjectNavigator();
    gateWorkflow();
    saveProject(false);
    toast(`Deleted "${fn}"`);
  });
}

/* ------------------------------------------------------------------ *
 * Target Testbench Dropdown & Workflow Gating
 * ------------------------------------------------------------------ */
function syncSimTargetDropdown() {
  const sel = $("selSimTarget");
  if (!sel || !state.project) return;
  sel.innerHTML = "";

  const simFiles = (state.project.files || []).filter(f => f.type === "simulation");
  if (simFiles.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No Testbench";
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
    return;
  }

  simFiles.forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.filename;
    opt.textContent = f.filename;
    if (f.filename === state.project.active_tb) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  });

  if (!state.project.active_tb && simFiles.length > 0) {
    state.project.active_tb = simFiles[0].filename;
    sel.value = simFiles[0].filename;
  }
}

function wireSimTargetDropdown() {
  const sel = $("selSimTarget");
  if (!sel) return;
  sel.addEventListener("change", () => {
    if (!state.project) return;
    state.project.active_tb = sel.value;
    renderProjectNavigator();
    gateWorkflow();
    saveProject(false);
    toast(`Active testbench set to ${sel.value}`);
  });
}

function gateWorkflow() {
  const p = state.project;
  if (!p) return;
  const hasTb = !!(p.active_tb && p.files.some(f => f.type === "simulation" && f.filename === p.active_tb));
  const simReady = hasTb;
  $("btnSim").classList.toggle("sim-hidden", !simReady);
}

/* ------------------------------------------------------------------ *
 * Add Source Modal (Design Module vs Simulation Testbench)
 * ------------------------------------------------------------------ */
const addSourcePortRows = [];

function makeAddSourcePortRow(initial) {
  const row = document.createElement("div");
  row.className = "port-row";
  row.innerHTML = `
    <input class="pname" placeholder="port_name" spellcheck="false" autocomplete="off">
    <select class="pdir">
      <option value="in">in</option>
      <option value="out">out</option>
      <option value="inout">inout</option>
    </select>
    <span class="check"><input type="checkbox" class="pvec" title="Define as std_logic_vector"></span>
    <span class="prange">
      <input class="pmsb" value="7" disabled title="MSB">
      <span class="sep">:</span>
      <input class="plsb" value="0" disabled title="LSB">
    </span>
    <span class="ptype">std_logic</span>
    <button class="icon-btn pdel" title="Remove port">
      <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>`;

  const $r = (cls) => row.querySelector("." + cls);
  const nameEl = $r("pname"), dirEl = $r("pdir"), vecEl = $r("pvec");
  const msbEl = $r("pmsb"), lsbEl = $r("plsb"), typeEl = $r("ptype");

  if (initial) {
    nameEl.value = initial.name || "";
    dirEl.value = initial.dir || "in";
    vecEl.checked = !!initial.vector;
    msbEl.value = initial.msb ?? 7;
    lsbEl.value = initial.lsb ?? 0;
  }

  function refreshType() {
    const on = vecEl.checked;
    msbEl.disabled = !on;
    lsbEl.disabled = !on;
    typeEl.textContent = on ? `slv(${msbEl.value}:${lsbEl.value})` : "std_logic";
  }
  vecEl.addEventListener("change", () => { refreshType(); refreshAddSourcePreview(); });
  [msbEl, lsbEl].forEach(el => el.addEventListener("input", () => { refreshType(); refreshAddSourcePreview(); }));
  [nameEl, dirEl].forEach(el => el.addEventListener("input", refreshAddSourcePreview));
  row.querySelector(".pdel").addEventListener("click", () => {
    const idx = addSourcePortRows.indexOf(api);
    if (idx >= 0) addSourcePortRows.splice(idx, 1);
    row.remove();
    refreshAddSourcePreview();
  });

  refreshType();
  const api = {
    el: row,
    read() {
      const name = nameEl.value.trim();
      if (!name) return { skip: true };
      if (!VHDL_IDENT.test(name)) return null;
      const vector = vecEl.checked;
      let msb = 7, lsb = 0;
      if (vector) {
        msb = parseInt(msbEl.value, 10);
        lsb = parseInt(lsbEl.value, 10);
        if (!Number.isFinite(msb) || !Number.isFinite(lsb) || msb < 0 || lsb < 0) return null;
        if (msb < lsb) { const t = msb; msb = lsb; lsb = t; }
      }
      return { name, dir: dirEl.value, vector, msb, lsb };
    },
  };
  return api;
}

function addPortRowToAddSource(initial) {
  const api = makeAddSourcePortRow(initial);
  $("addDesignPortRows").appendChild(api.el);
  addSourcePortRows.push(api);
}

function refreshAddSourcePreview() {
  const isDesign = $("radioTypeDesign").checked;
  $("addDesignForm").classList.toggle("hidden", !isDesign);
  $("addSimForm").classList.toggle("hidden", isDesign);

  if (isDesign) {
    const entity = $("addDesignEntity").value.trim();
    const architecture = $("addDesignArch").value.trim() || "Behavioral";
    const ports = [];
    let err = "";
    if (entity && !VHDL_IDENT.test(entity)) err = "Entity name must be a valid VHDL identifier.";
    if (architecture && !VHDL_IDENT.test(architecture)) err = err || "Invalid architecture name.";
    addSourcePortRows.forEach(r => {
      if (err) return;
      const p = r.read();
      if (p === null) { err = "Invalid port specification."; return; }
      if (!p.skip) ports.push(p);
    });
    $("addSourcePreview").textContent = genDesignSkeleton({
      projectName: state.project?.name,
      entity: entity || "my_module",
      architecture,
      standard: state.project?.standard,
      author: state.project?.author,
      ports,
    });
    $("addSourceError").textContent = err;
    $("addSourceSubmit").disabled = !!err || !entity;
  } else {
    const dutSelect = $("addSimDutSelect");
    const selectedDut = dutSelect.value;
    const dutObj = state.project?.files?.find(f => f.entity === selectedDut || f.filename === selectedDut);
    const tbEntity = $("addSimEntity").value.trim() || `tb_${selectedDut || "dut"}`;
    const clkPeriod = $("addSimClockPeriod").value.trim() || "10 ns";

    let err = "";
    if (!selectedDut) err = "Please select a target Device Under Test (DUT).";
    if (tbEntity && !VHDL_IDENT.test(tbEntity)) err = "Testbench entity name must be a valid identifier.";

    $("addSourcePreview").textContent = genTestbenchSkeleton(
      selectedDut || "my_design",
      dutObj?.code || "",
      clkPeriod,
      {
        projectName: state.project?.name,
        author: state.project?.author,
        standard: state.project?.standard,
      }
    );
    $("addSourceError").textContent = err;
    $("addSourceSubmit").disabled = !!err || !selectedDut;
  }
}

function openAddSourceModal(defaultType, preselectedDut) {
  if (!state.project) return;
  $("addSourceModal").classList.remove("hidden");
  addSourcePortRows.length = 0;
  $("addDesignPortRows").innerHTML = "";

  if (defaultType === "simulation") {
    $("radioTypeSim").checked = true;
  } else {
    $("radioTypeDesign").checked = true;
  }

  $("addDesignEntity").value = "";
  $("addDesignArch").value = "Behavioral";
  addPortRowToAddSource({ name: "clk", dir: "in", vector: false });
  addPortRowToAddSource({ name: "data_out", dir: "out", vector: true, msb: 7, lsb: 0 });

  // Populate DUT selector
  const dutSelect = $("addSimDutSelect");
  dutSelect.innerHTML = "";
  const designFiles = (state.project.files || []).filter(f => f.type === "design");
  designFiles.forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.entity;
    opt.textContent = `${f.entity} (${f.filename})`;
    if (preselectedDut && f.entity.toLowerCase() === preselectedDut.toLowerCase()) {
      opt.selected = true;
    }
    dutSelect.appendChild(opt);
  });

  const activeDut = dutSelect.value;
  $("addSimEntity").value = activeDut ? `tb_${activeDut}` : "tb_design";
  $("addSimClockPeriod").value = "10 ns";

  refreshAddSourcePreview();
  if (defaultType === "simulation") {
    setTimeout(() => $("addSimEntity").focus(), 50);
  } else {
    setTimeout(() => $("addDesignEntity").focus(), 50);
  }
}

function closeAddSourceModal() {
  $("addSourceModal").classList.add("hidden");
}

function submitAddSource() {
  if (!state.project) return;
  const isDesign = $("radioTypeDesign").checked;

  if (isDesign) {
    const entity = $("addDesignEntity").value.trim();
    const architecture = $("addDesignArch").value.trim() || "Behavioral";
    const filename = `${entity}.vhd`.toLowerCase();

    if (state.project.files.some(f => f.filename.toLowerCase() === filename)) {
      $("addSourceError").textContent = `File "${filename}" already exists in project.`;
      return;
    }

    const ports = [];
    for (const r of addSourcePortRows) {
      const p = r.read();
      if (p === null) { $("addSourceError").textContent = "Invalid port specification."; return; }
      if (!p.skip) ports.push(p);
    }

    const code = genDesignSkeleton({
      projectName: state.project.name,
      entity,
      architecture,
      standard: state.project.standard,
      author: state.project.author,
      ports,
    });

    const newFile = {
      filename,
      entity,
      type: "design",
      architecture,
      code,
      ports,
      dirty: true,
    };
    state.project.files.push(newFile);
    if (!state.project.top_entity) state.project.top_entity = entity;

    closeAddSourceModal();
    renderProjectNavigator();
    switchToFile(filename);
    saveProject(false);
    toast(`Design module "${filename}" added to project`);
  } else {
    const dut = $("addSimDutSelect").value;
    const dutObj = state.project.files.find(f => f.entity === dut || f.filename === dut);
    const tbEntity = $("addSimEntity").value.trim() || `tb_${dut}`;
    const filename = `${tbEntity}.vhd`.toLowerCase();

    if (state.project.files.some(f => f.filename.toLowerCase() === filename)) {
      $("addSourceError").textContent = `File "${filename}" already exists in project.`;
      return;
    }

    const clkPeriod = $("addSimClockPeriod").value.trim() || "10 ns";
    const code = genTestbenchSkeleton(dut, dutObj?.code || "", clkPeriod, {
      projectName: state.project.name,
      author: state.project.author,
      standard: state.project.standard,
    });

    const newFile = {
      filename,
      entity: tbEntity,
      type: "simulation",
      architecture: "sim",
      code,
      ports: [],
      dirty: true,
    };
    state.project.files.push(newFile);

    if ($("addSimAutoActive").checked || !state.project.active_tb) {
      state.project.active_tb = filename;
    }

    closeAddSourceModal();
    syncSimTargetDropdown();
    renderProjectNavigator();
    gateWorkflow();
    switchToFile(filename);
    saveProject(false);
    toast(`Testbench "${filename}" added to project`);
  }
}

function wireAddSourceModal() {
  $("btnNavAddSource")?.addEventListener("click", () => openAddSourceModal("design"));
  $("btnTabAdd")?.addEventListener("click", () => openAddSourceModal("design"));
  $("addSourceClose")?.addEventListener("click", closeAddSourceModal);
  $("addSourceCancel")?.addEventListener("click", closeAddSourceModal);
  $("addSourceSubmit")?.addEventListener("click", submitAddSource);
  $("radioTypeDesign")?.addEventListener("change", refreshAddSourcePreview);
  $("radioTypeSim")?.addEventListener("change", refreshAddSourcePreview);
  $("addDesignAddPort")?.addEventListener("click", () => {
    addPortRowToAddSource();
    refreshAddSourcePreview();
  });
  $("addDesignEntity")?.addEventListener("input", refreshAddSourcePreview);
  $("addDesignArch")?.addEventListener("input", refreshAddSourcePreview);
  $("addSimDutSelect")?.addEventListener("change", () => {
    const dut = $("addSimDutSelect")?.value;
    if ($("addSimEntity")) $("addSimEntity").value = dut ? `tb_${dut}` : "tb_design";
    refreshAddSourcePreview();
  });
  $("addSimEntity")?.addEventListener("input", refreshAddSourcePreview);
  $("addSimClockPeriod")?.addEventListener("input", refreshAddSourcePreview);
}

/* ------------------------------------------------------------------ *
 * Rename Modal
 * ------------------------------------------------------------------ */
let renameTargetFile = null;

function openRenameModal(fileObj) {
  renameTargetFile = fileObj;
  $("renameInput").value = fileObj.filename;
  $("renameError").textContent = "";
  $("renameModal").classList.remove("hidden");
  setTimeout(() => $("renameInput").focus(), 50);
}

function closeRenameModal() {
  $("renameModal").classList.add("hidden");
  renameTargetFile = null;
}

function submitRename() {
  if (!renameTargetFile || !state.project) return;
  let newName = $("renameInput").value.trim();
  if (!newName.endsWith(".vhd") && !newName.endsWith(".vhdl")) {
    newName += ".vhd";
  }
  newName = newName.toLowerCase();

  if (!VHDL_FILE_RE.test(newName)) {
    $("renameError").textContent = "Invalid filename. Must be valid VHDL identifier ending in .vhd";
    return;
  }
  if (newName !== renameTargetFile.filename && state.project.files.some(f => f.filename.toLowerCase() === newName)) {
    $("renameError").textContent = `A file named "${newName}" already exists in the project.`;
    return;
  }

  const oldName = renameTargetFile.filename;
  const newEntity = newName.replace(/\.(vhd|vhdl)$/i, "");
  const oldEntity = renameTargetFile.entity;

  renameTargetFile.filename = newName;

  if ($("renameUpdateEntity").checked && renameTargetFile.code) {
    const re = new RegExp(`\\b${oldEntity}\\b`, "gi");
    renameTargetFile.code = renameTargetFile.code.replace(re, newEntity);
    renameTargetFile.entity = newEntity;
    if (fileDocs.has(oldName)) {
      const doc = fileDocs.get(oldName);
      doc.setValue(renameTargetFile.code);
      fileDocs.delete(oldName);
      fileDocs.set(newName, doc);
    }
  }

  if (state.project.top_entity === oldEntity) {
    state.project.top_entity = renameTargetFile.entity;
  }
  if (state.project.active_tb === oldName) {
    state.project.active_tb = newName;
  }

  const tabIdx = state.openTabs.indexOf(oldName);
  if (tabIdx >= 0) state.openTabs[tabIdx] = newName;
  if (state.activeFile === oldName) state.activeFile = newName;

  closeRenameModal();
  syncSimTargetDropdown();
  renderEditorTabs();
  renderProjectNavigator();
  updateEditorInfo();
  saveProject(false);
  toast(`Renamed "${oldName}" to "${newName}"`);
}

function wireRenameModal() {
  $("renameClose").addEventListener("click", closeRenameModal);
  $("renameCancel").addEventListener("click", closeRenameModal);
  $("renameSubmit").addEventListener("click", submitRename);
  $("renameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitRename();
  });
}

/* ------------------------------------------------------------------ *
 * Project Navigator Resizer & Toggle
 * ------------------------------------------------------------------ */
function wireNavSplitter() {
  const splitter = $("navSplitter");
  const navPane = $("navPane");
  let isDragging = false;
  let startX = 0;
  let startW = 0;

  splitter.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.clientX;
    startW = navPane.getBoundingClientRect().width;
    splitter.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const w = Math.max(160, Math.min(550, startW + (e.clientX - startX)));
    navPane.style.width = `${w}px`;
    cm?.refresh();
  });

  window.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    splitter.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    cm?.refresh();
  });

  $("btnNavToggle")?.addEventListener("click", () => toggleNavPane(false));
  $("navCollapsedRibbon")?.addEventListener("click", () => toggleNavPane(true));
  $("btnHeaderNavToggle")?.addEventListener("click", () => toggleNavPane());

  $("navFilter").addEventListener("input", renderProjectNavigator);
}

function toggleNavPane(forceState) {
  const navPane = $("navPane");
  const ribbon = $("navCollapsedRibbon");
  const splitter = $("navSplitter");
  if (!navPane) return;
  const isCurrentlyCollapsed = navPane.classList.contains("collapsed");
  const nextCollapsed = typeof forceState === "boolean" ? !forceState : !isCurrentlyCollapsed;

  if (nextCollapsed) {
    navPane.classList.add("collapsed");
    ribbon?.classList.remove("hidden");
    splitter?.classList.add("hidden");
  } else {
    navPane.classList.remove("collapsed");
    ribbon?.classList.add("hidden");
    splitter?.classList.remove("hidden");
  }
  setTimeout(() => cm?.refresh(), 50);
}

/* ------------------------------------------------------------------ *
 * VHDL Formatter & Code Templates
 * ------------------------------------------------------------------ */
function formatVHDL(code) {
  const lines = (code || "").split(/\r?\n/);
  let indent = 0;
  const step = 2;
  const formatted = [];

  const startsBlock = /^\s*(entity\b.*?\bis\b|architecture\b.*?\bis\b|package\b.*?\bis\b|block\b|process\b|case\b|for\b.*?loop\b|while\b.*?loop\b|loop\b|port\s*\(|generic\s*\()/i;
  const isBegin = /^\s*begin\b/i;
  const isEnd = /^\s*end\b/i;
  const isBranch = /^\s*(elsif\b|else\b|when\b)/i;

  for (let raw of lines) {
    let trimmed = raw.trim();
    if (!trimmed) {
      formatted.push("");
      continue;
    }
    if (trimmed.startsWith("--")) {
      formatted.push(" ".repeat(Math.max(0, indent * step)) + trimmed);
      continue;
    }

    if (isEnd.test(trimmed) || isBegin.test(trimmed) || isBranch.test(trimmed)) {
      indent = Math.max(0, indent - 1);
    }

    formatted.push(" ".repeat(Math.max(0, indent * step)) + trimmed);

    if (startsBlock.test(trimmed) || isBegin.test(trimmed) || isBranch.test(trimmed)) {
      indent++;
    }
  }
  return formatted.join("\n");
}

function formatCurrentEditor() {
  if (!cm) return;
  const cur = cm.getCursor();
  const formatted = formatVHDL(cm.getValue());
  cm.setValue(formatted);
  cm.setCursor(cur);
  toast("VHDL code formatted");
}

const SNIPPETS = {
  sync_proc:
`  -- Synchronous process with active-high synchronous reset
  process (clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        -- synchronous reset logic
      elsif enable = '1' then
        -- functional logic
      end if;
    end if;
  end process;
`,
  async_proc:
`  -- Sequential process with asynchronous reset
  process (clk, rst)
  begin
    if rst = '1' then
      -- asynchronous reset logic
    elsif rising_edge(clk) then
      -- functional logic
    end if;
  end process;
`,
  comb_proc:
`  -- Combinational process (VHDL-2008 process(all))
  process (all)
  begin
    -- default assignments to prevent inadvertent latches
  end process;
`,
  fsm:
`  -- Two-process finite state machine (FSM)
  type state_type is (ST_IDLE, ST_ACTIVE, ST_WAIT, ST_DONE);
  signal state_reg, state_next : state_type := ST_IDLE;

  -- State register
  process (clk, rst)
  begin
    if rst = '1' then
      state_reg <= ST_IDLE;
    elsif rising_edge(clk) then
      state_reg <= state_next;
    end if;
  end process;

  -- Next-state logic & outputs
  process (state_reg)
  begin
    state_next <= state_reg;
    case state_reg is
      when ST_IDLE =>
        state_next <= ST_ACTIVE;
      when ST_ACTIVE =>
        state_next <= ST_DONE;
      when others =>
        state_next <= ST_IDLE;
    end case;
  end process;
`,
  mux4:
`  -- 4-to-1 Multiplexer (selected signal assignment)
  with sel select
    mux_out <= in0 when "00",
               in1 when "01",
               in2 when "10",
               in3 when "11",
               '0' when others;
`,
  dff:
`  -- D Flip-Flop with Clock Enable and Asynchronous Reset
  process (clk, rst)
  begin
    if rst = '1' then
      q <= '0';
    elsif rising_edge(clk) then
      if en = '1' then
        q <= d;
      end if;
    end if;
  end process;
`,
  counter:
`  -- Up/Down Counter with explicit wrap-around boundary guard
  process (clk, rst)
  begin
    if rst = '1' then
      count_reg <= 0;
    elsif rising_edge(clk) then
      if count_reg >= 15 then
        count_reg <= 0; -- guard prevents integer range bound check failure
      else
        count_reg <= count_reg + 1;
      end if;
    end if;
  end process;
`,
  clk_gen:
`  -- Testbench clock generator
  constant CLK_PERIOD : time := 10 ns;

  clk_gen : process
  begin
    clk <= '0';
    wait for CLK_PERIOD / 2;
    clk <= '1';
    wait for CLK_PERIOD / 2;
  end process clk_gen;
`,
  stim_pulse:
`  -- Testbench stimulus process
  stim : process
  begin
    -- Initialize inputs
    rst <= '1';
    wait for 20 ns;
    rst <= '0';
    wait for 20 ns;

    -- Add your verification vectors here

    wait; -- Stop simulation
  end process stim;
`,
  comp_decl:
`  -- Component Declaration (place inside architecture declarative region)
  component sub_module is
    port (
      clk   : in  std_logic;
      rst   : in  std_logic;
      din   : in  std_logic_vector(7 downto 0);
      dout  : out std_logic_vector(7 downto 0)
    );
  end component sub_module;

  -- Component Instantiation (place after architecture begin)
  -- U1: sub_module port map (clk => clk, rst => rst, din => s_in, dout => s_out);
`
};

const TEMPLATE_METADATA = {
  sync_proc: {
    title: "Synchronous Process (clk, rst)",
    desc: "Clocked process with synchronous reset for sequential register logic."
  },
  async_proc: {
    title: "Async Reset Process",
    desc: "Sequential clocked process with asynchronous reset (sensitivity list includes rst)."
  },
  comb_proc: {
    title: "Combinational Process (all)",
    desc: "Pure combinational logic process using VHDL-2008 process(all) to avoid latches."
  },
  fsm: {
    title: "Two-Process FSM (Moore / Mealy)",
    desc: "Standard two-process state machine: register process + next-state/output logic."
  },
  mux4: {
    title: "4-to-1 Multiplexer",
    desc: "Combinational 4-channel multiplexer using selected signal assignment (with-select)."
  },
  dff: {
    title: "D-Flip-Flop with Enable",
    desc: "Edge-triggered D flip-flop with synchronous enable and asynchronous reset."
  },
  counter: {
    title: "Up/Down Counter (Protected)",
    desc: "Synchronous counter with explicit boundary check to avoid integer range failure."
  },
  clk_gen: {
    title: "Testbench Clock Generator",
    desc: "Continuous clock oscillator process with constant period parameter for testbenches."
  },
  stim_pulse: {
    title: "Testbench Stimulus & Reset",
    desc: "Testbench stimulus sequence with initial reset pulse and wait termination."
  },
  comp_decl: {
    title: "Structural Component Skeleton",
    desc: "Component declaration & instantiation skeleton for modular structural design."
  }
};

let currentSelectedTemplate = "sync_proc";

function openTemplateModal() {
  currentSelectedTemplate = "sync_proc";
  updateTemplateModalView();
  $("templateModal")?.classList.remove("hidden");
}

function closeTemplateModal() {
  $("templateModal")?.classList.add("hidden");
}

function updateTemplateModalView() {
  const meta = TEMPLATE_METADATA[currentSelectedTemplate] || {};
  const code = SNIPPETS[currentSelectedTemplate] || "";
  if ($("templateTitle")) $("templateTitle").textContent = meta.title || currentSelectedTemplate;
  if ($("templateDesc")) $("templateDesc").textContent = meta.desc || "";
  if ($("templateCode")) $("templateCode").textContent = code;

  document.querySelectorAll(".template-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tpl === currentSelectedTemplate);
  });
}

function insertSnippet(key) {
  const snippet = SNIPPETS[key];
  if (!snippet || !cm) return;
  cm.replaceSelection(snippet);
  cm.focus();
  toast("Template inserted");
}

/* ------------------------------------------------------------------ *
 * Screen Switching & Project List
 * ------------------------------------------------------------------ */
function showScreen(which) {
  state.screen = which;
  $("welcomeScreen").classList.toggle("hidden", which !== "welcome");
  $("appScreen").classList.toggle("hidden", which !== "app");
  if (which === "welcome") {
    loadProjectList();
  } else if (which === "app") {
    if (typeof cm !== "undefined" && cm) {
      setTimeout(() => {
        cm.refresh();
      }, 30);
    }
  }
}

async function loadProjectList() {
  const empty = $("projectEmpty");
  try {
    const r = await fetch("/api/projects?t=" + Date.now(), { cache: "no-store" });
    const d = await r.json();
    renderProjectList(d.projects || []);
  } catch (err) {
    if (empty) empty.style.display = "none";
    consoleLine("err", "Could not load projects: " + err.message);
  }
}

function renderProjectList(projects) {
  const list = $("projectList");
  const empty = $("projectEmpty");
  list.innerHTML = "";
  empty.style.display = projects.length ? "none" : "block";

  projects.forEach(p => {
    const item = document.createElement("div");
    item.className = "project-item";
    const fileCount = p.file_count || (p.files || []).length || 1;
    const hasTb = p.has_tb || !!p.active_tb;

    item.innerHTML = `
      <div class="p-icon">
        <svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 2.5h4l1.5 2h7.5v8.5h-13z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </div>
      <div class="p-body">
        <div class="p-name">
          ${esc(p.name || p.entity)}
          <span class="badge-std">VHDL-${(p.standard || "08") === "08" ? "2008" : (p.standard || "08").toUpperCase()}</span>
        </div>
        <div class="p-meta">
          <span class="p-folder">📁 projects/${esc(p.folder || p.name)}</span> ·
          top <b>${esc(p.top_entity || p.entity || "design")}</b> ·
          ${fileCount} file${fileCount === 1 ? "" : "s"}
          ${p.author ? `· <span class="p-author">👤 ${esc(p.author)}</span>` : ""} ·
          ${hasTb ? '<span class="ok">simulation ready</span>' : "no testbench"} ·
          ${esc(fmtDate(p.updated || p.created))}
        </div>
      </div>
      <button class="p-del" title="Delete project">&times;</button>`;

    item.addEventListener("click", () => openProject(p.name));
    item.querySelector(".p-del").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
      try {
        await fetch("/api/projects/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.name }),
        });
        toast(`Project "${p.name}" deleted`);
        loadProjectList();
      } catch (err) { toast("Delete failed: " + err.message, true); }
    });
    list.appendChild(item);
  });
}

async function openProject(name) {
  try {
    const r = await fetch("/api/projects/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!d.ok) { toast(d.message || "Load failed", true); return; }
    enterProject(d.project);
  } catch (err) { toast("Load failed: " + err.message, true); }
}

function enterProject(project) {
  state.project = project;
  fileDocs.clear();

  // Normalize multi-file list
  if (!state.project.files || !Array.isArray(state.project.files) || state.project.files.length === 0) {
    state.project.files = [];
    const designCode = project.design_code || genDesignSkeleton({ entity: project.entity || "design", ports: project.ports || [] });
    state.project.files.push({
      filename: `${project.entity || "design"}.vhd`.toLowerCase(),
      entity: project.entity || "design",
      type: "design",
      architecture: project.architecture || "Behavioral",
      code: designCode,
      ports: project.ports || [],
    });
    if (project.tb_code) {
      state.project.files.push({
        filename: `tb_${project.entity || "design"}.vhd`.toLowerCase(),
        entity: `tb_${project.entity || "design"}`,
        type: "simulation",
        architecture: "sim",
        code: project.tb_code,
        ports: [],
      });
    }
  }

  // Ensure top_entity and active_tb
  if (!state.project.top_entity) {
    const firstDesign = state.project.files.find(f => f.type === "design");
    state.project.top_entity = firstDesign ? firstDesign.entity : (state.project.entity || "design");
  }
  if (!state.project.active_tb) {
    const firstSim = state.project.files.find(f => f.type === "simulation");
    state.project.active_tb = firstSim ? firstSim.filename : "";
  }

  state.project.dependencies = state.project.dependencies || [];
  state.dirty = false;
  state.design_ok = !!project.design_ok;
  state.tb_ok = !!project.tb_ok;
  state.waveDocs = null;

  const stdStr = (state.project.standard || "08") === "08" ? "2008" : (state.project.standard || "08").toUpperCase();
  $("brandProject").textContent =
    `${project.name || project.entity} · Top: ${state.project.top_entity} · VHDL-${stdStr}`;

  state.openTabs = state.project.files.map(f => f.filename);
  syncSimTargetDropdown();
  renderProjectNavigator();

  showScreen("app");

  if (state.openTabs.length > 0) {
    switchToFile(state.openTabs[0]);
  }

  $("btnWave").classList.add("wave-hidden");
  $("consoleProc").textContent = "";

  updateFooterDeps();
  gateWorkflow();
  consoleLine("sys", `Project "${project.name || project.entity}" loaded with ${state.project.files.length} source file(s).`);

  setTimeout(() => {
    if (typeof cm !== "undefined" && cm) {
      cm.refresh();
      cm.focus();
    }
  }, 50);
}

/* ------------------------------------------------------------------ *
 * New Project Wizard (Welcome Screen)
 * ------------------------------------------------------------------ */
const wiz = { portRows: [] };

function wizReadForm() {
  const name = ($("wizName")?.value || "").trim() || ($("wizEntity")?.value || "").trim();
  const entity = ($("wizEntity")?.value || "").trim();
  const folder = ($("wizFolder")?.value || "").trim() || name;
  const architecture = ($("wizArch")?.value || "").trim() || "Behavioral";
  const standard = ($("wizStandard")?.value || "08").trim();
  const author = ($("wizAuthor")?.value || "").trim();
  const ports = [];
  let error = "";

  if (!name || !VHDL_IDENT.test(name)) error = "Project name must be a valid VHDL identifier (letters/digits/_ only).";
  if (!entity || !VHDL_IDENT.test(entity)) error = error || "Top Entity name must be a valid VHDL identifier.";
  if (!VHDL_IDENT.test(architecture)) error = error || "Invalid architecture name.";

  wiz.portRows.forEach(row => {
    if (error) return;
    const p = row.read();
    if (p === null) { error = `Port "${row.el.querySelector(".pname").value.trim()}" is invalid.`; return; }
    if (!p.skip) ports.push(p);
  });
  return { name, entity, folder, architecture, standard, author, ports, error };
}

function wizRefreshPreview() {
  const { name, entity, architecture, standard, author, ports, error } = wizReadForm();
  const cfg = {
    projectName: name || "my_project",
    entity: entity || "my_design",
    architecture,
    standard,
    author,
    ports
  };
  $("wizPreview").textContent = genDesignSkeleton(cfg);
  $("wizError").textContent = error;
  $("wizCreate").disabled = !!error || !entity || !name;
}

function wizAddRow(initial) {
  const api = makePortRow(initial);
  $("wizPortRows").appendChild(api.el);
  wiz.portRows.push(api);
}

function makePortRow(initial) {
  const row = document.createElement("div");
  row.className = "port-row";
  row.innerHTML = `
    <input class="pname" placeholder="port_name" spellcheck="false" autocomplete="off">
    <select class="pdir">
      <option value="in">in</option>
      <option value="out">out</option>
      <option value="inout">inout</option>
    </select>
    <span class="check"><input type="checkbox" class="pvec" title="Define as std_logic_vector"></span>
    <span class="prange">
      <input class="pmsb" value="7" disabled title="MSB">
      <span class="sep">:</span>
      <input class="plsb" value="0" disabled title="LSB">
    </span>
    <span class="ptype">std_logic</span>
    <button class="icon-btn pdel" title="Remove port">
      <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>`;

  const $r = (cls) => row.querySelector("." + cls);
  const nameEl = $r("pname"), dirEl = $r("pdir"), vecEl = $r("pvec");
  const msbEl = $r("pmsb"), lsbEl = $r("plsb"), typeEl = $r("ptype");

  if (initial) {
    nameEl.value = initial.name || "";
    dirEl.value = initial.dir || "in";
    vecEl.checked = !!initial.vector;
    msbEl.value = initial.msb ?? 7;
    lsbEl.value = initial.lsb ?? 0;
  }

  function refreshType() {
    const on = vecEl.checked;
    msbEl.disabled = !on;
    lsbEl.disabled = !on;
    typeEl.textContent = on ? `slv(${msbEl.value}:${lsbEl.value})` : "std_logic";
  }
  vecEl.addEventListener("change", () => { refreshType(); wizRefreshPreview(); });
  [msbEl, lsbEl].forEach(el => el.addEventListener("input", () => { refreshType(); wizRefreshPreview(); }));
  [nameEl, dirEl].forEach(el => el.addEventListener("input", wizRefreshPreview));
  row.querySelector(".pdel").addEventListener("click", () => {
    wiz.portRows = wiz.portRows.filter(r => r !== api);
    row.remove();
    wizRefreshPreview();
  });

  refreshType();
  const api = {
    el: row,
    read() {
      const name = nameEl.value.trim();
      if (!name) return { skip: true };
      if (!VHDL_IDENT.test(name)) return null;
      const vector = vecEl.checked;
      let msb = 7, lsb = 0;
      if (vector) {
        msb = parseInt(msbEl.value, 10);
        lsb = parseInt(lsbEl.value, 10);
        if (!Number.isFinite(msb) || !Number.isFinite(lsb) || msb < 0 || lsb < 0) return null;
        if (msb < lsb) { const t = msb; msb = lsb; lsb = t; }
      }
      return { name, dir: dirEl.value, vector, msb, lsb };
    },
  };
  return api;
}

function openWizard() {
  wiz.portRows = [];
  $("wizPortRows").innerHTML = "";
  if ($("wizName")) {
    $("wizName").value = "";
    delete $("wizName").dataset.touched;
  }
  if ($("wizEntity")) {
    $("wizEntity").value = "";
    delete $("wizEntity").dataset.touched;
  }
  if ($("wizFolder")) {
    $("wizFolder").value = "";
    delete $("wizFolder").dataset.touched;
  }
  $("wizArch").value = "Behavioral";
  if ($("wizStandard")) $("wizStandard").value = "08";
  if ($("wizAuthor")) $("wizAuthor").value = "";
  wizAddRow({ name: "clk", dir: "in", vector: false });
  wizAddRow({ name: "data_out", dir: "out", vector: true, msb: 7, lsb: 0 });
  wizRefreshPreview();
  $("wizardModal").classList.remove("hidden");
  setTimeout(() => ($("wizName") || $("wizEntity")).focus(), 50);
}

function closeWizard() { $("wizardModal").classList.add("hidden"); }

function wizCreateProject() {
  const { name, entity, folder, architecture, standard, author, ports, error } = wizReadForm();
  if (error || !entity || !name) { $("wizError").textContent = error || "Project Name and Entity required."; return; }
  const filename = `${entity}.vhd`.toLowerCase();
  const createdDate = new Date().toISOString().slice(0, 10);

  const project = {
    name,
    folder: folder || name,
    standard: standard || "08",
    author: author || "",
    created: createdDate,
    entity,
    top_entity: entity,
    active_tb: "",
    architecture,
    ports,
    files: [
      {
        filename,
        entity,
        type: "design",
        architecture,
        code: genDesignSkeleton({
          projectName: name,
          filename,
          entity,
          architecture,
          standard,
          author,
          date: createdDate,
          ports,
        }),
        ports,
      }
    ],
    dependencies: [],
    design_ok: false,
    tb_ok: false,
  };

  closeWizard();
  enterProject(project);
  saveProject(false);
  toast(`Project "${name}" created in projects/${project.folder}/`);
  consoleLine("sys", `Project "${name}" created in folder "projects/${project.folder}/" (standard VHDL-${standard === "08" ? "2008" : standard.toUpperCase()}).`);
}

/* ------------------------------------------------------------------ *
 * Compilation & Execution (Check Syntax & Simulate)
 * ------------------------------------------------------------------ */
function setBusy(on, msg) {
  state.busy = on;
  const bar = $("topProgressBar");
  if (on) {
    if (bar) {
      bar.classList.add("active");
      bar.style.width = "40%";
      setTimeout(() => { if (state.busy && bar) bar.style.width = "75%"; }, 250);
    }
  } else {
    if (bar) {
      bar.style.width = "100%";
      setTimeout(() => {
        bar.classList.remove("active");
        bar.style.width = "0%";
      }, 300);
    }
  }
  $("btnCheck").disabled = on;
  $("btnSim").disabled = on;
  $("btnSave").disabled = on;
  if (on && msg) setStatus("busy", msg);
  if (!on && $("dot").className.includes("busy")) setStatus("idle", "Ready");
}

async function runCheckSyntax() {
  if (state.busy || !state.project) return;
  const p = state.project;

  // Flush live editor changes into state
  p.files.forEach(f => {
    if (fileDocs.has(f.filename)) {
      f.code = fileDocs.get(f.filename).getValue();
    }
  });

  state.busy = true;
  setBusy(true, "Running GHDL analysis (ghdl -a) ...");
  $("consoleProc").textContent = "Process: “Check Syntax”";

  // Clear errors across all open documents
  fileDocs.forEach(doc => clearDocErrors(doc));

  try {
    const resp = await fetch("/check_syntax", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: p.files.map(f => ({
          filename: f.filename,
          entity: f.entity,
          type: f.type,
          architecture: f.architecture,
          code: f.code,
          ports: f.ports || [],
        })),
        active_tb: p.active_tb,
        top_entity: p.top_entity,
        target: p.active_tb ? "tb" : "design",
        standard: p.standard || "08",
        dependencies: p.dependencies || [],
      }),
    });
    let d;
    try {
      d = await resp.json();
    } catch (parseErr) {
      consoleLine("err", `Server response error (${resp.status}): ${resp.statusText || "Invalid server response"}`);
      setStatus("err", "Server error");
      return;
    }
    if (!resp.ok) {
      if (d && d.log) renderLog(d.log);
      consoleLine("err", d.message || `HTTP ${resp.status}`);
      setStatus("err", "Check Syntax request rejected");
      return;
    }
    renderLog(d.log);

    // Annotate compiler errors directly on the corresponding file doc
    if (d.errors && d.errors.length) {
      d.errors.forEach(e => {
        if (e.file && e.line) {
          const doc = fileDocs.get(e.file.toLowerCase()) || fileDocs.get(e.file);
          if (doc) {
            markDocError(doc, e.line, e.col, e.message);
          }
        }
      });
    }

    if (d.ok) {
      state.design_ok = true;
      if (p.active_tb) state.tb_ok = true;
      setStatus("ok", `Check Syntax passed: 0 errors, ${(d.warnings || []).length} warning(s)`);
      if (!p.active_tb && p.files.length === 1) {
        showTbPrompt();
      }
    } else {
      state.design_ok = false;
      state.tb_ok = false;
      const first = (d.errors || [])[0];
      setStatus("err", first ? `Error in ${first.file || "source"}:${first.line} - ${first.message}` : "Syntax check failed");
    }
    gateWorkflow();
  } catch (err) {
    consoleLine("err", "Network error: " + err.message);
    setStatus("err", "Server unreachable");
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

function showTbPrompt() {
  if (!state.project || state.project.active_tb) return;
  $("tbModal").classList.remove("hidden");
}

function addQuickTestbenchFromPrompt() {
  $("tbModal").classList.add("hidden");
  const topEntity = state.project.top_entity || state.project.files[0]?.entity || "design";
  openAddSourceModal("simulation", topEntity);
}

async function runSimulate() {
  if (state.busy || !state.project) return;
  const p = state.project;

  // Flush live editor changes
  p.files.forEach(f => {
    if (fileDocs.has(f.filename)) {
      f.code = fileDocs.get(f.filename).getValue();
    }
  });

  if (!p.active_tb) {
    const firstSim = p.files.find(f => f.type === "simulation");
    if (firstSim) p.active_tb = firstSim.filename;
  }
  if (!p.active_tb) {
    toast("No testbench found in this project. Add a testbench first (+)", true);
    return;
  }

  const stopTime = ($("stopTime").value || "").trim() || "1us";
  state.busy = true;
  setBusy(true, `Running simulation (${p.active_tb}, stop-time=${stopTime}) ...`);
  $("consoleProc").textContent = "Process: “Simulate Behavioral Model”";

  try {
    const resp = await fetch("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: p.files.map(f => ({
          filename: f.filename,
          entity: f.entity,
          type: f.type,
          architecture: f.architecture,
          code: f.code,
          ports: f.ports || [],
        })),
        active_tb: p.active_tb,
        top_entity: p.top_entity,
        stop_time: stopTime,
        standard: p.standard || "08",
        dependencies: p.dependencies || [],
      }),
    });
    let d;
    try {
      d = await resp.json();
    } catch (parseErr) {
      consoleLine("err", `Server response error (${resp.status}): ${resp.statusText || "Invalid server response"}`);
      setStatus("err", "Server error");
      return;
    }
    if (!resp.ok) {
      if (d && d.log) renderLog(d.log);
      consoleLine("err", d.message || `HTTP ${resp.status}`);
      setStatus("err", "Simulation request failed");
      return;
    }
    renderLog(d.log);

    if (d.wavedrom) {
      state.waveDocs = d;
      $("btnWave").classList.remove("wave-hidden");
      const subtitle = `${d.tb_entity} · ${d.end_time_ns} ns · ${d.signals.length} signals · stop-time ${d.stop_time}`;
      if (window.WaveViewer && window.WaveViewer.isOpen()) {
        window.WaveViewer.updateData(d, subtitle);
      } else {
        window.WaveViewer.open(d, subtitle);
      }
    } else {
      state.waveDocs = null;
      $("btnWave").classList.add("wave-hidden");
    }

    if (d.ok) {
      setStatus("ok", `Simulation complete: ${d.end_time_ns} ns, ${d.signals.length} signal(s)`);
    } else {
      setStatus("err", "Simulation finished with warnings/errors — see console");
    }
  } catch (err) {
    consoleLine("err", "Network error: " + err.message);
    setStatus("err", "Server unreachable");
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ *
 * Vertical Splitter (Editor vs Console)
 * ------------------------------------------------------------------ */
function wireConsoleSplitter() {
  const bar = $("vSplit");
  const pane = $("consolePane");
  let drag = null;

  bar.addEventListener("mousedown", (e) => {
    drag = { appBottom: $("appScreen").getBoundingClientRect().bottom };
    bar.classList.add("dragging");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const h = Math.max(70, Math.min(window.innerHeight - 200, drag.appBottom - e.clientY));
    pane.style.height = h + "px";
    pane.style.flexBasis = h + "px";
    cm?.refresh();
  });

  window.addEventListener("mouseup", () => {
    if (!drag) return;
    drag = null;
    bar.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    cm?.refresh();
  });

  bar.addEventListener("dblclick", () => {
    pane.style.height = "";
    pane.style.flexBasis = "";
    cm?.refresh();
  });
}

function wireEdaMenubar() {
  const menuBtns = document.querySelectorAll(".eda-menu-btn");
  const dropdowns = document.querySelectorAll(".eda-menu-dropdown");

  function closeAllMenus() {
    dropdowns.forEach(d => d.classList.add("hidden"));
    menuBtns.forEach(b => b.classList.remove("active"));
  }

  menuBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menuId = btn.dataset.menu;
      const menu = $(menuId);
      if (!menu) return;
      const isOpen = !menu.classList.contains("hidden");
      closeAllMenus();
      if (!isOpen) {
        menu.classList.remove("hidden");
        btn.classList.add("active");
      }
    });

    btn.addEventListener("mouseenter", () => {
      const anyOpen = Array.from(dropdowns).some(d => !d.classList.contains("hidden"));
      if (anyOpen) {
        closeAllMenus();
        const menu = $(btn.dataset.menu);
        if (menu) {
          menu.classList.remove("hidden");
          btn.classList.add("active");
        }
      }
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".eda-menu-item")) {
      closeAllMenus();
    }
  });

  // Wire menu actions
  $("mFileNewProject")?.addEventListener("click", () => {
    closeAllMenus();
    openWizard();
  });
  $("mFileOpenProjects")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnBack")?.click();
  });
  $("mFileAddSource")?.addEventListener("click", () => {
    closeAllMenus();
    openAddSourceModal();
  });
  $("mFileSave")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnSave")?.click();
  });
  $("mFileImport")?.addEventListener("click", () => {
    closeAllMenus();
    $("fileImport")?.click();
  });
  $("mFileExportDesign")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnExportDesign")?.click();
  });
  $("mFileExportTb")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnExportTb")?.click();
  });
  $("mFileExportRar")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnExportRar")?.click();
  });
  $("mFileExportZip")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnExportZip")?.click();
  });

  $("mEditUndo")?.addEventListener("click", () => {
    closeAllMenus();
    cm?.undo();
    cm?.focus();
  });
  $("mEditRedo")?.addEventListener("click", () => {
    closeAllMenus();
    cm?.redo();
    cm?.focus();
  });
  $("mEditFormat")?.addEventListener("click", () => {
    closeAllMenus();
    formatCurrentEditor();
  });
  $("mEditTemplate")?.addEventListener("click", () => {
    closeAllMenus();
    openTemplateModal();
  });
  $("mEditFontInc")?.addEventListener("click", () => {
    closeAllMenus();
    setFontSize(state.fontSize + 1);
  });
  $("mEditFontDec")?.addEventListener("click", () => {
    closeAllMenus();
    setFontSize(state.fontSize - 1);
  });

  $("mViewNav")?.addEventListener("click", () => {
    closeAllMenus();
    toggleNavPane();
  });
  $("mViewConsole")?.addEventListener("click", () => {
    closeAllMenus();
    $("consolePane")?.classList.toggle("hidden");
    cm?.refresh();
  });
  $("mViewZen")?.addEventListener("click", () => {
    closeAllMenus();
    toggleZenMode();
  });
  $("mViewWave")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnWave")?.click();
  });

  // Themes in View Menu
  $("mThemeDark")?.addEventListener("click", () => { closeAllMenus(); applyTheme("dracula"); });
  $("mThemeOneDark")?.addEventListener("click", () => { closeAllMenus(); applyTheme("onedark"); });
  $("mThemeCyberpunk")?.addEventListener("click", () => { closeAllMenus(); applyTheme("cyberpunk"); });
  $("mThemeMonokai")?.addEventListener("click", () => { closeAllMenus(); applyTheme("monokai"); });
  $("mThemeSolarizedDark")?.addEventListener("click", () => { closeAllMenus(); applyTheme("solarized-dark"); });
  $("mThemeLight")?.addEventListener("click", () => { closeAllMenus(); applyTheme("light"); });
  $("mThemeSolarizedLight")?.addEventListener("click", () => { closeAllMenus(); applyTheme("solarized-light"); });

  $("mProjAddSource")?.addEventListener("click", () => {
    closeAllMenus();
    openAddSourceModal();
  });
  $("mProjComponents")?.addEventListener("click", () => {
    closeAllMenus();
    openComponentsModal();
  });
  $("mProjImport")?.addEventListener("click", () => {
    closeAllMenus();
    $("fileImport")?.click();
  });

  $("mSimCheck")?.addEventListener("click", () => {
    closeAllMenus();
    runCheckSyntax();
  });
  $("mSimRun")?.addEventListener("click", () => {
    closeAllMenus();
    runSimulate();
  });
  $("mSimWave")?.addEventListener("click", () => {
    closeAllMenus();
    $("btnWave")?.click();
  });
  $("mSimVcd")?.addEventListener("click", () => {
    closeAllMenus();
    const tb = state.project?.active_tb ? state.project.active_tb.replace(/\.vhd$/i, "") : (state.waveDocs?.tb_entity || "wave");
    const filename = `${tb}.vcd`;
    const a = document.createElement("a");
    a.href = `/api/simulation/vcd?name=${encodeURIComponent(filename)}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast(`Downloading IEEE-1364 VCD trace (${filename})...`);
  });

  $("mHelpGuide")?.addEventListener("click", () => {
    closeAllMenus();
    openGuideModal();
  });
  $("mHelpShortcuts")?.addEventListener("click", () => {
    closeAllMenus();
    openGuideModal();
    switchGuideTab("guideShortcuts");
  });
  $("mHelpUpdate")?.addEventListener("click", () => {
    closeAllMenus();
    openUpdateModal();
  });
  $("mHelpAbout")?.addEventListener("click", () => {
    closeAllMenus();
    openGuideModal();
    switchGuideTab("guideAbout");
  });

  $("btnToolbarAddSource")?.addEventListener("click", () => {
    openAddSourceModal();
  });
}

/* ------------------------------------------------------------------ *
 * Persistence (Save Project)
 * ------------------------------------------------------------------ */
async function saveProject(notify) {
  const p = state.project;
  if (!p) return;

  p.files.forEach(f => {
    if (fileDocs.has(f.filename)) {
      f.code = fileDocs.get(f.filename).getValue();
    }
  });

  p.dependencies = p.dependencies || [];
  p.design_ok = state.design_ok;
  p.tb_ok = state.tb_ok;

  try {
    const r = await fetch("/api/projects/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: p }),
    });
    const d = await r.json();
    if (!d.ok) { toast(d.message || "Save failed", true); return; }
    state.dirty = false;
    p.files.forEach(f => f.dirty = false);
    renderEditorTabs();
    updateFooterDeps();
    if (notify) toast(`Project "${p.name || p.entity}" saved`);
  } catch (err) {
    toast("Save failed: " + err.message, true);
  }
}

/* ------------------------------------------------------------------ *
 * Export & Import
 * ------------------------------------------------------------------ */
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

function exportCurrentFile() {
  if (!state.project || !state.activeFile) return;
  const fileObj = state.project.files.find(f => f.filename === state.activeFile);
  if (!fileObj) return;
  const code = fileDocs.get(fileObj.filename)?.getValue() || fileObj.code;
  downloadBlob(new Blob([code], { type: "text/plain;charset=utf-8" }), fileObj.filename);
  toast(`Downloaded ${fileObj.filename}`);
}

function exportActiveTestbench() {
  if (!state.project || !state.project.active_tb) {
    toast("No active testbench in project", true);
    return;
  }
  const fileObj = state.project.files.find(f => f.filename === state.project.active_tb);
  if (!fileObj) return;
  const code = fileDocs.get(fileObj.filename)?.getValue() || fileObj.code;
  downloadBlob(new Blob([code], { type: "text/plain;charset=utf-8" }), fileObj.filename);
  toast(`Downloaded ${fileObj.filename}`);
}

async function exportZipPackage() {
  if (!state.project) return;
  const p = state.project;
  p.files.forEach(f => {
    if (fileDocs.has(f.filename)) f.code = fileDocs.get(f.filename).getValue();
  });

  try {
    const res = await fetch("/api/projects/export_zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: p, entity: p.top_entity || p.entity }),
    });
    if (!res.ok) throw new Error("ZIP package generation failed");
    const blob = await res.blob();
    downloadBlob(blob, `${p.name || p.entity || "project"}.zip`);
    toast(`Exported ${p.name || p.entity}.zip`);
  } catch (err) {
    toast("Zip export failed: " + err.message, true);
  }
}

/* ------------------------------------------------------------------ *
 * RAR Export Modal & Handlers
 * ------------------------------------------------------------------ */
function openRarModal() {
  if (!state.project) return;
  const p = state.project;
  $("rarFilename").value = `${p.name || p.entity || "project"}.rar`;
  $("rarCustomPath").value = "";
  $("rarStatus").textContent = `Package "${p.name || p.entity}" with all VHDL sources, testbenches, and scripts.`;
  $("rarError").textContent = "";
  $("rarModal").classList.remove("hidden");
  setTimeout(() => $("rarCustomPath").focus(), 50);
}

function closeRarModal() {
  $("rarModal")?.classList.add("hidden");
}

async function exportRarToDisk() {
  if (!state.project) return;
  const p = state.project;
  p.files.forEach(f => {
    if (fileDocs.has(f.filename)) f.code = fileDocs.get(f.filename).getValue();
  });

  const customPath = ($("rarCustomPath").value || "").trim();
  if (!customPath) {
    $("rarError").textContent = "Please enter a destination folder or path (e.g. D:\\Labs\\ or C:\\Users\\...\\Desktop).";
    return;
  }

  $("btnRarSaveDisk").disabled = true;
  $("rarStatus").textContent = "Packaging project with WinRAR (Rar.exe)...";
  $("rarError").textContent = "";

  try {
    const res = await fetch("/api/projects/export_rar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: p,
        name: p.name,
        target_path: customPath
      }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) {
      throw new Error(d.message || "Failed to create RAR archive.");
    }
    toast(`RAR package saved to ${d.path}`);
    $("rarStatus").textContent = `Successfully saved to: ${d.path} (${d.size} bytes)`;
    setTimeout(() => closeRarModal(), 1800);
  } catch (err) {
    $("rarError").textContent = err.message;
  } finally {
    $("btnRarSaveDisk").disabled = false;
  }
}

async function exportRarDownload() {
  if (!state.project) return;
  const p = state.project;
  p.files.forEach(f => {
    if (fileDocs.has(f.filename)) f.code = fileDocs.get(f.filename).getValue();
  });

  const rawFn = ($("rarFilename").value || `${p.name || "project"}.rar`).trim();
  const filename = rawFn.endsWith(".rar") ? rawFn : `${rawFn}.rar`;
  $("btnRarDownload").disabled = true;
  $("rarStatus").textContent = "Creating RAR archive for download...";
  $("rarError").textContent = "";

  try {
    const res = await fetch("/api/projects/export_rar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: p,
        name: p.name
      }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error((errJson && errJson.message) || "RAR export failed");
    }
    const blob = await res.blob();
    downloadBlob(blob, filename);
    toast(`Downloaded ${filename}`);
    closeRarModal();
  } catch (err) {
    $("rarError").textContent = err.message;
  } finally {
    $("btnRarDownload").disabled = false;
  }
}

function handleVHDLFiles(files) {
  if (!files || !files.length || !state.project) return;
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const fn = file.name.toLowerCase();
      const isTb = fn.startsWith("tb_") || /\bentity\s+tb_/i.test(content);
      const m = /\bentity\s+([A-Za-z][A-Za-z0-9_]*)\s+is/i.exec(content);
      const entity = m ? m[1] : fn.replace(/\.(vhd|vhdl)$/i, "");

      const existing = state.project.files.find(f => f.filename.toLowerCase() === fn);
      if (existing) {
        existing.code = content;
        existing.entity = entity;
        existing.dirty = true;
        if (fileDocs.has(existing.filename)) {
          fileDocs.get(existing.filename).setValue(content);
        }
      } else {
        state.project.files.push({
          filename: fn,
          entity,
          type: isTb ? "simulation" : "design",
          architecture: isTb ? "sim" : "Behavioral",
          code: content,
          ports: parseEntityPorts(content),
          dirty: true,
        });
      }
      switchToFile(fn);
      renderProjectNavigator();
      syncSimTargetDropdown();
      gateWorkflow();
      toast(`Imported ${file.name}`);
    };
    reader.readAsText(file);
  });
}

/* ------------------------------------------------------------------ *
 * Structural VHDL Component Manager Modal
 * ------------------------------------------------------------------ */
const compState = { all: [], selected: null };

async function openComponentsModal() {
  if (!state.project) return;
  $("componentsModal").classList.remove("hidden");
  $("compItems").innerHTML = "<div class='dim sm-text' style='padding:8px'>Loading components...</div>";
  if ($("compFilter")) $("compFilter").value = "";
  try {
    const res = await fetch("/api/components");
    const d = await res.json();
    if (!d.ok) throw new Error(d.message || "Failed to load components");
    // Filter out top entity of the current project so it doesn't show itself as a sub-block
    compState.all = (d.components || []).filter(c =>
      (c.project_folder !== state.project.folder && c.project_name !== state.project.name) ||
      (c.entity.toLowerCase() !== (state.project.top_entity || "").toLowerCase() &&
       c.entity.toLowerCase() !== (state.project.entity || "").toLowerCase())
    );
    renderComponentsList();
    if (compState.all.length) {
      selectComponent(compState.all[0]);
    } else {
      $("compDetailTitle").textContent = "No Sub-Blocks Available";
      $("compDetailPorts").textContent = "Create and save sub-blocks (e.g. inverter, half_adder) in other projects first, then link them here.";
      $("compDeclSnippet").textContent = "-- No component selected";
      $("compMapSnippet").textContent = "-- No component selected";
      $("btnInsertDecl").disabled = true;
      $("btnInsertMap").disabled = true;
      if ($("btnImportCompToProj")) $("btnImportCompToProj").disabled = true;
    }
  } catch (err) {
    $("compItems").innerHTML = `<div class='dim sm-text err' style='padding:8px'>Error: ${err.message}</div>`;
  }
}

function closeComponentsModal() {
  $("componentsModal").classList.add("hidden");
}

async function importComponentToCurrentProject(c) {
  if (!state.project || !c) return;
  const filename = (c.filename || `${c.entity}.vhd`).toLowerCase();

  // Check if file already exists in current project
  let existing = state.project.files.find(f =>
    f.filename.toLowerCase() === filename ||
    (f.entity && f.entity.toLowerCase() === c.entity.toLowerCase())
  );

  if (existing) {
    toast(`Component "${c.entity}" is already present in this project.`);
    switchToFile(existing.filename);
    renderComponentsList();
    return;
  }

  // Create design file in current project
  const newFile = {
    filename: filename,
    entity: c.entity,
    type: "design",
    architecture: c.architecture || "Behavioral",
    code: c.design_code || "",
    ports: c.ports || [],
    dirty: true,
  };

  state.project.files.push(newFile);
  state.project.dependencies = state.project.dependencies || [];
  if (!state.project.dependencies.includes(c.entity)) {
    state.project.dependencies.push(c.entity);
  }
  if (!state.openTabs.includes(filename)) {
    state.openTabs.push(filename);
  }

  // Save project: writes projects/<current_folder>/<filename>.vhd on disk!
  await saveProject(false);
  renderProjectNavigator();
  renderEditorTabs();
  updateFooterDeps();
  renderComponentsList();
  selectComponent(c);
  switchToFile(filename);
  toast(`Module "${filename}" copied to projects/${state.project.folder}/ and added to project!`);
}

function renderComponentsList() {
  const container = $("compItems");
  container.innerHTML = "";
  if (!compState.all.length) {
    container.innerHTML = "<div class='dim sm-text' style='padding:8px'>No other saved projects found.<br>Create sub-blocks first!</div>";
    updateCompLinkedCount();
    return;
  }

  const query = ($("compFilter")?.value || "").trim().toLowerCase();
  const filtered = compState.all.filter(c => {
    if (!query) return true;
    return (c.name && c.name.toLowerCase().includes(query)) ||
           (c.entity && c.entity.toLowerCase().includes(query)) ||
           (c.project_name && c.project_name.toLowerCase().includes(query)) ||
           (c.project_folder && c.project_folder.toLowerCase().includes(query));
  });

  if (!filtered.length) {
    container.innerHTML = `<div class='dim sm-text' style='padding:8px'>No components match "${esc(query)}"</div>`;
    updateCompLinkedCount();
    return;
  }

  // Group by project_name
  const groups = new Map();
  filtered.forEach(c => {
    const pName = c.project_name || c.project_folder || "Saved Modules";
    if (!groups.has(pName)) groups.set(pName, []);
    groups.get(pName).push(c);
  });

  const linked = new Set(state.project.dependencies || []);
  const currentFilenames = new Set(state.project.files.map(f => f.filename.toLowerCase()));
  const currentEntities = new Set(state.project.files.map(f => f.entity ? f.entity.toLowerCase() : ""));

  groups.forEach((items, pName) => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "comp-project-group";
    groupDiv.innerHTML = `
      <div class="comp-project-head">
        <svg viewBox="0 0 16 16" width="13" height="13"><path d="M1.5 2.5h4l1.5 2h7.5v8.5h-13z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        <span>Project: ${esc(pName)}</span>
        <span class="comp-project-count">${items.length} module${items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="comp-project-items"></div>
    `;
    const itemsCont = groupDiv.querySelector(".comp-project-items");

    items.forEach(c => {
      const fn = (c.filename || `${c.entity}.vhd`).toLowerCase();
      const inProject = currentFilenames.has(fn) || currentEntities.has(c.entity.toLowerCase());
      const isLinked = linked.has(c.name) || linked.has(c.entity) || inProject;

      const card = document.createElement("div");
      card.className = "comp-card" + (compState.selected?.name === c.name ? " selected" : "");
      card.innerHTML = `
        <div class="comp-card-info">
          <span class="comp-card-name">${esc(c.name || c.entity)}</span>
          <span class="comp-card-sub">${c.ports.length} port(s) · ${esc(c.architecture)} · ${esc(c.filename)}</span>
        </div>
        <button class="btn sm ${inProject ? "accent" : "ghost"}" data-comp="${esc(c.name)}">
          ${inProject ? "✓ In Project" : "+ Link & Add"}
        </button>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") {
          e.stopPropagation();
          if (inProject) {
            toast(`"${c.entity}" is already in this project folder.`);
            switchToFile(fn);
            closeComponentsModal();
          } else {
            importComponentToCurrentProject(c);
          }
          return;
        }
        selectComponent(c);
      });
      itemsCont.appendChild(card);
    });

    container.appendChild(groupDiv);
  });

  updateCompLinkedCount();
}

function toggleComponentLink(compName) {
  const c = compState.all.find(x => x.name === compName || x.entity === compName);
  if (c) {
    importComponentToCurrentProject(c);
  }
}

function selectComponent(c) {
  compState.selected = c;
  document.querySelectorAll(".comp-card").forEach(el => {
    el.classList.toggle("selected", el.querySelector(".comp-card-name")?.textContent === c.name);
  });
  $("compDetailTitle").textContent = `Entity: ${c.entity} (${c.architecture})`;
  const pList = (c.ports || []).map(p =>
    `${p.name} (${p.dir} ${p.vector ? `[${p.msb}:${p.lsb}]` : "std_logic"})`).join(", ") || "No ports";
  $("compDetailPorts").textContent = `Interface: ${pList} · Source: projects/${c.project_folder || c.project_name}/${c.filename}`;
  $("compDeclSnippet").textContent = c.snippets?.declaration || "-- No declaration snippet";
  $("compMapSnippet").textContent = c.snippets?.instantiation || "-- No instantiation snippet";
  $("btnInsertDecl").disabled = false;
  $("btnInsertMap").disabled = false;

  const fn = (c.filename || `${c.entity}.vhd`).toLowerCase();
  const currentFilenames = new Set(state.project.files.map(f => f.filename.toLowerCase()));
  const currentEntities = new Set(state.project.files.map(f => f.entity ? f.entity.toLowerCase() : ""));
  const inProject = currentFilenames.has(fn) || currentEntities.has(c.entity.toLowerCase());

  const btnImport = $("btnImportCompToProj");
  if (btnImport) {
    btnImport.disabled = inProject;
    btnImport.innerHTML = inProject
      ? `✓ File Already in Current Project (${fn})`
      : `<svg viewBox="0 0 16 16" width="12" height="12"><path d="M1.5 2.5h4l1.5 2h7.5v8.5h-13z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 6v5M5.5 8.5L8 11l2.5-2.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> Copy &amp; Add "${fn}" to Current Project`;
  }
}

function updateCompLinkedCount() {
  const count = (state.project?.dependencies || []).length;
  $("compLinkedCount").textContent = `${count} component(s) linked`;
}

function updateFooterDeps() {
  const el = $("footerDeps");
  if (!el) return;
  const count = (state.project?.dependencies || []).length;
  el.textContent = `${count} Component${count === 1 ? "" : "s"} Linked`;
}

function insertSnippetIntoEditor(text) {
  if (!cm) return;
  const doc = cm.getDoc();
  doc.replaceRange("\n" + text + "\n", doc.getCursor());
  cm.focus();
  toast("Snippet inserted into editor");
}

/* ------------------------------------------------------------------ *
 * Themes & Zen Mode
 * ------------------------------------------------------------------ */
function applyTheme(themeName) {
  const validThemes = ["dracula", "onedark", "cyberpunk", "light", "monokai", "solarized-dark", "solarized-light"];
  const theme = validThemes.includes(themeName) ? themeName : "dracula";

  // Update body classes
  validThemes.forEach(t => {
    if (t !== "dracula") document.body.classList.remove("theme-" + t);
  });
  if (theme !== "dracula") {
    document.body.classList.add("theme-" + theme);
  }

  // Update CodeMirror theme
  if (cm) {
    if (theme === "monokai") {
      cm.setOption("theme", "monokai");
    } else {
      cm.setOption("theme", "dracula");
    }
  }

  localStorage.setItem("vhdl_theme", theme);
  if ($("selTheme")) $("selTheme").value = theme;

  // Update checkmarks in View -> Themes menu
  const menuBtnMap = {
    dracula: "mThemeDark",
    onedark: "mThemeOneDark",
    cyberpunk: "mThemeCyberpunk",
    light: "mThemeLight",
    monokai: "mThemeMonokai",
    "solarized-dark": "mThemeSolarizedDark",
    "solarized-light": "mThemeSolarizedLight"
  };
  Object.entries(menuBtnMap).forEach(([th, btnId]) => {
    const btn = $(btnId);
    if (btn) {
      const active = th === theme;
      btn.classList.toggle("active", active);
      const chk = btn.querySelector(".menu-check");
      if (chk) chk.innerHTML = active ? "&#10003;" : "&nbsp;";
    }
  });
}

function toggleZenMode(forceState) {
  const active = typeof forceState === "boolean" ? forceState : !document.body.classList.contains("zen-mode");
  document.body.classList.toggle("zen-mode", active);
  setTimeout(() => cm?.refresh(), 100);
  if (active) toast("Zen Mode enabled (Press Esc to exit)");
}

/* ------------------------------------------------------------------ *
 * Guide Modal Tabs
 * ------------------------------------------------------------------ */
function openGuideModal() {
  switchGuideTab("guideStructural");
  $("guideModal")?.classList.remove("hidden");
}

function closeGuideModal() {
  $("guideModal")?.classList.add("hidden");
}

function switchGuideTab(targetTabId) {
  const map = {
    shortcuts: "guideShortcuts",
    guideShortcuts: "guideShortcuts",
    structural: "guideStructural",
    guideStructural: "guideStructural",
    wave: "guideWave",
    guideWave: "guideWave",
    about: "guideAbout",
    guideAbout: "guideAbout"
  };
  const actualTab = map[targetTabId] || targetTabId || "guideStructural";
  document.querySelectorAll(".guide-tab-btn").forEach(btn => {
    const isTarget = (btn.dataset.tab === actualTab) || (btn.getAttribute("data-tab") === actualTab);
    btn.classList.toggle("active", isTarget);
  });
  document.querySelectorAll(".guide-tab-pane").forEach(pane => {
    const isTarget = pane.id === actualTab;
    pane.classList.toggle("active-pane", isTarget);
    pane.classList.toggle("hidden", !isTarget);
  });
}

/* ------------------------------------------------------------------ *
 * In-App Update Patch
 * ------------------------------------------------------------------ */
let selectedPatchFile = null;

function openUpdateModal() {
  selectedPatchFile = null;
  if ($("updateSelectedFile")) {
    $("updateSelectedFile").textContent = "";
    $("updateSelectedFile").classList.add("hidden");
  }
  if ($("updateDropText")) $("updateDropText").classList.remove("hidden");
  if ($("updateError")) $("updateError").textContent = "";
  if ($("updateStatus")) {
    $("updateStatus").textContent = "";
    $("updateStatus").classList.add("hidden");
  }
  if ($("btnApplyUpdate")) $("btnApplyUpdate").disabled = true;
  $("updateModal")?.classList.remove("hidden");
}

function closeUpdateModal() {
  $("updateModal")?.classList.add("hidden");
}

function handleSelectedPatchFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".zip")) {
    if ($("updateError")) $("updateError").textContent = "Please select a valid .zip patch archive.";
    if ($("btnApplyUpdate")) $("btnApplyUpdate").disabled = true;
    return;
  }
  selectedPatchFile = file;
  if ($("updateError")) $("updateError").textContent = "";
  if ($("updateDropText")) $("updateDropText").classList.add("hidden");
  if ($("updateSelectedFile")) {
    const sizeKb = (file.size / 1024).toFixed(1);
    $("updateSelectedFile").textContent = `📦 ${file.name} (${sizeKb} KB)`;
    $("updateSelectedFile").classList.remove("hidden");
  }
  if ($("btnApplyUpdate")) $("btnApplyUpdate").disabled = false;
}

async function applyUpdatePatch() {
  if (!selectedPatchFile) return;
  const btn = $("btnApplyUpdate");
  const statusEl = $("updateStatus");
  const errEl = $("updateError");

  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = "";
  if (statusEl) {
    statusEl.className = "update-status";
    statusEl.textContent = "Verifying patch and creating backup...";
    statusEl.classList.remove("hidden");
  }

  // Record current server boot_id before applying the update
  let initialBootId = null;
  try {
    const initRes = await fetch("/health?t=" + Date.now(), { cache: "no-store" });
    if (initRes.ok) {
      const initData = await initRes.json();
      initialBootId = initData.boot_id || null;
    }
  } catch (_) {}

  const formData = new FormData();
  formData.append("patch_file", selectedPatchFile);

  try {
    const resp = await fetch("/api/system/update", {
      method: "POST",
      body: formData
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.message || "Failed to install update patch.");
    }

    if (statusEl) {
      statusEl.className = "update-status success";
      statusEl.textContent = data.restart_required
        ? `✓ ${data.message} Restarting backend server...`
        : `✓ ${data.message} Refreshing IDE...`;
    }
    toast(data.restart_required ? "Update applied! Restarting backend..." : "Update applied! Refreshing IDE...");

    // Actively poll /health until the server has restarted and is fully responsive
    let reloaded = false;
    const maxRetries = 35; // ~21 seconds max
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, 600));
      try {
        const h = await fetch("/health?t=" + Date.now(), { cache: "no-store" });
        if (h.ok) {
          const hData = await h.json();
          // If restart was required, ensure the boot_id has changed (new server process has booted)
          if (data.restart_required && initialBootId && hData.boot_id === initialBootId) {
            continue; // Old server is still shutting down, wait for next tick
          }
          reloaded = true;
          if (statusEl) {
            statusEl.textContent = "✓ Server active! Reloading...";
          }
          setTimeout(() => {
            window.location.href = window.location.origin + window.location.pathname + "?v=" + Date.now();
          }, 250);
          return;
        }
      } catch (_) {
        // Server is in the middle of restarting, continue waiting
        if (statusEl && data.restart_required) {
          statusEl.textContent = `Restarting server... (${i + 1}/${maxRetries})`;
        }
      }
    }
    if (!reloaded) {
      if (errEl) {
        errEl.textContent = "Server restart could not be verified automatically. Please close this window and restart run_webapp.bat manually.";
      }
      if (btn) btn.disabled = false;
    }

  } catch (err) {
    if (errEl) errEl.textContent = String(err.message || err);
    if (statusEl) statusEl.classList.add("hidden");
    if (btn) btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * UI Event Wiring
 * ------------------------------------------------------------------ */
function wire() {
  // Navigation & Project Manager
  $("btnNewProject")?.addEventListener("click", openWizard);
  $("btnRefreshProjects")?.addEventListener("click", loadProjectList);
  $("wizClose")?.addEventListener("click", closeWizard);
  $("wizCancel")?.addEventListener("click", closeWizard);
  $("wizAddPort")?.addEventListener("click", () => { wizAddRow(); wizRefreshPreview(); });
  $("wizCreate")?.addEventListener("click", wizCreateProject);
  $("wizName")?.addEventListener("input", () => {
    const raw = ($("wizName").value || "").trim();
    const val = raw.replace(/[^a-zA-Z0-9_]/g, "_");
    if (!$("wizEntity").dataset.touched) $("wizEntity").value = val;
    if (!$("wizFolder").dataset.touched) $("wizFolder").value = val;
    wizRefreshPreview();
  });
  $("wizEntity")?.addEventListener("input", () => {
    $("wizEntity").dataset.touched = "true";
    wizRefreshPreview();
  });
  $("wizFolder")?.addEventListener("input", () => {
    $("wizFolder").dataset.touched = "true";
    wizRefreshPreview();
  });
  $("wizStandard")?.addEventListener("change", wizRefreshPreview);
  $("wizAuthor")?.addEventListener("input", wizRefreshPreview);
  $("wizArch")?.addEventListener("input", wizRefreshPreview);

  $("tbAdd")?.addEventListener("click", addQuickTestbenchFromPrompt);
  $("tbNotNow")?.addEventListener("click", () => {
    $("tbModal")?.classList.add("hidden");
    toast("You can add testbenches at any time via Project Navigator (+)");
  });

  $("btnBack")?.addEventListener("click", async () => {
    await saveProject(false);
    showScreen("welcome");
  });

  $("btnSave")?.addEventListener("click", () => saveProject(true));
  $("btnCheck")?.addEventListener("click", runCheckSyntax);
  $("btnSim")?.addEventListener("click", runSimulate);
  $("btnClear")?.addEventListener("click", () => { if ($("console")) $("console").innerHTML = ""; });

  // Export dropdown
  const exportBtn = $("btnExportMenu");
  const exportMenu = $("exportMenu");
  if (exportBtn && exportMenu) {
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle("hidden");
    });
    window.addEventListener("click", () => exportMenu.classList.add("hidden"));
    $("btnExportDesign")?.addEventListener("click", exportCurrentFile);
    $("btnExportTb")?.addEventListener("click", exportActiveTestbench);
    $("btnExportRar")?.addEventListener("click", openRarModal);
    $("btnExportZip")?.addEventListener("click", exportZipPackage);
  }

  // RAR Modal
  $("rarClose")?.addEventListener("click", closeRarModal);
  $("rarCancel")?.addEventListener("click", closeRarModal);
  $("btnRarSaveDisk")?.addEventListener("click", exportRarToDisk);
  $("btnRarDownload")?.addEventListener("click", exportRarDownload);
  $("rarCustomPath")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") exportRarToDisk();
  });
  $("rarFilename")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") exportRarDownload();
  });

  // Editor tools
  $("btnFormat")?.addEventListener("click", formatCurrentEditor);
  $("btnImport")?.addEventListener("click", () => $("fileImport").click());
  $("fileImport")?.addEventListener("change", (e) => handleVHDLFiles(e.target.files));
  $("selSnippet")?.addEventListener("change", (e) => {
    insertSnippet(e.target.value);
    e.target.selectedIndex = 0;
  });

  // Template Modal
  $("templateClose")?.addEventListener("click", closeTemplateModal);
  $("templateCancel")?.addEventListener("click", closeTemplateModal);
  $("templateInsert")?.addEventListener("click", () => {
    const code = SNIPPETS[currentSelectedTemplate];
    if (code && cm) {
      const doc = cm.getDoc();
      doc.replaceRange("\n" + code + "\n", doc.getCursor());
      cm.focus();
      toast("Template inserted into editor");
    }
    closeTemplateModal();
  });
  $("templateModal")?.addEventListener("click", (e) => {
    if (e.target === $("templateModal")) closeTemplateModal();
  });
  document.querySelectorAll(".template-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tpl = btn.dataset.tpl;
      if (tpl && SNIPPETS[tpl]) {
        currentSelectedTemplate = tpl;
        updateTemplateModalView();
      }
    });
  });

  // Quick stop-time chips
  document.querySelectorAll(".chip-btn").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip-btn").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      $("stopTime").value = chip.dataset.time;
    });
  });

  // Editor theme
  if ($("selTheme")) {
    $("selTheme").addEventListener("change", (e) => applyTheme(e.target.value));
  }

  // Zen mode
  $("btnZen")?.addEventListener("click", () => toggleZenMode());
  $("btnExitZen")?.addEventListener("click", () => toggleZenMode(false));

  // Components modal
  $("btnComponents")?.addEventListener("click", openComponentsModal);
  $("compClose")?.addEventListener("click", closeComponentsModal);
  $("compDone")?.addEventListener("click", closeComponentsModal);
  $("compFilter")?.addEventListener("input", renderComponentsList);
  $("btnImportCompToProj")?.addEventListener("click", () => {
    if (compState.selected) importComponentToCurrentProject(compState.selected);
  });
  $("btnInsertDecl")?.addEventListener("click", () => {
    if (compState.selected?.snippets?.declaration) {
      insertSnippetIntoEditor(compState.selected.snippets.declaration);
      closeComponentsModal();
    }
  });
  $("btnInsertMap")?.addEventListener("click", () => {
    if (compState.selected?.snippets?.instantiation) {
      insertSnippetIntoEditor(compState.selected.snippets.instantiation);
      closeComponentsModal();
    }
  });

  // Guide modal
  $("btnGuide")?.addEventListener("click", openGuideModal);
  $("btnWelcomeGuide")?.addEventListener("click", openGuideModal);
  $("guideClose")?.addEventListener("click", (e) => { e.preventDefault(); closeGuideModal(); });
  $("guideDone")?.addEventListener("click", (e) => { e.preventDefault(); closeGuideModal(); });
  $("guideModal")?.addEventListener("click", (e) => {
    if (e.target === $("guideModal")) closeGuideModal();
  });

  const guideTabsContainer = document.querySelector(".guide-tabs");
  if (guideTabsContainer) {
    guideTabsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".guide-tab-btn");
      if (btn) {
        const tab = btn.dataset.tab || btn.getAttribute("data-tab");
        if (tab) switchGuideTab(tab);
      }
    });
  }
  document.querySelectorAll(".guide-tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const tab = btn.dataset.tab || btn.getAttribute("data-tab");
      if (tab) switchGuideTab(tab);
    });
  });

  // Backdrop overlay click handlers for all modals
  $("wizardModal")?.addEventListener("click", (e) => { if (e.target === $("wizardModal")) closeWizard(); });
  $("addSourceModal")?.addEventListener("click", (e) => { if (e.target === $("addSourceModal")) closeAddSourceModal(); });
  $("renameModal")?.addEventListener("click", (e) => { if (e.target === $("renameModal")) closeRenameModal(); });
  $("componentsModal")?.addEventListener("click", (e) => { if (e.target === $("componentsModal")) closeComponentsModal(); });
  $("tbModal")?.addEventListener("click", (e) => { if (e.target === $("tbModal")) $("tbModal").classList.add("hidden"); });
  $("rarModal")?.addEventListener("click", (e) => { if (e.target === $("rarModal")) closeRarModal(); });
  $("updateModal")?.addEventListener("click", (e) => { if (e.target === $("updateModal")) closeUpdateModal(); });

  // Update Patch modal wiring
  $("btnWelcomeUpdate")?.addEventListener("click", openUpdateModal);
  $("updateClose")?.addEventListener("click", closeUpdateModal);
  $("updateCancel")?.addEventListener("click", closeUpdateModal);
  $("btnApplyUpdate")?.addEventListener("click", applyUpdatePatch);

  const updateDrop = $("updateDropzone");
  const updateInput = $("updateFileInput");
  if (updateDrop && updateInput) {
    updateDrop.addEventListener("click", () => updateInput.click());
    updateInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        handleSelectedPatchFile(e.target.files[0]);
      }
    });
    updateDrop.addEventListener("dragover", (e) => {
      e.preventDefault();
      updateDrop.classList.add("dragover");
    });
    updateDrop.addEventListener("dragleave", () => {
      updateDrop.classList.remove("dragover");
    });
    updateDrop.addEventListener("drop", (e) => {
      e.preventDefault();
      updateDrop.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleSelectedPatchFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Waveform viewer trigger
  $("btnWave")?.addEventListener("click", () => {
    if (!state.waveDocs) return;
    const d = state.waveDocs;
    window.WaveViewer.open(d, `${d.tb_entity} · ${d.end_time_ns} ns · ${d.signals.length} signals · stop-time ${d.stop_time}`);
  });

  // Editor font size
  $("fontInc")?.addEventListener("click", () => setFontSize(state.fontSize + 1));
  $("fontDec")?.addEventListener("click", () => setFontSize(state.fontSize - 1));

  // Modals & Project Navigator features
  wireNavSplitter();
  wireContextMenu();
  wireAddSourceModal();
  wireRenameModal();
  wireSimTargetDropdown();
  wireConsoleSplitter();
  wireEdaMenubar();

  // Escape key handler
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.body.classList.contains("zen-mode")) {
        toggleZenMode(false);
        return;
      }
      closeWizard();
      closeComponentsModal();
      closeGuideModal();
      closeAddSourceModal();
      closeRenameModal();
      closeRarModal();
      closeUpdateModal();
      $("tbModal").classList.add("hidden");
      window.WaveViewer?.close();
    }
    if (e.key === "F7" || (e.ctrlKey && (e.key === "b" || e.key === "B"))) {
      e.preventDefault();
      runCheckSyntax();
    }
    if (e.altKey && (e.key === "1" || e.code === "Digit1")) {
      e.preventDefault();
      toggleNavPane();
    }
    if (e.key === "F5" || (e.ctrlKey && e.key === "Enter")) {
      e.preventDefault();
      runSimulate();
    }
    if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault(); setFontSize(state.fontSize + 1);
    }
    if (e.ctrlKey && e.key === "-") {
      e.preventDefault(); setFontSize(state.fontSize - 1);
    }
    if (e.ctrlKey && e.key === "0") {
      e.preventDefault(); setFontSize(13.5);
    }
  });

  window.addEventListener("resize", () => {
    if (state.screen === "app") cm?.refresh();
  });
}

/* ------------------------------------------------------------------ *
 * System Boot
 * ------------------------------------------------------------------ */
(async function boot() {
  initEditor();
  wire();
  showScreen("welcome");
  try {
    const h = await fetch("/health").then(r => r.json());
    const chip = $("welcomeGhdl");
    if (h.ghdl_found) {
      chip.textContent = "GHDL ready";
      chip.classList.add("on");
    } else {
      chip.textContent = "GHDL not found";
      chip.classList.add("off");
    }
  } catch (_) { /* backend offline */ }
})();
