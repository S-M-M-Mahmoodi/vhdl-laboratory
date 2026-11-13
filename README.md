# Digital Systems Laboratory 2 — Offline VHDL Simulator & EDA Environment
> **Author & Software Architect:** S.M.M.Mahmoodi  
> **Copyright:** &copy; 2026 S.M.M.Mahmoodi  
> **License:** MIT License  

A desktop-grade, offline web-based Electronic Design Automation (EDA) suite and behavioral simulator for digital systems, computer architecture, and hardware description language (HDL) education. Fully compliant with **IEEE VHDL-2008**, replicating the core design workflows of industry-standard tools like Xilinx Vivado, Xilinx ISE Project Navigator, and ModelSim.

Powered by the open-source **GHDL** compiler (bundled in offline release packages or installed via system PATH), interactive **CodeMirror** multi-tab editor, a professional **Project Navigator (Design & Simulation Sources)** tree, and a high-precision vector **Waveform Viewer**.

---

## Workspace Architecture

```text
vhdl-laboratory/
  LICENSE                   <-- MIT License & Copyright Notice (S.M.M.Mahmoodi)
  README.md                 <-- Comprehensive technical documentation & user guide
  run_webapp.bat            <-- One-click Windows launcher (double-click to start)
  run_webapp.sh             <-- One-click Linux & macOS launcher (./run_webapp.sh)
  app.py                    <-- Flask EDA backend (GHDL controller, multi-file compilation, VCD parser)
  index.html                <-- Responsive IDE interface with Project Navigator & Waveform Viewer
  test_suite.py             <-- End-to-end automated test suite (27 verified test cases; skips T18 gracefully if WinRAR is absent)
  assets\
    css\app.css             <-- Dark theme stylesheets (VS Code Dark+, Vivado Dark, Monokai Pro)
    js\app.js               <-- Application logic, Project Navigator controller, dynamic multi-tab manager
    js\waveviewer.js        <-- Vector waveform timing engine (dual cursors, value inspector, SVG/PNG export)
    fonts\                  <-- Offline typography (Inter, JetBrains Mono)
    vendor\                 <-- Offline CodeMirror core & VHDL syntax highlighters
  projects\                 <-- Local project storage database (JSON schemas & on-disk VHDL files)
  workspace\                <-- Isolated scratchpad for GHDL compilation and VCD generation
  ghdl-mcode-6.0.0-ucrt64\  <-- Bundled native GHDL toolchain in distribution zip (or install via PATH)
```

---

## Core Capabilities & Engineering Features

### 1. Professional Project Navigator (EDA Sources Tree & Hierarchy)
Like modern FPGA/ASIC EDA suites (Vivado / ISE), the left sidebar provides hierarchical project control:
- **Hierarchical Design Sources Tree**: Organizes hardware architecture blocks into an expandable component tree:
  - **`[TOP]` Module Root**: Visually designates the active top-level design module for synthesis and analysis with an expand/collapse toggle.
  - **Sub-Component Hierarchy**: Modules instantiated inside the top-level architecture (e.g. `ha1: half_adder`, `ha2: half_adder`) are dynamically parsed and displayed hierarchically underneath their parent module (`├── inst_name : entity_name (file.vhd)`).
  - Clicking any sub-module node in the hierarchy immediately opens its source file in the editor buffer.
  - Right-clicking any module node provides instant context menu actions.
  - Unreferenced design sources are grouped and displayed cleanly below the main hierarchy.
- **Simulation Sources Group**: Organizes testbench verification benches (e.g. `tb_half_adder.vhd`, `tb_ripple_adder_4bit.vhd`).
  - **`[ACTIVE TB]` Badge**: Visually identifies the target testbench currently selected for elaboration and waveform capture.
- **Right-Click Context Menu**:
  - 🎯 **Set as Top-Level Module**: Mark selected module as top entity.
  - 🧪 **Set as Active Testbench**: Select this testbench for simulation.
  - ⚡ **Simulate This Testbench**: Immediately elaborate and execute simulation for this testbench.
  - ➕ **Generate Testbench for Module...**: Auto-generate an ISE-style testbench skeleton targeting the selected module as DUT with clock generator and stimulus process.
  - 📋 **Copy Component Declaration**: Auto-generate `component <name> is port (...); end component;` directly to the clipboard.
  - ⚡ **Copy Port Map Instantiation**: Auto-generate instance template `U_<name> : <name> port map (...);` directly to the clipboard.
  - ✏️ **Rename File...**: Rename files with optional automatic in-code entity identifier synchronization.
  - 🗑️ **Delete File**: Remove source files from the project safely.
- **Target Testbench Selector**: Dropdown in the top navigation bar (`Target TB: [▼]`) allowing instant switching between multiple verification benches.

### 2. Multi-Tab Code Editor
- **Independent Document Buffers**: Each file retains its own `CodeMirror.Doc` instance, preserving cursor position, scroll state, undo/redo history, and error gutters when switching tabs.
- **Dynamic Tab Strip**: Click any file in the Project Navigator to open it in a tab. Includes unsaved modified indicators (`●`) and tab close (`×`) controls.
- **Multi-File Structural Modeling**: Easily build hierarchical systems:
  $$\text{Half Adder} \longrightarrow \text{Full Adder} \longrightarrow \text{4-Bit Ripple Adder} \longrightarrow \text{Testbenches}$$
- **VHDL Formatter (Shift+Alt+F)**: Cleans and standardizes code indentation and keyword alignment.
- **Built-In Snippets**: Synchronous process (`rising_edge(clk)`), asynchronous reset, combinational process, two-process FSM, clock generator, and stimulus templates.
- **Editor Themes**: VS Code Dark+ (default), One Dark Pro, Cyberpunk Neon (Dark), Monokai Pro, Solarized Dark, Light (Clean), and Solarized Light.
- **Zen Mode**: Distraction-free full-screen coding mode toggled with `Esc` or the Zen button.

### 3. Advanced Vector Waveform Viewer
- **Strictly Positive Timeline**: Time axis strictly begins at $t \ge 0\text{ ns}$. Negative time navigation and scrolling artifacts are prevented.
- **Decoupled SVG & PNG Export**: The signal names column (`NAME_W = 180`) is visually separated with its own background and separator line. Waveform traces never overlap signal names. PNG exports render at 2x Retina resolution with transparent backgrounds.
- **Accurate Contention & Unknown State ('X'/'U'/'W') Rendering**: Whenever a signal experiences bus contention, driver conflict, or uninitialized states (`'X'`, `'U'`, `'W'`), the waveform viewer renders a prominent shaded red hazard box (`#ff4d4f`), red rails, and centered 'X' markers. The real-time value inspector badge immediately highlights in alert red (`.bad-val`).
- **Real-Time Value Inspector**: When measurement cursors are active, live bus values are displayed directly inside the left signal labels column in the selected radix.
- **Clock Edge Navigation Buttons (`|◀` and `▶|`)**: Snap measurement cursors directly to previous or next signal transitions for precise setup/hold and propagation delay calculations.
- **Dual Measurement Cursors**:
  - **Cursor A**: Left-click on any trace.
  - **Cursor B**: Right-click or `Shift + Left-Click`.
  - Calculates time delta ($\Delta t = |t_B - t_A|$) and equivalent operating frequency ($f = 1/\Delta t$).
- **Visual Zebra Striping**: Alternating row backgrounds ensure effortless tracking across wide displays and high signal counts.
- **Per-Signal Radix Formatting**: Switch bus representation between Hexadecimal, Decimal, and Binary on the fly.
- **IEEE-1364 VCD Export & GTKWave Bridge**: One-click download of raw simulation VCD traces (`tb_entity.vcd`) directly from the Waveform Viewer toolbar or menubar (`Simulation -> Download Waveform (.vcd)...`). Enables students to inspect simulations in GTKWave (industry-standard EDA tool) or attach full traces to laboratory reports.

### 4. 100% Offline Standalone Operation
- Zero external internet access or CDN dependencies during simulation and IDE operation.
- Once initial dependencies are installed (`pip install -r requirements.txt`), all editor assets, vector fonts (Inter & JetBrains Mono), simulation engines, and waveform renderers operate completely air-gapped without network connectivity.
- Portable: Runs directly from any folder or USB drive across Windows, Linux, and macOS.

---

## Prerequisites & Installation

1. **Python 3.8+**:
   ```bash
   pip install -r requirements.txt
   ```

2. **GHDL Compiler** (Open-source IEEE VHDL simulator):
   - **Windows**: Download `ghdl-mcode-*-ucrt64.zip` from [GHDL Official Releases](https://github.com/ghdl/ghdl/releases) and extract it into the project directory as `ghdl-mcode-6.0.0-ucrt64\`, or add `ghdl.exe` to your system `PATH`.
   - **Linux (Debian/Ubuntu)**: `sudo apt install ghdl`
   - **macOS**: `brew install ghdl`

---

## Quickstart Guide

1. Double-click the launcher script:
   ```cmd
   run_webapp.bat
   ```
2. The launcher will automatically:
   - Detect and add `ghdl-mcode-6.0.0-ucrt64\bin` to the session `PATH`.
   - Start the local Python Flask web server.
   - Launch your default web browser at `http://127.0.0.1:5000`.

---

## Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Alt</kbd> + <kbd>1</kbd> | **Toggle Navigator** | Expand or collapse the Project Navigator sidebar |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> or <kbd>F5</kbd> | **Simulate** | Elaborate active testbench, run simulation, and open Waveform Viewer |
| <kbd>Ctrl</kbd> + <kbd>B</kbd> or <kbd>F7</kbd> | **Check Syntax** | Analyze all project design and simulation sources with GHDL |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | **Save Project** | Save all open files and project configuration to disk |
| <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> | **Format Code** | Auto-indent and format the active VHDL source buffer |
| <kbd>Ctrl</kbd> + <kbd>/</kbd> | **Toggle Comment** | Comment or uncomment selected lines (`--`) |
| <kbd>Esc</kbd> | **Exit / Close** | Exit Zen Mode or close open modals and dialogs |
| <kbd>Ctrl</kbd> + <kbd>Wheel</kbd> | **Zoom Font** | Dynamically adjust editor font size |
| <kbd>Mouse Wheel</kbd> | **Wave Zoom** | Zoom timing waveforms centered at cursor position |

---

## Dedicated Project Folders, Component Manager & RAR Export

- **Isolated Project Directories**: Every project is saved in its own directory under `projects/<folder>/` with real on-disk `.vhd` files and `project.json`.
- **Project-Grouped Component Manager**: The Component Manager categorizes reusable sub-blocks by project. Linking a component copies its `.vhd` source code directly into the current project folder and adds it to the design hierarchy.
- **Export to WinRAR (.rar) Archive**: Export the entire project as a `.rar` archive containing all `.vhd` files, `project.json`, `run_simulation.bat`, and `README.txt`. Save directly to any custom path on disk (e.g. `D:\Labs\` or Desktop) or download via browser.
- **VHDL Language Standards**: Select between VHDL-2008 (`--std=08`), VHDL-93 (`--std=93c`), VHDL-2002 (`--std=02`), VHDL-2019 (`--std=19`), or VHDL-1987 (`--std=87`).
- **Author & Date Metadata**: Specify custom designer names and track creation/update dates in templates and cards.

---

## In-App Update Patch System

When new updates (bug fixes, features, or course templates) are provided, lightweight update patches (`.zip`) can be installed directly through the interface without re-downloading the entire compiler package:

- Open **Help -> Install Update Patch (.zip)...** (or click the update badge on the Welcome Screen).
- Select or drag and drop the official update `.zip` patch.
- Click **Apply Update & Reload** — files are updated in-place with pre-update backups saved to `_backup_updates/`.
- **100% Student Safe**: Personal projects in `projects/` are strictly protected and never touched or overwritten.

---

## Automated Verification & Test Suite

An end-to-end regression test suite verifies all compiler integrations, multi-file structural workflows, and export pipelines:

```cmd
python test_suite.py
```

### Verified Test Results:
```text
========================================================================
 Digital Systems Laboratory 2 -- end-to-end test suite
 project root : /path/to/vhdl-laboratory
========================================================================
  [PASS] T1 check_syntax catches invalid VHDL with exact line number
  [PASS] T2 check_syntax passes a valid design with custom filenames
  [PASS] T3 simulate produces valid, time-aligned WaveDrom transitions
  [PASS] T4 simulate with broken design fails cleanly without VCD
  [PASS] T5 simulate with unknown testbench entity fails at elaboration
  [PASS] T6 invalid stop time is rejected
  [PASS] T7 back-to-back simulations are isolated and reproducible
  [PASS] T8 UI + vendor assets served, private files not exposed
  [PASS] T9 project manager save -> list -> load -> delete roundtrip
  [PASS] T10 check_syntax target=tb analyzes design + testbench together
  [PASS] T11 structural VHDL compilation with component dependencies
  [PASS] T12 multi-file project navigator compilation & simulation
  [PASS] T13 check_syntax handles projects with no active testbench gracefully
  [PASS] T14 simulate without testbench returns clean JSON error (no HTTP 500)
  [PASS] T15 directory-based project saves individual on-disk .vhd files & project.json
  [PASS] T16 VHDL standard flag (--std=08 vs --std=93c) passed correctly to GHDL
  [PASS] T17 /api/components categorizes modules by project & supports multiple files
  [PASS] T18 /api/projects/export_rar saves to custom path & downloads valid RAR archive
  [PASS] T19 GHDL report note/warning parsed into infos/warnings (not errors)
  [PASS] T20 Multi-file simulation validates tb_entity against IDENT_RE
  [PASS] T21 Component dependency resolution handles folder projects without design_code
  [PASS] T22 Thread-safe simulation & check_syntax via SIM_LOCK
  [PASS] T23 Advanced waveform viewer features (snap, stats, CSV, maximize, persistence)
  [PASS] T24 Desktop EDA Menubar & Quick-Access Toolbar
  [PASS] T25 VHDL Laboratory branding, Light/Monokai/Solarized themes, templates modal & status display
  [PASS] T26 In-App Update Patch system, safety guards & instructor packager
  [PASS] T27 IEEE-1364 VCD trace download endpoint & GTKWave integration
------------------------------------------------------------------------
 RESULT: 27/27 tests passed -- 100% VERIFIED
```

> **Note on Test Portability:** Test `T18` verifies RAR archive creation and export. On host systems where WinRAR (`Rar.exe` or `rar`) is not installed (such as Linux/macOS environments), `T18` is gracefully skipped (`[SKIP]`) without breaking the test run.

---

## License & Attribution

This project is licensed under the **MIT License**:

```text
Copyright (c) 2026 S.M.M.Mahmoodi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

For licenses and attributions of third-party open-source components (CodeMirror, Inter Font, JetBrains Mono Font, and GHDL), see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
