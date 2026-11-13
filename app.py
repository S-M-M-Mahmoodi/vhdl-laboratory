#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Digital Systems Laboratory 2 -- Offline VHDL Simulator & EDA Environment
========================================================================
Copyright (c) 2026 S.M.M.Mahmoodi
Author & Lead Maintainer: S.M.M.Mahmoodi

Replicates the two core Xilinx ISE Project Navigator processes on top of GHDL:

  1. "Check Syntax"
       ghdl -a --std=08 workspace/<comp>.vhd   (for all structural dependencies)
       ghdl -a --std=08 workspace/<design>.vhd
       -> parse compiler errors / warnings with line numbers, no simulation.
       (target="tb" additionally analyzes the testbench after the design)

  2. "Simulate Behavioral Model"
       ghdl -a --std=08 workspace/<comp>.vhd   (for all structural dependencies)
       ghdl -a --std=08 workspace/<design>.vhd
       ghdl -a --std=08 workspace/<tb>.vhd
       ghdl -e --std=08 <tb_entity>
       ghdl -r --std=08 <tb_entity> --vcd=wave.vcd --stop-time=<time>
       -> parse workspace/wave.vcd with `vcdvcd` and convert to WaveDrom JSON.

Project manager: user projects are stored as JSON files under projects/ so
they survive server restarts and can be re-opened from the welcome screen.
Supports multi-file structural VHDL designs with automatic component dependency
compilation, entity port mapping, and snippet generation.

All paths are derived from this file's location, so the project folder can live
at F:\VHDL (Windows) or anywhere else. GHDL is expected on PATH; set GHDL_BIN
to an explicit executable path if needed (run_webapp.bat does this for you).

Launch:  python app.py      ->  http://127.0.0.1:5000
"""

from __future__ import annotations

import decimal
import functools
import io
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory, send_file
from werkzeug.serving import make_server

# ---------------------------------------------------------------------------
# Paths & configuration
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = BASE_DIR / "workspace"
ASSETS_DIR = BASE_DIR / "assets"
PROJECTS_DIR = BASE_DIR / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_UPDATES_DIR = BASE_DIR / "_backup_updates"
SIM_LOCK = threading.Lock()

APP_VERSION = "1.0.0"
SERVER_BOOT_ID = str(uuid.uuid4())[:8]
SERVER_BOOT_TIME = datetime.now(timezone.utc).isoformat()
GLOBAL_SERVER = None


def find_available_port(preferred: int = 5000) -> int:
    """Find the first available TCP port on 127.0.0.1.

    Handles Windows 10/11 excluded port ranges (WinError 10013 / WSAEACCES)
    caused by Hyper-V, WSL2, Docker, or WinNAT, as well as busy ports (WinError 10048).
    """
    candidates = [preferred] if preferred else []
    for p in [5000, 5050, 8000, 5001, 8080, 3000, 5002]:
        if p not in candidates:
            candidates.append(p)
    candidates.extend(range(5051, 5100))

    for p in candidates:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", p))
                return p
        except OSError:
            continue
    return preferred


def wait_for_port_release(target_port: int, max_retries: int = 12, delay: float = 0.4) -> bool:
    """Wait for target_port to be released by a dying/restarting process (WinError 10048)."""
    for _ in range(max_retries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", target_port))
                return True
        except OSError as e:
            err_code = getattr(e, "winerror", None)
            err_str = str(e)
            if err_code == 10048 or "10048" in err_str:
                time.sleep(delay)
            else:
                return False
    return False

ALLOWED_UPDATE_EXTS = {
    ".py", ".html", ".js", ".css", ".json", ".woff2", ".woff", ".ttf",
    ".svg", ".png", ".jpg", ".ico", ".md", ".txt", ".bat", ".cmd", ".sh"
}
ALLOWED_UPDATE_FILENAMES = {
    "license",
}
PROTECTED_PREFIXES = (
    "projects/", "projects\\",
    "workspace/", "workspace\\",
    "_backup_updates/", "_backup_updates\\",
    "ghdl-mcode-6.0.0-ucrt64/", "ghdl-mcode-6.0.0-ucrt64\\",
    ".git/", ".git\\",
    "make_patch.bat",
    "make_patch.py"
)


def synchronized_workspace(fn):
    """Serialize workspace operations so concurrent requests do not collide."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with SIM_LOCK:
            return fn(*args, **kwargs)
    return wrapper

def _resolve_ghdl_bin() -> str:
    env_bin = os.environ.get("GHDL_BIN")
    if env_bin:
        return env_bin
    which_bin = shutil.which("ghdl")
    if which_bin:
        return which_bin
    bundled = BASE_DIR / "ghdl-mcode-6.0.0-ucrt64" / "bin" / "ghdl.exe"
    if bundled.is_file():
        bin_dir = str(bundled.parent)
        if bin_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = f"{bin_dir};{os.environ.get('PATH', '')}"
        return str(bundled)
    for candidate in sorted(BASE_DIR.glob("ghdl*/bin/ghdl.exe")):
        if candidate.is_file():
            bin_dir = str(candidate.parent)
            if bin_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = f"{bin_dir};{os.environ.get('PATH', '')}"
            return str(candidate)
    return "ghdl"


GHDL_BIN = _resolve_ghdl_bin()
VHDL_STD = "08"
VALID_STANDARDS = {
    "08": "08",
    "2008": "08",
    "93": "93c",
    "93c": "93c",
    "1993": "93c",
    "02": "02",
    "2002": "02",
    "19": "19",
    "2019": "19",
    "87": "87",
    "1987": "87",
}


def _get_std(data: dict | None) -> str:
    if not isinstance(data, dict):
        return VHDL_STD
    raw = str(data.get("standard") or data.get("vhdl_standard") or (data.get("project") or {}).get("standard") or "").strip().lower()
    return VALID_STANDARDS.get(raw, VHDL_STD)


GHDL_TIMEOUT_S = 120
MAX_OUTPUT_CHARS = 200_000        # cap captured GHDL console output

STOP_TIME_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?\s*$")
# simulated-time unit -> femtoseconds multiplier
UNIT_TO_FS = {
    "fs": 1,
    "ps": 10 ** 3,
    "ns": 10 ** 6,
    "us": 10 ** 9,
    "ms": 10 ** 12,
    "sec": 10 ** 15, "s": 10 ** 15,
    "min": 60 * 10 ** 15,
    "hr": 3600 * 10 ** 15,
}
IDENT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
ENTITY_RE = re.compile(r"\bentity\s+([A-Za-z][A-Za-z0-9_]*)\s+is", re.IGNORECASE)

MAX_STOP_FS = 10 ** 15            # cap simulations at 1 ms of simulated time
MAX_WAVEDROM_SLOTS = 1200         # keep the browser waveform rendering snappy
VHDL_FILE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*\.(vhd|vhdl)$", re.IGNORECASE)
PORT_DIRS = ("in", "out", "inout")

app = Flask(__name__, static_folder=None)

_GHDL_VERSION_CACHE: str | None = None


# ---------------------------------------------------------------------------
# GHDL message parsing
#
# Observed GHDL 6.0 formats:
#   design.vhd:15:16:error: no declaration for "whatever"
#   design.vhd:12:5:warning: declaration of signal "x" is not used
#   ghdl:error: cannot find entity or configuration tb_x
#   ghdl:info: simulation stopped by --stop-time @1us
#   tb_design.vhd:45:9:@100ns:(assertion failure): count mismatch
# Older GHDL releases omit the "error:"/"warning:" keyword:
#   design.vhd:12:5: ';' is expected
# ---------------------------------------------------------------------------
RE_ASSERT = re.compile(
    r"^(?P<path>.+?):(?P<line>\d+):(?P<col>\d+):@(?P<simtime>[^:]+):"
    r"\((?P<action>assertion|report) (?P<kind>failure|error|warning|note|info)\):? ?(?P<msg>.*)$")
RE_TYPED = re.compile(
    r"^(?P<path>.+?):(?P<line>\d+):(?P<col>\d+):"
    r"(?P<kind>error|warning|info|note|fatal): ?(?P<msg>.*)$")
RE_CMD = re.compile(
    r"^.*?\bghdl(?:\.exe)?:(?P<kind>error|warning|info|failure|fatal): ?(?P<msg>.*)$",
    re.IGNORECASE,
)
RE_PLAIN = re.compile(r"^(?P<path>.+?):(?P<line>\d+):(?P<col>\d+): ?(?P<msg>.*)$")


def _msg(path: str, line, col, kind: str, text: str, simtime: str | None = None) -> dict:
    out = {
        "file": Path(path).name if path else None,
        "line": int(line) if line is not None else None,
        "col": int(col) if col is not None else None,
        "kind": kind,
        "message": text,
    }
    if simtime:
        out["sim_time"] = simtime
    return out


def parse_ghdl_output(text: str):
    """Split GHDL console output into (errors, warnings, infos) message dicts."""
    errors, warnings, infos = [], [], []
    for raw in (text or "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        m = RE_ASSERT.match(line)
        if m:
            raw_kind = m.group("kind").lower()
            if raw_kind in ("failure", "error"):
                kind = "error"
            elif raw_kind == "warning":
                kind = "warning"
            else:
                kind = "info"
            entry = _msg(m.group("path"), m.group("line"), m.group("col"), kind,
                         m.group("msg"), simtime=m.group("simtime"))
        else:
            m = RE_TYPED.match(line)
            if m:
                kind = {"fatal": "error"}.get(m.group("kind"), m.group("kind"))
                entry = _msg(m.group("path"), m.group("line"), m.group("col"),
                             kind, m.group("msg"))
            else:
                m = RE_CMD.match(line)
                if m:
                    kind = {"failure": "error", "fatal": "error"}.get(m.group("kind"),
                                                                      m.group("kind"))
                    entry = _msg(None, None, None, kind, m.group("msg"))
                else:
                    m = RE_PLAIN.match(line)
                    if m:
                        entry = _msg(m.group("path"), m.group("line"), m.group("col"),
                                     "error", m.group("msg"))
                    else:
                        continue  # source echo / caret lines and plain chatter
        target = {"error": errors, "warning": warnings, "info": infos}[entry["kind"]]
        target.append(entry)
    return errors, warnings, infos


# ---------------------------------------------------------------------------
# Workspace & GHDL process helpers
# ---------------------------------------------------------------------------
def reset_workspace() -> None:
    """Recreate the scratchpad so every run starts from a clean work library."""
    shutil.rmtree(WORKSPACE_DIR, ignore_errors=True)
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)


def write_source(filename: str, code: str) -> None:
    with open(WORKSPACE_DIR / filename, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(code if code.endswith("\n") else code + "\n")


def run_ghdl(args: list[str], timeout: int = GHDL_TIMEOUT_S):
    """Run ghdl with cwd=workspace; returns (returncode, combined_output)."""
    cmd = [GHDL_BIN] + args
    try:
        proc = subprocess.run(
            cmd, cwd=str(WORKSPACE_DIR), capture_output=True,
            text=True, timeout=timeout, shell=False,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode, out[:MAX_OUTPUT_CHARS], None
    except FileNotFoundError:
        return None, "", (
            f"GHDL executable '{GHDL_BIN}' was not found. Install GHDL and make sure "
            f"'ghdl' is on your PATH, or set the GHDL_BIN environment variable."
        )
    except subprocess.TimeoutExpired:
        return None, "", f"GHDL timed out after {timeout}s ({' '.join(args)})."


def ghdl_version() -> str | None:
    global _GHDL_VERSION_CACHE
    if _GHDL_VERSION_CACHE is None:
        try:
            proc = subprocess.run([GHDL_BIN, "--version"], capture_output=True,
                                  text=True, timeout=15)
            first = (proc.stdout or "").strip().splitlines()
            _GHDL_VERSION_CACHE = first[0] if first else "GHDL"
        except Exception:
            return None
    return _GHDL_VERSION_CACHE


def log_entry(level: str, text: str) -> dict:
    return {"level": level, "text": text}


def validate_stop_time(raw) -> tuple[str | None, int | None, str | None]:
    """Normalize the stop time; returns (ghdl_time_str, total_fs, error_message)."""
    if raw is None or str(raw).strip() == "":
        raw = "1us"
    m = STOP_TIME_RE.match(str(raw))
    if not m:
        return None, None, f"Invalid stop time {raw!r}. Use e.g. 500ns, 1us, 2ms."
    value_s, unit = m.group(1), (m.group(2) or "ns").lower()
    if unit not in UNIT_TO_FS:
        return None, None, (f"Unknown time unit {unit!r}. "
                            f"Supported: {', '.join(sorted(UNIT_TO_FS))}.")
    total_fs = int(round(float(value_s) * UNIT_TO_FS[unit]))
    if total_fs <= 0:
        return None, None, "Stop time must be greater than zero."
    if total_fs > MAX_STOP_FS:
        return None, None, "Stop time too large (max 1 ms of simulated time)."
    return f"{value_s}{unit}", total_fs, None


# ---------------------------------------------------------------------------
# VCD -> WaveDrom conversion (vcdvcd)
# ---------------------------------------------------------------------------
TIMESCALE_RE = re.compile(
    r"\$timescale\s*(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|sec|s|min|hr)?\s*\$end",
    re.IGNORECASE | re.DOTALL)


def _fmt_ns(ns: Decimal) -> str:
    if ns == ns.to_integral_value():
        return str(int(ns))
    return f"{float(ns):.3f}".rstrip("0").rstrip(".")


def estimate_testbench_duration_fs(tb_code: str) -> tuple[int, bool]:
    """Calculate active stimulus duration and detect whether testbench has free-running loops (e.g. clock)."""
    if not tb_code:
        return 0, False

    # Strip single-line VHDL comments so commented-out code does not affect timing
    code_no_comments = re.sub(r"--.*$", "", tb_code, flags=re.MULTILINE)

    proc_re = re.compile(
        r"(?:(\w+)\s*:\s*)?process\b(?:\s*\([^)]*\))?(.*?)end\s+process",
        re.IGNORECASE | re.DOTALL
    )
    max_duration_fs = 0
    has_clock_loop = False

    for m in proc_re.finditer(code_no_comments):
        body = m.group(2)
        has_wait_forever = bool(re.search(r"\bwait\s*;", body, re.IGNORECASE))
        waits = re.findall(
            r"\bwait\s+for\s+(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|sec|s)?\b",
            body, re.IGNORECASE
        )
        proc_fs = 0
        for num_s, unit in waits:
            mult = UNIT_TO_FS.get((unit or "ns").lower(), 1_000_000)
            proc_fs += int(float(num_s) * mult)

        # Also account for any 'after' delay clauses within this process
        after_in_proc = re.findall(
            r"\bafter\s+(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|sec|s)?\b",
            body, re.IGNORECASE
        )
        max_proc_after = 0
        for num_s, unit in after_in_proc:
            mult = UNIT_TO_FS.get((unit or "ns").lower(), 1_000_000)
            max_proc_after = max(max_proc_after, int(float(num_s) * mult))

        if has_wait_forever:
            max_duration_fs = max(max_duration_fs, proc_fs + max_proc_after)
        else:
            if waits or after_in_proc:
                has_clock_loop = True

    # Check for concurrent clock generator (e.g. clk <= not clk after 10 ns;)
    if re.search(r"\b(\w+)\s*<=\s*not\s*\(?\s*\1\s*\)?\s*after\b", code_no_comments, re.IGNORECASE):
        has_clock_loop = True

    # Account for concurrent 'after' assignments (e.g. s <= '1' after 30 ns;)
    all_afters = re.findall(
        r"\bafter\s+(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|sec|s)?\b",
        code_no_comments, re.IGNORECASE
    )
    for num_s, unit in all_afters:
        mult = UNIT_TO_FS.get((unit or "ns").lower(), 1_000_000)
        after_fs = int(float(num_s) * mult)
        max_duration_fs = max(max_duration_fs, after_fs)

    # Fallback if no process blocks or if wait for was outside process
    if max_duration_fs == 0 and not has_clock_loop:
        all_waits = re.findall(
            r"\bwait\s+for\s+(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|sec|s)?\b",
            code_no_comments, re.IGNORECASE
        )
        for num_s, unit in all_waits:
            mult = UNIT_TO_FS.get((unit or "ns").lower(), 1_000_000)
            max_duration_fs += int(float(num_s) * mult)

    return max_duration_fs, has_clock_loop


def parse_vcd_to_wavedrom(vcd_path: Path, entity: str, std: str = VHDL_STD,
                          stop_fs: int | None = None, tb_code: str | None = None) -> dict:
    """Convert a GHDL VCD dump into two WaveDrom JSON documents (hex + dec labels).

    Time handling: VCD times are converted to femtoseconds, all signal edges are
    placed on a uniform grid whose step is the GCD of every edge time, so 1-bit
    signals and buses render perfectly time-aligned in WaveDrom.
    """
    from vcdvcd import VCDVCD  # local import: only needed when a VCD exists

    raw = vcd_path.read_text(errors="replace")
    m = TIMESCALE_RE.search(raw)
    mult = float(m.group(1)) * UNIT_TO_FS[(m.group(2) or "fs").lower()] if m else 1.0

    vcd = VCDVCD(str(vcd_path))
    end_fs = int(getattr(vcd, "endtime", 0) or 0)

    # --- select signals: VCD declaration order, de-duplicated by leaf name ---
    selected = []            # (display_name, width, {time_fs: value})
    seen_leaves = set()
    event_times: set[int] = set()
    for name in vcd.signals:
        sig = vcd.data[vcd.references_to_ids[name]]
        segs = name.split(".")
        leaf = segs[-1]
        if leaf in seen_leaves:        # skip DUT copies of top-level signals
            continue
        seen_leaves.add(leaf)
        try:
            width = int(str(getattr(sig, "size", None) or 1))
        except ValueError:
            width = 1
        events: dict[int, str] = {}
        for t, v in sig.tv:
            t_fs = int(round(int(t) * mult))
            events[t_fs] = str(v).strip()
        selected.append((".".join(segs[1:]) if len(segs) > 1 else name, width, events))
        event_times.update(events.keys())

    if not event_times:
        raise ValueError("VCD contains no signal transitions.")

    sim_end_fs = max(event_times) if event_times else 0
    if tb_code:
        tb_fs, has_clock = estimate_testbench_duration_fs(tb_code)
        if has_clock and stop_fs:
            sim_end_fs = max(sim_end_fs, stop_fs)
        elif tb_fs > 0:
            effective_tb_fs = min(tb_fs, stop_fs) if stop_fs else tb_fs
            sim_end_fs = max(sim_end_fs, effective_tb_fs)
    elif stop_fs:
        sim_end_fs = max(sim_end_fs, stop_fs)

    end_fs = max(end_fs, sim_end_fs)

    # --- uniform time grid: step = GCD of all edge times ---
    step = 0
    for t in sorted(event_times):
        if t > 0:
            step = math.gcd(step, t)
    if step == 0:
        step = max(end_fs, 1)

    def build_slotmaps():
        """Map every edge onto the uniform grid; returns per-signal slot maps."""
        maps, max_slot = [], 0
        for _disp, _width, events in selected:
            sv: dict[int, str] = {}
            for t in sorted(events):                # ascending: last edge wins
                s = int(round(t / step))
                max_slot = max(max_slot, s)
                sv[s] = events[t]
            maps.append(sv)
        return maps, max_slot

    maps, max_slot = build_slotmaps()
    # GHDL may dump a final toggle exactly at --stop-time; give it its own slot
    n_slots = max(2, math.ceil(end_fs / step), max_slot + 1)
    while n_slots > MAX_WAVEDROM_SLOTS:      # widen the grid for very long runs
        step *= 2
        maps, max_slot = build_slotmaps()
        n_slots = max(2, math.ceil(end_fs / step), max_slot + 1)

    # --- encode each signal ---
    def encode(value: str, width: int):
        v = value.lower()
        if v.startswith("b"):
            v = v[1:]
        if len(v) == 1:
            if v == "1":
                return "1", None, None
            if v == "0":
                return "0", None, None
            if v == "z":
                return "z", None, None
            return "x", None, None
        if v and all(c in "01" for c in v):
            val = int(v, 2)
            hexw = max(2, (width + 3) // 4)
            return "=", f"0x{val:0{hexw}X}", str(val)
        if "z" in v:
            return "z", None, None
        return "x", None, None

    rows_hex, rows_dec = [], []
    raw_signals = []               # true-time transition list for the JS viewer
    for (disp, width, events), slot_val in zip(selected, maps):
        wave, data_hex, data_dec = [], [], []
        for s in range(n_slots):
            if s in slot_val:
                ch, lab_hex, lab_dec = encode(slot_val[s], width)
                wave.append(ch)
                if lab_hex is not None:
                    data_hex.append(lab_hex)
                    data_dec.append(lab_dec)
            else:
                wave.append(".")
        row = {"name": disp, "wave": "".join(wave)}
        if data_hex:
            row["data"] = data_hex
        rows_hex.append(row)
        rows_dec.append({"name": disp, "wave": "".join(wave), "data": data_dec})
        tv = []
        for t in sorted(events):
            v = events[t]
            if v[:1] in ("b", "B"):
                v = v[1:]
            tv.append([float(Decimal(t) / Decimal(10 ** 6)), v.strip()])
        target_end_ns = float(Decimal(end_fs) / Decimal(10 ** 6))
        if tv and tv[-1][0] < target_end_ns:
            tv.append([target_end_ns, tv[-1][1]])
        raw_signals.append({"name": disp, "width": width, "tv": tv})

    step_ns = Decimal(step) / Decimal(10 ** 6)
    end_ns = Decimal(end_fs) / Decimal(10 ** 6)
    head_text = (f"{entity}   GHDL --std={std}   1 div = {_fmt_ns(step_ns)} ns"
                 f"   total = {_fmt_ns(end_ns)} ns")
    doc_hex = {"signal": rows_hex, "head": {"text": head_text}, "config": {"hscale": 1}}
    doc_dec = {"signal": rows_dec, "head": {"text": head_text}, "config": {"hscale": 1}}
    return {
        "wavedrom": doc_hex,
        "wavedrom_dec": doc_dec,
        "raw": raw_signals,
        "signals": [r["name"] for r in rows_hex],
        "end_time_ns": float(end_ns),
        "div_ns": float(step_ns),
        "n_slots": n_slots,
    }


# ---------------------------------------------------------------------------
# Static routes
# ---------------------------------------------------------------------------
@app.after_request
def add_no_cache_headers(response):
    if request.path in ("/", "/index.html") or request.path.startswith(("/api/", "/health")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.get("/")
@app.get("/index.html")
def index():
    return send_from_directory(str(BASE_DIR), "index.html", max_age=0)


@app.get("/assets/<path:filename>")
def static_assets(filename: str):
    return send_from_directory(str(ASSETS_DIR), filename, max_age=0)


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "app": "Digital Systems Laboratory 2",
        "name": "VHDL Laboratory",
        "version": APP_VERSION,
        "boot_id": SERVER_BOOT_ID,
        "boot_time": SERVER_BOOT_TIME,
        "ghdl_found": ghdl_version() is not None,
        "ghdl_version": ghdl_version(),
        "workspace": str(WORKSPACE_DIR),
    })


@app.get("/api/version")
def api_version():
    return jsonify({
        "app": "VHDL Laboratory",
        "version": APP_VERSION,
        "boot_id": SERVER_BOOT_ID,
        "boot_time": SERVER_BOOT_TIME,
        "ghdl_version": ghdl_version()
    })


@app.post("/api/system/update")
def apply_update_patch():
    """Apply an in-app patch zip uploaded by the student / instructor."""
    if "patch_file" not in request.files:
        return jsonify(ok=False, message="No patch file provided in request."), 400

    file = request.files["patch_file"]
    if not file or not file.filename:
        return jsonify(ok=False, message="Selected patch file is empty."), 400

    if not file.filename.lower().endswith(".zip"):
        return jsonify(ok=False, message="Invalid file format. Update patch must be a .zip archive."), 400

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = BACKUP_UPDATES_DIR / f"backup_{timestamp}"

    try:
        file_bytes = io.BytesIO(file.read())
        if not zipfile.is_zipfile(file_bytes):
            return jsonify(ok=False, message="The uploaded file is not a valid zip archive."), 400

        with zipfile.ZipFile(file_bytes, "r") as zf:
            infolist = zf.infolist()
            if not infolist:
                return jsonify(ok=False, message="Patch archive is empty."), 400

            valid_entries = []
            # Step 1: Pre-validation & Security checks (Zip Slip & Protected Directories)
            for info in infolist:
                raw_name = info.filename.replace("\\", "/")
                # Ignore directories or macOS metadata
                if info.is_dir() or raw_name.startswith("__MACOSX/") or raw_name.endswith(".DS_Store"):
                    continue

                # Zip Slip path traversal check
                resolved_path = (BASE_DIR / raw_name).resolve()
                try:
                    resolved_path.relative_to(BASE_DIR.resolve())
                except ValueError:
                    return jsonify(ok=False, message=f"Security violation: Illegal file path in patch '{raw_name}'."), 400

                # Protect user projects, ghdl binary, workspace, and launcher scripts
                lower_norm = raw_name.lower().replace("\\", "/")
                if lower_norm in PROTECTED_PREFIXES or lower_norm.startswith(PROTECTED_PREFIXES):
                    continue

                # Extension check
                suffix = Path(raw_name).suffix.lower()
                name_lower = Path(raw_name).name.lower()
                if suffix not in ALLOWED_UPDATE_EXTS and name_lower not in ALLOWED_UPDATE_FILENAMES:
                    return jsonify(ok=False, message=f"Rejected file type '{suffix}' in patch ({raw_name})."), 400

                valid_entries.append((info, raw_name, resolved_path))

            if not valid_entries:
                return jsonify(ok=False, message="No valid updatable files found in the patch."), 400

            # Step 2: Backup existing files before overwriting
            BACKUP_UPDATES_DIR.mkdir(parents=True, exist_ok=True)
            backup_dir.mkdir(parents=True, exist_ok=True)

            for info, rel_path, dest_path in valid_entries:
                if dest_path.is_file():
                    backup_dest = backup_dir / rel_path
                    backup_dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(dest_path, backup_dest)

            # Step 3: Extract and overwrite the verified files
            updated_files = []
            for info, rel_path, dest_path in valid_entries:
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                updated_files.append(rel_path)

            # If app.py was updated and server is running live, schedule a seamless restart
            app_py_updated = any(p == "app.py" for p in updated_files)
            if app_py_updated and os.environ.get("VHDL_LIVE_SERVER") == "1":
                current_server_port = str(request.environ.get("SERVER_PORT") or os.environ.get("PORT", "5000"))

                def _delayed_restart():
                    time.sleep(0.8)
                    print("\n[*] Reloading VHDL Laboratory backend to activate updated app.py...")
                    try:
                        # 1. Explicitly close the listening server socket before execv
                        #    so the socket handle is not inherited as an orphan fd by the child process
                        global GLOBAL_SERVER
                        if GLOBAL_SERVER is not None:
                            try:
                                if hasattr(GLOBAL_SERVER, "socket") and GLOBAL_SERVER.socket:
                                    try:
                                        GLOBAL_SERVER.socket.set_inheritable(False)
                                    except Exception:
                                        pass
                                GLOBAL_SERVER.server_close()
                            except Exception as close_err:
                                print(f"[*] server_close note: {close_err}")

                        # 2. Set environment flags and execv the updated app.py
                        os.environ["VHDL_RESTARTED"] = "1"
                        os.environ["PORT"] = current_server_port
                        py_bin = sys.executable
                        target_script = str(BASE_DIR / "app.py")
                        os.chdir(str(BASE_DIR))
                        os.execv(py_bin, [py_bin, target_script])
                    except Exception as err:
                        print(f"[!] Server auto-restart failed: {err}")

                threading.Thread(target=_delayed_restart, daemon=True).start()

            return jsonify(
                ok=True,
                message=f"Update patch applied successfully! ({len(updated_files)} files updated)",
                updated_files=updated_files,
                restart_required=app_py_updated,
                backup_folder=str(backup_dir.relative_to(BASE_DIR)),
                timestamp=timestamp
            )

    except Exception as exc:
        # If extraction failed, attempt rollback from backup
        if backup_dir.exists():
            for b_file in backup_dir.rglob("*"):
                if b_file.is_file():
                    rel = b_file.relative_to(backup_dir)
                    orig = BASE_DIR / rel
                    try:
                        orig.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(b_file, orig)
                    except Exception:
                        pass
        return jsonify(ok=False, message=f"Failed to apply update patch: {exc}"), 500


# ---------------------------------------------------------------------------
# Project manager API (projects/<name>.json)
# ---------------------------------------------------------------------------
def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sanitize_project(payload: dict) -> tuple[dict | None, str | None]:
    """Validate/clean a project payload; returns (project, error)."""
    if not isinstance(payload, dict):
        return None, "Project payload must be a JSON object."
    entity = str(payload.get("entity") or "").strip()
    name = str(payload.get("name") or entity).strip()
    if not IDENT_RE.match(name):
        return None, (f"Invalid project name {name!r}: use a VHDL identifier "
                      "(letter followed by letters/digits/underscores).")
    entity = entity or name
    if not IDENT_RE.match(entity):
        return None, f"Invalid entity name {entity!r}."
    architecture = str(payload.get("architecture") or "Behavioral").strip()
    if not IDENT_RE.match(architecture):
        return None, f"Invalid architecture name {architecture!r}."

    # Project folder (directory where this project's .vhd files are stored)
    raw_folder = str(payload.get("folder") or name).strip()
    safe_folder = re.sub(r"[^a-zA-Z0-9_\-]", "_", raw_folder)
    folder = safe_folder or name

    # VHDL language standard
    standard = _get_std(payload)

    # Author / Engineer name
    author = str(payload.get("author") or "").strip()

    # Creation timestamp
    created = str(payload.get("created") or _utcnow()[:10])

    ports = []
    for p in payload.get("ports") or []:
        if not isinstance(p, dict):
            continue
        pname = str(p.get("name") or "").strip()
        if not IDENT_RE.match(pname):
            return None, f"Invalid port name {pname!r}."
        pdir = str(p.get("dir") or "in").strip().lower()
        if pdir not in PORT_DIRS:
            return None, f"Invalid port direction {pdir!r} for port {pname!r}."
        vector = bool(p.get("vector"))
        msb, lsb = p.get("msb"), p.get("lsb")
        if vector:
            try:
                msb = int(msb) if msb is not None else 7
                lsb = int(lsb) if lsb is not None else 0
            except (TypeError, ValueError):
                return None, f"Port {pname!r}: vector bounds must be integers."
        else:
            msb = lsb = None
        ports.append({"name": pname, "dir": pdir, "vector": vector,
                      "msb": msb, "lsb": lsb})

    files = []
    seen_files = set()
    for f in payload.get("files") or []:
        if not isinstance(f, dict):
            continue
        fname = str(f.get("filename") or "").strip()
        if not fname or not VHDL_FILE_RE.match(fname):
            continue
        if fname.lower() in seen_files:
            continue
        seen_files.add(fname.lower())
        f_entity = str(f.get("entity") or Path(fname).stem).strip()
        f_type = str(f.get("type") or ("simulation" if fname.lower().startswith("tb_") else "design")).lower()
        if f_type not in ("design", "simulation"):
            f_type = "design"
        f_arch = str(f.get("architecture") or ("sim" if f_type == "simulation" else "Behavioral")).strip()
        f_code = str(f.get("code") or f.get("design_code") or f.get("tb_code") or "")
        f_ports = f.get("ports") or []
        files.append({
            "filename": fname,
            "entity": f_entity,
            "type": f_type,
            "architecture": f_arch,
            "code": f_code,
            "ports": f_ports,
        })

    # Backward compatibility: build files list from design_code / tb_code if not provided
    design_code = str(payload.get("design_code") or "")
    tb_code = str(payload.get("tb_code") or "") or None
    if not files and design_code:
        files.append({
            "filename": f"{entity}.vhd".lower(),
            "entity": entity,
            "type": "design",
            "architecture": architecture,
            "code": design_code,
            "ports": ports,
        })
        if tb_code:
            files.append({
                "filename": f"tb_{entity}.vhd".lower(),
                "entity": f"tb_{entity}",
                "type": "simulation",
                "architecture": "sim",
                "code": tb_code,
                "ports": [],
            })

    top_entity = str(payload.get("top_entity") or entity).strip()
    active_tb = str(payload.get("active_tb") or "").strip()
    if not active_tb:
        for f in files:
            if f["type"] == "simulation":
                active_tb = f["filename"]
                break

    # Keep top-level design_code and tb_code in sync with top design file and active tb
    top_file = next((f for f in files if f["type"] == "design" and (f["entity"].lower() == top_entity.lower() or f["filename"] == f"{top_entity}.vhd".lower())), None)
    if not top_file and files:
        top_file = next((f for f in files if f["type"] == "design"), files[0])
    if top_file:
        design_code = top_file["code"]
        entity = top_file["entity"]
        architecture = top_file["architecture"]

    active_tb_file = next((f for f in files if f["type"] == "simulation" and (f["filename"] == active_tb or f["entity"] == active_tb)), None)
    if active_tb_file:
        tb_code = active_tb_file["code"]

    dependencies = []
    for d in payload.get("dependencies") or []:
        if isinstance(d, str):
            d_name = d.strip()
            if IDENT_RE.match(d_name) and d_name not in dependencies and d_name != entity:
                dependencies.append(d_name)

    return {
        "name": name,
        "folder": folder,
        "standard": standard,
        "author": author,
        "created": created,
        "updated": _utcnow(),
        "entity": entity,
        "top_entity": top_entity or entity,
        "active_tb": active_tb,
        "architecture": architecture,
        "ports": ports,
        "files": files,
        "dependencies": dependencies,
        "design_code": design_code,
        "tb_code": tb_code,
        "design_ok": bool(payload.get("design_ok")),
        "tb_ok": bool(payload.get("tb_ok")),
    }, None


def _project_dir(folder_or_name: str) -> Path | None:
    if not folder_or_name or not str(folder_or_name).strip():
        return None
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(folder_or_name).strip())
    if not safe:
        return None
    p = (PROJECTS_DIR / safe).resolve()
    try:
        p.relative_to(PROJECTS_DIR.resolve())
    except ValueError:
        return None
    return p


def _project_path(name_or_folder: str) -> Path | None:
    if not name_or_folder or not str(name_or_folder).strip():
        return None
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(name_or_folder).strip())
    if not safe:
        return None
    # 1. Folder project: projects/<safe>/project.json
    pdir = PROJECTS_DIR / safe
    if pdir.is_dir() and (pdir / "project.json").is_file():
        return pdir / "project.json"
    # 2. Legacy standalone json: projects/<safe>.json
    pfile = PROJECTS_DIR / f"{safe}.json"
    if pfile.is_file():
        return pfile
    # 3. Default path for creating or targeting folder project
    return pdir / "project.json"


def _parse_entity_ports_vhdl(code: str) -> list[dict]:
    """Parse VHDL port definitions from source code as fallback."""
    if not code:
        return []
    m = re.search(r"\bentity\s+[A-Za-z][A-Za-z0-9_]*\s+is[\s\S]*?\bport\s*\(([\s\S]*?)\)\s*;", code, re.IGNORECASE)
    if not m:
        return []
    cleaned = re.sub(r"--[^\n]*", " ", m.group(1))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    ports = []
    for chunk in cleaned.split(";"):
        pm = re.match(r"^\s*([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*)\s*:\s*(in|out|inout|buffer)\s+(.+)$", chunk.strip(), re.IGNORECASE)
        if not pm:
            continue
        names = [s.strip() for s in pm.group(1).split(",")]
        pdir = pm.group(2).lower()
        ptype = pm.group(3).strip()
        vector = "std_logic_vector" in ptype.lower()
        msb, lsb = 7, 0
        rm = re.search(r"\(\s*(\d+)\s+(?:downto|to)\s+(\d+)\s*\)", ptype, re.IGNORECASE)
        if rm:
            try:
                msb, lsb = int(rm.group(1)), int(rm.group(2))
            except ValueError:
                pass
        for name in names:
            if name:
                ports.append({"name": name, "dir": pdir, "vector": vector, "msb": msb, "lsb": lsb})
    return ports


def _generate_component_snippets(entity: str, ports: list[dict]) -> dict:
    """Generate VHDL component declaration and port map instantiation snippets."""
    port_lines = []
    map_lines = []
    for p in ports:
        pname = p.get("name", "")
        pdir = p.get("dir", "in")
        vector = bool(p.get("vector"))
        msb = p.get("msb")
        lsb = p.get("lsb")
        if vector:
            m = 7 if msb is None else msb
            l = 0 if lsb is None else lsb
            ptype = f"std_logic_vector({m} downto {l})"
        else:
            ptype = "std_logic"
        port_lines.append(f"    {pname:<16} : {pdir:<6} {ptype}")
        map_lines.append(f"    {pname:<16} => {pname}")

    ports_block = ";\n".join(port_lines) if port_lines else "    -- no ports declared"
    map_block = ",\n".join(map_lines) if map_lines else "    -- no ports to map"

    declaration = (
        f"  -- Component declaration for {entity}\n"
        f"  component {entity} is\n"
        f"    port (\n"
        f"{ports_block}\n"
        f"    );\n"
        f"  end component {entity};"
    )

    instantiation = (
        f"  -- Component instantiation for {entity}\n"
        f"  U_{entity} : {entity}\n"
        f"    port map (\n"
        f"{map_block}\n"
        f"    );"
    )

    return {
        "declaration": declaration,
        "instantiation": instantiation,
    }


def _prepare_dependencies(deps: list, std: str = VHDL_STD) -> tuple[bool, list[dict], list[dict], list[dict], list[dict]]:
    """Compile prerequisite VHDL components into the current workspace library.

    deps can be a list of project/entity names (e.g. ["inverter", "or22"]) or dicts
    with {"name": ..., "entity": ..., "code": ...}.
    Returns (ok, errors, warnings, infos, log_entries).
    """
    log_entries = []
    all_errors = []
    all_warnings = []
    all_infos = []

    if not deps:
        return True, all_errors, all_warnings, all_infos, log_entries

    seen_components = set()
    seen_files = set()

    for item in deps:
        dep_name = ""
        dep_files: list[tuple[str, str]] = []

        if isinstance(item, str):
            dep_name = item.strip()
            if not dep_name or not IDENT_RE.match(dep_name) or dep_name in seen_components:
                continue
            seen_components.add(dep_name)

            path = _project_path(dep_name)
            if path and path.exists():
                try:
                    pdata = json.loads(path.read_text(encoding="utf-8"))
                    pdir = path.parent if path.name == "project.json" else None

                    # 1. Inspect 'files' list in project metadata
                    if pdata.get("files"):
                        # Target matching entity or filename first
                        target_files = [
                            f for f in pdata["files"]
                            if (f.get("entity", "").lower() == dep_name.lower() or
                                Path(f.get("filename", "")).stem.lower() == dep_name.lower())
                            and (f.get("type") or "design") == "design"
                        ]
                        if not target_files:
                            target_files = [
                                f for f in pdata["files"]
                                if (f.get("type") or ("simulation" if (f.get("filename") or "").lower().startswith("tb_") else "design")) == "design"
                            ]
                        for f in target_files:
                            fn = f.get("filename") or f"{f.get('entity') or dep_name}.vhd"
                            code = f.get("code") or ""
                            if not code and pdir and (pdir / fn).is_file():
                                try:
                                    code = (pdir / fn).read_text(encoding="utf-8")
                                except OSError:
                                    pass
                            if code:
                                dep_files.append((fn, code))

                    # 2. Inspect on-disk .vhd files in directory if not resolved
                    if not dep_files and pdir and pdir.is_dir():
                        exact_file = pdir / f"{dep_name}.vhd"
                        if exact_file.is_file():
                            try:
                                dep_files.append((exact_file.name, exact_file.read_text(encoding="utf-8")))
                            except OSError:
                                pass
                        else:
                            for vhd in sorted(pdir.glob("*.vhd")):
                                if vhd.name.lower().startswith("tb_"):
                                    continue
                                try:
                                    vcode = vhd.read_text(encoding="utf-8")
                                    if vcode:
                                        dep_files.append((vhd.name, vcode))
                                except OSError:
                                    pass

                    # 3. Fallback to top-level design_code attribute
                    if not dep_files:
                        code = pdata.get("design_code", "")
                        if code:
                            dep_files.append((f"{dep_name}.vhd", code))
                except Exception:
                    pass

        elif isinstance(item, dict):
            dep_name = str(item.get("entity") or item.get("name") or "").strip()
            if not dep_name or not IDENT_RE.match(dep_name) or dep_name in seen_components:
                continue
            seen_components.add(dep_name)
            code = str(item.get("code") or item.get("design_code") or "")
            fn = str(item.get("filename") or f"{dep_name}.vhd")
            if code:
                dep_files.append((fn, code))

        if not dep_name or not IDENT_RE.match(dep_name):
            continue

        if not dep_files:
            log_entries.append(log_entry("warning", f"Component '{dep_name}' has no design code, skipping."))
            continue

        for filename, dep_code in dep_files:
            if filename in seen_files:
                continue
            seen_files.add(filename)
            write_source(filename, dep_code)
            log_entries.append(log_entry("cmd", f"$ ghdl -a --std={std} workspace/{filename}  [Component: {dep_name}]"))
            rc, out, err = run_ghdl(["-a", f"--std={std}", filename])
            errs, warns, infs = parse_ghdl_output(out)
            all_warnings.extend(warns)
            all_infos.extend(infs)

            if err:
                log_entries.append(log_entry("error", f"Component {dep_name} ({filename}): {err}"))
                all_errors.append({"file": filename, "line": 1, "col": 1, "message": err, "kind": "error"})
                return False, all_errors, all_warnings, all_infos, log_entries
            if rc != 0 or errs:
                for e in errs:
                    log_entries.append(log_entry("error", _format_msg(e)))
                all_errors.extend(errs)
                log_entries.append(log_entry("error", f"Analysis of component '{dep_name}' ({filename}) failed."))
                return False, all_errors, all_warnings, all_infos, log_entries

        log_entries.append(log_entry("success", f"Component '{dep_name}' analyzed successfully."))

    return True, all_errors, all_warnings, all_infos, log_entries


@app.get("/api/components")
def get_components():
    """Return all available reusable components grouped by project."""
    components = []
    seen = set()

    def add_comp(proj_name: str, proj_folder: str, author: str, standard: str, updated: str,
                 entity: str, filename: str, arch: str, code: str, ports: list):
        if not entity:
            return
        key = (proj_name.lower(), entity.lower())
        if key in seen:
            return
        seen.add(key)
        final_ports = ports if ports else _parse_entity_ports_vhdl(code)
        snippets = _generate_component_snippets(entity, final_ports)
        components.append({
            "project_name": proj_name,
            "project_folder": proj_folder,
            "name": entity,
            "entity": entity,
            "filename": filename or f"{entity}.vhd".lower(),
            "architecture": arch or "Behavioral",
            "standard": standard or "08",
            "author": author or "",
            "ports": final_ports,
            "has_code": bool(code.strip()),
            "design_code": code,
            "snippets": snippets,
            "updated": updated,
        })

    # 1. Directory-based projects
    if PROJECTS_DIR.exists():
        for pdir in sorted(PROJECTS_DIR.iterdir()):
            if pdir.is_dir() and (pdir / "project.json").is_file():
                try:
                    pdata = json.loads((pdir / "project.json").read_text(encoding="utf-8"))
                except Exception:
                    continue
                proj_name = pdata.get("name") or pdir.name
                proj_folder = pdir.name
                author = pdata.get("author") or ""
                standard = pdata.get("standard") or "08"
                updated = pdata.get("updated") or pdata.get("created") or ""
                files = pdata.get("files") or []

                # Add all design files from the project
                found_design = False
                for f in files:
                    ftype = f.get("type") or ("simulation" if (f.get("filename") or "").lower().startswith("tb_") else "design")
                    if ftype == "design":
                        found_design = True
                        ent = f.get("entity") or Path(f.get("filename") or "design.vhd").stem
                        fn = f.get("filename") or f"{ent}.vhd".lower()
                        # If code not in json, try reading on-disk .vhd file
                        code = f.get("code") or ""
                        if not code and (pdir / fn).is_file():
                            try:
                                code = (pdir / fn).read_text(encoding="utf-8")
                            except OSError:
                                pass
                        add_comp(proj_name, proj_folder, author, standard, updated,
                                 ent, fn, f.get("architecture") or "Behavioral", code, f.get("ports") or [])

                # Also inspect any on-disk .vhd files not in files array
                for vhd in sorted(pdir.glob("*.vhd")):
                    if vhd.name.lower().startswith("tb_"):
                        continue
                    ent = vhd.stem
                    if not any(f.get("filename", "").lower() == vhd.name.lower() for f in files):
                        try:
                            vcode = vhd.read_text(encoding="utf-8")
                        except OSError:
                            vcode = ""
                        add_comp(proj_name, proj_folder, author, standard, updated,
                                 ent, vhd.name, "Behavioral", vcode, [])

                # Fallback to top-level entity if no files were found
                if not found_design and pdata.get("entity"):
                    add_comp(proj_name, proj_folder, author, standard, updated,
                             pdata.get("entity"), f"{pdata.get('entity')}.vhd".lower(),
                             pdata.get("architecture") or "Behavioral", pdata.get("design_code") or "", pdata.get("ports") or [])

    # 2. Legacy standalone JSON files
    if PROJECTS_DIR.exists():
        for path in sorted(PROJECTS_DIR.glob("*.json")):
            if path.name == "project.json":
                continue
            try:
                pdata = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            proj_name = pdata.get("name") or path.stem
            proj_folder = pdata.get("folder") or proj_name
            author = pdata.get("author") or ""
            standard = pdata.get("standard") or "08"
            updated = pdata.get("updated") or pdata.get("created") or ""
            files = pdata.get("files") or []

            found_design = False
            for f in files:
                ftype = f.get("type") or ("simulation" if (f.get("filename") or "").lower().startswith("tb_") else "design")
                if ftype == "design":
                    found_design = True
                    ent = f.get("entity") or Path(f.get("filename") or "design.vhd").stem
                    fn = f.get("filename") or f"{ent}.vhd".lower()
                    add_comp(proj_name, proj_folder, author, standard, updated,
                             ent, fn, f.get("architecture") or "Behavioral", f.get("code") or "", f.get("ports") or [])

            if not found_design and pdata.get("entity"):
                add_comp(proj_name, proj_folder, author, standard, updated,
                         pdata.get("entity"), f"{pdata.get('entity')}.vhd".lower(),
                         pdata.get("architecture") or "Behavioral", pdata.get("design_code") or "", pdata.get("ports") or [])

    return jsonify(ok=True, components=components)


@app.post("/api/components/generate_snippet")
def generate_component_snippet():
    """Generate VHDL component declaration and port map snippets on demand."""
    data = request.get_json(silent=True) or {}
    entity = str(data.get("entity") or data.get("name") or "my_component").strip()
    ports = data.get("ports") or []
    snippets = _generate_component_snippets(entity, ports)
    return jsonify(ok=True, entity=entity, **snippets)


@app.get("/api/projects")
@app.get("/api/projects/list")
def projects_list():
    items = []
    seen = set()

    # 1. Scan directory-based projects
    if PROJECTS_DIR.exists():
        for pdir in sorted(PROJECTS_DIR.iterdir()):
            if pdir.is_dir() and (pdir / "project.json").is_file():
                try:
                    data = json.loads((pdir / "project.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                name = data.get("name") or pdir.name
                seen.add(name.lower())
                seen.add(pdir.name.lower())
                files = data.get("files") or []
                vhd_count = len(list(pdir.glob("*.vhd")))
                items.append({
                    "name": name,
                    "folder": pdir.name,
                    "folder_path": str(pdir),
                    "entity": data.get("entity"),
                    "top_entity": data.get("top_entity") or data.get("entity"),
                    "active_tb": data.get("active_tb"),
                    "architecture": data.get("architecture"),
                    "standard": data.get("standard", "08"),
                    "author": data.get("author", ""),
                    "created": data.get("created"),
                    "ports": data.get("ports") or [],
                    "files": files,
                    "file_count": max(len(files), vhd_count),
                    "dependencies": data.get("dependencies") or [],
                    "has_tb": bool(data.get("tb_code") or any(f.get("type") == "simulation" for f in files) or any(v.name.lower().startswith("tb_") for v in pdir.glob("*.vhd"))),
                    "design_ok": bool(data.get("design_ok")),
                    "tb_ok": bool(data.get("tb_ok")),
                    "updated": data.get("updated") or data.get("created"),
                })

    # 2. Scan legacy standalone .json files
    if PROJECTS_DIR.exists():
        for path in sorted(PROJECTS_DIR.glob("*.json")):
            if path.name == "project.json" or path.stem.lower() in seen:
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            name = data.get("name") or path.stem
            seen.add(name.lower())
            files = data.get("files") or []
            folder_name = data.get("folder") or name
            items.append({
                "name": name,
                "folder": folder_name,
                "folder_path": str(PROJECTS_DIR / folder_name),
                "entity": data.get("entity"),
                "top_entity": data.get("top_entity") or data.get("entity"),
                "active_tb": data.get("active_tb"),
                "architecture": data.get("architecture"),
                "standard": data.get("standard", "08"),
                "author": data.get("author", ""),
                "created": data.get("created"),
                "ports": data.get("ports") or [],
                "files": files,
                "file_count": len(files),
                "dependencies": data.get("dependencies") or [],
                "has_tb": bool(data.get("tb_code") or any(f.get("type") == "simulation" for f in files)),
                "design_ok": bool(data.get("design_ok")),
                "tb_ok": bool(data.get("tb_ok")),
                "updated": data.get("updated") or data.get("created"),
            })

    items.sort(key=lambda x: x.get("updated") or "", reverse=True)
    return jsonify(ok=True, projects=items)


@app.post("/api/projects/save")
def projects_save():
    data = request.get_json(silent=True) or {}
    project, error = _sanitize_project(data.get("project") or data)
    if error:
        return jsonify(ok=False, message=error), 400

    folder = project.get("folder") or project["name"]
    pdir = _project_dir(folder)
    if not pdir:
        return jsonify(ok=False, message="Invalid project folder name."), 400

    pdir.mkdir(parents=True, exist_ok=True)

    # 1. Save every source file as an individual .vhd file directly in the project folder
    for f in project.get("files", []):
        fname = f.get("filename")
        if fname and VHDL_FILE_RE.match(fname):
            code = str(f.get("code") or "")
            (pdir / fname).write_text(code, encoding="utf-8")

    # 2. Save project metadata into project.json inside the folder
    meta_path = pdir / "project.json"
    meta_path.write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")

    # Clean up legacy standalone JSON file if one exists from older versions
    legacy_file = PROJECTS_DIR / f"{project['name']}.json"
    if legacy_file.is_file():
        try:
            legacy_file.unlink()
        except OSError:
            pass

    return jsonify(
        ok=True,
        saved=project["name"],
        folder=pdir.name,
        folder_path=str(pdir),
        standard=project.get("standard", "08"),
        updated=project["updated"]
    )


@app.post("/api/projects/load")
def projects_load():
    data = request.get_json(silent=True) or request.args
    target = str((data.get("name") or data.get("folder") or "").strip())
    path = _project_path(target)
    if path is None:
        return jsonify(ok=False, message="Invalid project name or folder."), 400
    if not path.exists():
        return jsonify(ok=False, message=f"Project {target!r} not found."), 404
    try:
        project = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return jsonify(ok=False, message=f"Project file unreadable: {exc}"), 500

    # If it's a directory project, refresh files from the actual on-disk .vhd files
    pdir = path.parent if path.name == "project.json" else None
    if pdir and pdir.is_dir():
        project["folder"] = pdir.name
        existing_filenames = set()
        for f in project.get("files", []):
            fname = f.get("filename")
            if fname:
                existing_filenames.add(fname.lower())
                fpath = pdir / fname
                if fpath.is_file():
                    try:
                        f["code"] = fpath.read_text(encoding="utf-8")
                    except Exception:
                        pass
        # Discover any newly added .vhd files placed in the folder
        for vhd in sorted(pdir.glob("*.vhd")):
            if vhd.name.lower() not in existing_filenames and VHDL_FILE_RE.match(vhd.name):
                try:
                    code = vhd.read_text(encoding="utf-8")
                    is_tb = vhd.name.lower().startswith("tb_") or "tb_" in vhd.name.lower()
                    m = ENTITY_RE.search(code)
                    ent = m.group(1) if m else vhd.stem
                    project.setdefault("files", []).append({
                        "filename": vhd.name,
                        "entity": ent,
                        "type": "simulation" if is_tb else "design",
                        "architecture": "sim" if is_tb else "Behavioral",
                        "code": code,
                        "ports": [],
                    })
                except Exception:
                    pass

    return jsonify(ok=True, project=project)


@app.post("/api/projects/delete")
def projects_delete():
    data = request.get_json(silent=True) or request.args
    target = str((data.get("name") or data.get("folder") or "").strip())
    path = _project_path(target)
    if path is None:
        return jsonify(ok=False, message="Invalid project name or folder."), 400
    if not path.exists():
        return jsonify(ok=False, message=f"Project {target!r} not found."), 404

    # Delete directory if folder project
    if path.name == "project.json":
        pdir = path.parent
        shutil.rmtree(pdir, ignore_errors=True)
        (PROJECTS_DIR / f"{pdir.name}.json").unlink(missing_ok=True)
    else:
        path.unlink(missing_ok=True)

    # Also clean legacy single file
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", target)
    legacy = PROJECTS_DIR / f"{safe}.json"
    if legacy.is_file():
        legacy.unlink(missing_ok=True)

    return jsonify(ok=True, deleted=target)


@app.post("/api/projects/export_zip")
def projects_export_zip():
    import io
    import zipfile
    from flask import send_file

    data = request.get_json(silent=True) or request.args
    name = str((data.get("name") or data.get("entity") or "").strip())
    path = _project_path(name)
    project = None
    if path and path.exists():
        try:
            project = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if project is None and isinstance(data.get("project"), dict):
        project = data["project"]
    if not project:
        return jsonify(ok=False, message="Project not found or invalid."), 400

    entity = project.get("entity") or project.get("name") or "design"
    arch = project.get("architecture") or "Behavioral"
    files = project.get("files") or []

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as zf:
        if files:
            for f in files:
                fn = f.get("filename") or f"{f.get('entity')}.vhd"
                zf.writestr(fn, f.get("code") or "")
        else:
            design_code = project.get("design_code") or ""
            tb_code = project.get("tb_code") or ""
            zf.writestr(f"{entity}.vhd", design_code)
            if tb_code.strip():
                zf.writestr(f"tb_{entity}.vhd", tb_code)

        zf.writestr(f"{project.get('name', entity)}.json", json.dumps(project, indent=2, ensure_ascii=False))

        # Add compilation script
        std = _get_std(project)
        design_list = [f.get("filename") for f in files if f.get("type") == "design"] or [f"{entity}.vhd"]
        tb_list = [f.get("filename") for f in files if f.get("type") == "simulation"] or ([f"tb_{entity}.vhd"] if project.get("tb_code") else [])
        active_tb_fn = tb_list[0] if tb_list else ""
        active_tb_ent = Path(active_tb_fn).stem if active_tb_fn else f"tb_{entity}"

        compile_bat = (
            "@echo off\r\n"
            f"echo Compiling {project.get('name', entity)} with GHDL (standard {std})...\r\n"
            f"ghdl -a --std={std} " + " ".join(design_list) + "\r\n"
            + (f"ghdl -a --std={std} {active_tb_fn}\r\n"
               f"ghdl -e --std={std} {active_tb_ent}\r\n"
               f"ghdl -r --std={std} {active_tb_ent} --vcd=wave.vcd --stop-time=1us\r\n"
               "echo Simulation complete: wave.vcd generated.\r\n"
               if active_tb_fn else "")
            + "pause\r\n"
        )
        zf.writestr("run_simulation.bat", compile_bat)

        readme_txt = (
            f"Digital Systems Laboratory 2 - VHDL Project\n"
            f"===========================================\n"
            f"Project      : {project.get('name', entity)}\n"
            f"Folder       : {project.get('folder', entity)}\n"
            f"Author       : {project.get('author') or '(Unspecified)'}\n"
            f"Language     : VHDL-{std.upper()}\n"
            f"Created      : {project.get('created', '')}\n"
            f"Files        : {len(files) if files else 1} source file(s)\n\n"
            f"How to compile & simulate with GHDL:\n"
            f"  Double click run_simulation.bat\n"
        )
        zf.writestr("README.txt", readme_txt)
    mem.seek(0)
    return send_file(
        mem,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{project.get('name', entity)}.zip",
    )


def _find_rar_exe() -> str | None:
    candidates = [
        r"C:\Program Files\WinRAR\Rar.exe",
        r"C:\Program Files (x86)\WinRAR\Rar.exe",
        shutil.which("rar") or "",
        shutil.which("Rar") or "",
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return str(c)
    return None


@app.post("/api/projects/export_rar")
def projects_export_rar():
    import tempfile
    import io
    from flask import send_file

    data = request.get_json(silent=True) or request.args
    name = str((data.get("name") or data.get("entity") or "").strip())
    path = _project_path(name)
    project = None
    if path and path.exists():
        try:
            project = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if project is None and isinstance(data.get("project"), dict):
        project = data["project"]
    if not project:
        return jsonify(ok=False, message="Project not found or invalid."), 400

    target_path_str = str(data.get("target_path") or "").strip()
    entity = project.get("entity") or project.get("name") or "design"
    proj_name = project.get("name") or entity
    files = project.get("files") or []
    std = _get_std(project)

    rar_exe = _find_rar_exe()
    if not rar_exe:
        return jsonify(ok=False, message="WinRAR (Rar.exe) was not found on this system. Please verify WinRAR is installed."), 500

    with tempfile.TemporaryDirectory() as tmp_dir:
        staging = Path(tmp_dir) / "staging"
        staging.mkdir(parents=True, exist_ok=True)

        # 1. Write all .vhd source files
        if files:
            for f in files:
                fn = f.get("filename") or f"{f.get('entity')}.vhd"
                (staging / fn).write_text(f.get("code") or "", encoding="utf-8")
        else:
            (staging / f"{entity}.vhd").write_text(project.get("design_code") or "", encoding="utf-8")
            if project.get("tb_code"):
                (staging / f"tb_{entity}.vhd").write_text(project.get("tb_code") or "", encoding="utf-8")

        # 2. Write project.json
        (staging / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")

        # 3. Write run_simulation.bat
        design_list = [f.get("filename") for f in files if f.get("type") == "design"] or [f"{entity}.vhd"]
        tb_list = [f.get("filename") for f in files if f.get("type") == "simulation"] or ([f"tb_{entity}.vhd"] if project.get("tb_code") else [])
        active_tb_fn = tb_list[0] if tb_list else ""
        active_tb_ent = Path(active_tb_fn).stem if active_tb_fn else f"tb_{entity}"

        compile_bat = (
            "@echo off\r\n"
            f"echo Compiling {proj_name} with GHDL (standard {std})...\r\n"
            f"ghdl -a --std={std} " + " ".join(design_list) + "\r\n"
            + (f"ghdl -a --std={std} {active_tb_fn}\r\n"
               f"ghdl -e --std={std} {active_tb_ent}\r\n"
               f"ghdl -r --std={std} {active_tb_ent} --vcd=wave.vcd --stop-time=1us\r\n"
               "echo Simulation complete: wave.vcd generated.\r\n"
               if active_tb_fn else "")
            + "pause\r\n"
        )
        (staging / "run_simulation.bat").write_text(compile_bat, encoding="utf-8")

        # 4. Write README.txt
        readme_txt = (
            f"Digital Systems Laboratory 2 - VHDL Project Archive (RAR)\n"
            f"==========================================================\n"
            f"Project      : {proj_name}\n"
            f"Folder       : {project.get('folder', entity)}\n"
            f"Author       : {project.get('author') or '(Unspecified)'}\n"
            f"Language     : VHDL-{std.upper()}\n"
            f"Created      : {project.get('created', '')}\n"
            f"Files        : {len(files) if files else 1} source file(s)\n\n"
            f"How to compile & simulate with GHDL:\n"
            f"  Double click run_simulation.bat\n"
        )
        (staging / "README.txt").write_text(readme_txt, encoding="utf-8")

        # If a custom destination path is specified by user:
        if target_path_str:
            dest_file = Path(target_path_str)
            if dest_file.is_dir() or target_path_str.endswith(("\\", "/")):
                dest_file = dest_file / f"{proj_name}.rar"
            elif not dest_file.suffix.lower() == ".rar":
                dest_file = dest_file.with_suffix(".rar")
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            if dest_file.exists():
                try:
                    dest_file.unlink()
                except OSError:
                    pass

            cmd = [rar_exe, "a", "-ep1", "-y", str(dest_file), str(staging / "*")]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if proc.returncode != 0:
                return jsonify(ok=False, message=f"WinRAR failed: {proc.stderr or proc.stdout}"), 500

            return jsonify(
                ok=True,
                message=f"Project successfully saved as RAR to: {dest_file}",
                path=str(dest_file),
                size=dest_file.stat().st_size,
                filename=dest_file.name
            )
        else:
            # Generate RAR in temp and stream for browser download
            rar_out = Path(tmp_dir) / f"{proj_name}.rar"
            cmd = [rar_exe, "a", "-ep1", "-y", str(rar_out), str(staging / "*")]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if proc.returncode != 0:
                return jsonify(ok=False, message=f"WinRAR failed: {proc.stderr or proc.stdout}"), 500

            rar_bytes = rar_out.read_bytes()
            mem = io.BytesIO(rar_bytes)
            return send_file(
                mem,
                mimetype="application/x-rar-compressed",
                as_attachment=True,
                download_name=f"{proj_name}.rar"
            )


# ---------------------------------------------------------------------------
# Global JSON Error Handlers (Guarantees API never returns HTML error pages)
# ---------------------------------------------------------------------------
@app.errorhandler(500)
@app.errorhandler(Exception)
def handle_unexpected_error(err):
    import traceback
    traceback.print_exc()
    msg = str(err) or "Internal Server Error"
    return jsonify(
        ok=False,
        message=f"Server error: {msg}",
        errors=[{"file": None, "line": None, "col": None, "message": msg, "kind": "error"}],
        warnings=[],
        infos=[],
        log=[log_entry("error", f"Internal Server Error: {msg}")],
        ghdl_version=ghdl_version(),
    ), 500


@app.errorhandler(404)
def handle_not_found(err):
    return jsonify(ok=False, message="Resource not found"), 404


# ---------------------------------------------------------------------------
# ISE process 1: Check Syntax (design only, or design + testbench)
# ---------------------------------------------------------------------------
def _validated_filename(raw, default: str | None = None) -> str | None:
    name = str(raw).strip() if raw else ""
    if not name and default:
        name = str(default).strip()
    if not name:
        return None
    return name if VHDL_FILE_RE.match(name) else None


@app.post("/check_syntax")
@synchronized_workspace
def check_syntax():
    data = request.get_json(silent=True) or {}
    std = _get_std(data)
    target = str(data.get("target") or "design").strip().lower()
    if target not in ("design", "tb"):
        return jsonify(ok=False, message="'target' must be 'design' or 'tb'.",
                       errors=[], warnings=[], log=[]), 400

    files = data.get("files")
    if isinstance(files, list) and files:
        reset_workspace()
        log = []
        design_files = []
        tb_files = []
        for f in files:
            fname = _validated_filename(f.get("filename"), None)
            if not fname:
                continue
            code = str(f.get("code") or "")
            write_source(fname, code)
            ftype = str(f.get("type") or ("simulation" if fname.lower().startswith("tb_") else "design")).lower()
            if ftype == "simulation":
                tb_files.append(fname)
            else:
                design_files.append(fname)

        dependencies = data.get("dependencies") or []
        dep_ok, dep_errs, dep_warns, dep_infs, dep_log = _prepare_dependencies(dependencies, std=std)
        log.extend(dep_log)
        if not dep_ok:
            return jsonify(ok=False, message="Component dependency analysis failed.", target=target,
                           stage="dependency", errors=dep_errs, warnings=dep_warns,
                           infos=dep_infs, log=log, ghdl_version=ghdl_version())

        all_errors, all_warnings, all_infos = list(dep_errs), list(dep_warns), list(dep_infs)
        if design_files:
            log.append(log_entry("cmd", f"$ ghdl -a --std={std} " + " ".join(f"workspace/{fn}" for fn in design_files)))
            rc, out, err = run_ghdl(["-a", f"--std={std}"] + design_files)
            errors, warnings, infos = parse_ghdl_output(out)
            all_errors.extend(errors)
            all_warnings.extend(warnings)
            all_infos.extend(infos)
            if err:
                log.append(log_entry("error", err))
                return jsonify(ok=False, message=err, errors=all_errors, warnings=all_warnings, infos=all_infos,
                               log=log, ghdl_version=ghdl_version())
            if rc != 0 or errors:
                for e in errors:
                    log.append(log_entry("error", _format_msg(e)))
                for w in warnings:
                    log.append(log_entry("warning", _format_msg(w)))
                log.append(log_entry("error", f"Check Syntax failed on design modules: {len(errors)} error(s)."))
                return jsonify(ok=False, message=None, target="design", stage="design",
                               errors=all_errors, warnings=all_warnings, infos=all_infos,
                               log=log, ghdl_version=ghdl_version())

        target_tb = _validated_filename(data.get("active_tb") or data.get("tb_filename"), None)
        active_tbs = [target_tb] if target_tb and target_tb in tb_files else (tb_files if target == "tb" else [])
        if target == "tb" or active_tbs:
            for tb_fn in active_tbs:
                log.append(log_entry("cmd", f"$ ghdl -a --std={std} workspace/{tb_fn}"))
                rc, out, err = run_ghdl(["-a", f"--std={std}", tb_fn])
                errors, warnings, infos = parse_ghdl_output(out)
                all_errors.extend(errors)
                all_warnings.extend(warnings)
                all_infos.extend(infos)
                if err:
                    log.append(log_entry("error", err))
                    return jsonify(ok=False, message=err, target="tb", stage="tb",
                                   errors=all_errors, warnings=all_warnings, infos=all_infos,
                                   log=log, ghdl_version=ghdl_version())
                if rc != 0 or errors:
                    for e in errors:
                        log.append(log_entry("error", _format_msg(e)))
                    log.append(log_entry("error", f"Check Syntax failed on testbench '{tb_fn}': {len(errors)} error(s)."))
                    return jsonify(ok=False, message=None, target="tb", stage="tb",
                                   errors=all_errors, warnings=all_warnings, infos=all_infos,
                                   log=log, ghdl_version=ghdl_version())

        for w in all_warnings:
            log.append(log_entry("warning", _format_msg(w)))
        for i in all_infos:
            log.append(log_entry("info", _format_msg(i)))
        total_compiled = len(design_files) + len(active_tbs)
        log.append(log_entry("success", f"Check Syntax passed: {total_compiled} file(s) analyzed successfully."))
        return jsonify(ok=True, message=None, target=target, stage="design",
                       errors=[], warnings=all_warnings, infos=all_infos,
                       log=log, ghdl_version=ghdl_version())

    design_code = data.get("design_code")
    if not design_code or not str(design_code).strip():
        return jsonify(ok=False, message="Missing 'design_code' in request body.",
                       errors=[], warnings=[], log=[]), 400
    design_name = _validated_filename(data.get("design_filename"), "design.vhd")
    tb_name = _validated_filename(data.get("tb_filename"), "tb_design.vhd")
    if design_name is None or tb_name is None:
        return jsonify(ok=False,
                       message="Invalid source filename (expected <name>.vhd).",
                       errors=[], warnings=[], log=[]), 400

    dependencies = data.get("dependencies") or []
    reset_workspace()

    dep_ok, dep_errs, dep_warns, dep_infs, dep_log = _prepare_dependencies(dependencies, std=std)
    log = list(dep_log)
    if not dep_ok:
        return jsonify(ok=False, message="Component dependency analysis failed.", target=target,
                       stage="dependency", errors=dep_errs, warnings=dep_warns,
                       infos=dep_infs, log=log, ghdl_version=ghdl_version())

    write_source(design_name, str(design_code))

    log.append(log_entry("cmd", f"$ ghdl -a --std={std} workspace/{design_name}"))
    rc, out, err = run_ghdl(["-a", f"--std={std}", design_name])
    errors, warnings, infos = parse_ghdl_output(out)
    errors = dep_errs + errors
    warnings = dep_warns + warnings
    infos = dep_infs + infos

    if err:
        log.append(log_entry("error", err))
        return jsonify(ok=False, message=err, errors=[], warnings=[], infos=[],
                       log=log, ghdl_version=ghdl_version())
    if rc != 0 or errors:
        for e in errors:
            log.append(log_entry("error", _format_msg(e)))
        for w in warnings:
            log.append(log_entry("warning", _format_msg(w)))
        log.append(log_entry("error",
                             f"Check Syntax failed: {len(errors)} error(s), "
                             f"{len(warnings)} warning(s)."))
        return jsonify(ok=False, message=None, target=target, stage="design",
                       errors=errors, warnings=warnings, infos=infos,
                       log=log, ghdl_version=ghdl_version())

    if target == "tb":
        tb_code = data.get("tb_code")
        if not tb_code or not str(tb_code).strip():
            return jsonify(ok=False, message="Missing 'tb_code' in request body.",
                           errors=[], warnings=[], log=[]), 400
        write_source(tb_name, str(tb_code))
        log.append(log_entry("cmd", f"$ ghdl -a --std={std} workspace/{tb_name}"))
        rc, out, err = run_ghdl(["-a", f"--std={std}", tb_name])
        errors, warnings, infos = parse_ghdl_output(out)
        if err:
            log.append(log_entry("error", err))
            return jsonify(ok=False, message=err, target=target, stage="tb",
                           errors=[], warnings=[], infos=[], log=log,
                           ghdl_version=ghdl_version())
        if rc != 0 or errors:
            for e in errors:
                log.append(log_entry("error", _format_msg(e)))
            for w in warnings:
                log.append(log_entry("warning", _format_msg(w)))
            log.append(log_entry("error",
                                 f"Check Syntax failed: {len(errors)} error(s), "
                                 f"{len(warnings)} warning(s)."))
            return jsonify(ok=False, message=None, target=target, stage="tb",
                           errors=errors, warnings=warnings, infos=infos,
                           log=log, ghdl_version=ghdl_version())
        for w in warnings:
            log.append(log_entry("warning", _format_msg(w)))
        for i in infos:
            log.append(log_entry("info", _format_msg(i)))
        log.append(log_entry("success",
                             f"Check Syntax passed ({design_name} + {tb_name}): "
                             f"0 errors, {len(warnings)} warning(s)."))
        return jsonify(ok=True, message=None, target=target, stage="tb",
                       errors=[], warnings=warnings, infos=infos,
                       log=log, ghdl_version=ghdl_version())

    for w in warnings:
        log.append(log_entry("warning", _format_msg(w)))
    for i in infos:
        log.append(log_entry("info", _format_msg(i)))
    log.append(log_entry("success",
                         f"Check Syntax passed ({design_name}): 0 errors, "
                         f"{len(warnings)} warning(s)."))
    return jsonify(ok=True, message=None, target="design", stage="design",
                   errors=[], warnings=warnings, infos=infos,
                   log=log, ghdl_version=ghdl_version())


def _format_msg(e: dict) -> str:
    loc = ""
    if e.get("file") and e.get("line") is not None:
        loc = f"{e['file']}:{e['line']}:{e['col']}: "
    sim = f"@{e['sim_time']}: " if e.get("sim_time") else ""
    return f"{loc}{sim}{e['message']}"


# ---------------------------------------------------------------------------
# ISE process 2: Simulate Behavioral Model
# ---------------------------------------------------------------------------
@app.post("/simulate")
@synchronized_workspace
def simulate():
    data = request.get_json(silent=True) or {}
    std = _get_std(data)
    files = data.get("files")
    stop_time, total_fs, stop_err = validate_stop_time(data.get("stop_time"))
    if stop_err:
        return jsonify(ok=False, message=stop_err, errors=[], warnings=[], log=[]), 400

    if isinstance(files, list) and files:
        reset_workspace()
        log = []
        design_files = []
        tb_files = []
        for f in files:
            fname = _validated_filename(f.get("filename"), None)
            if not fname:
                continue
            code = str(f.get("code") or "")
            write_source(fname, code)
            ftype = str(f.get("type") or ("simulation" if fname.lower().startswith("tb_") else "design")).lower()
            if ftype == "simulation":
                tb_files.append(fname)
            else:
                design_files.append(fname)

        dependencies = data.get("dependencies") or []
        dep_ok, dep_errs, dep_warns, dep_infs, dep_log = _prepare_dependencies(dependencies, std=std)
        log.extend(dep_log)
        if not dep_ok:
            return jsonify(ok=False, message="Component dependency analysis failed.",
                           errors=dep_errs, warnings=dep_warns, infos=dep_infs, log=log,
                           tb_entity="", stop_time=stop_time, vcd_generated=False,
                           ghdl_version=ghdl_version())

        # Compile all design files
        if design_files:
            log.append(log_entry("cmd", f"$ ghdl -a --std={std} " + " ".join(f"workspace/{fn}" for fn in design_files)))
            rc, out, err = run_ghdl(["-a", f"--std={std}"] + design_files)
            errors, warnings, infos = parse_ghdl_output(out)
            if err or rc != 0 or errors:
                for e in errors:
                    log.append(log_entry("error", _format_msg(e)))
                log.append(log_entry("error", "Analysis of design files failed."))
                return jsonify(ok=False, message="Design analysis failed.", errors=errors, warnings=warnings,
                               infos=infos, log=log, tb_entity="", stop_time=stop_time,
                               vcd_generated=False, ghdl_version=ghdl_version())

        # Target testbench
        target_tb = _validated_filename(data.get("tb_filename") or data.get("active_tb"), None)
        if not target_tb and tb_files:
            target_tb = tb_files[0]
        if not target_tb:
            return jsonify(ok=False, message="No simulation testbench specified or found in project.",
                           errors=[], warnings=[], infos=[], log=log, tb_entity="",
                           stop_time=stop_time, vcd_generated=False, ghdl_version=ghdl_version())

        tb_entity = (data.get("tb_entity") or "").strip()
        if not tb_entity:
            tb_file_obj = next((f for f in files if f.get("filename") == target_tb), None)
            if tb_file_obj:
                m = ENTITY_RE.search(str(tb_file_obj.get("code") or ""))
                tb_entity = m.group(1) if m else Path(target_tb).stem
            else:
                tb_entity = Path(target_tb).stem

        if not IDENT_RE.match(tb_entity):
            return jsonify(ok=False, message=f"Invalid testbench entity name {tb_entity!r}.",
                           errors=[], warnings=[], infos=[], log=log, tb_entity=tb_entity,
                           stop_time=stop_time, vcd_generated=False, ghdl_version=ghdl_version()), 400

        # Compile active testbench
        log.append(log_entry("cmd", f"$ ghdl -a --std={std} workspace/{target_tb}"))
        rc, out, err = run_ghdl(["-a", f"--std={std}", target_tb])
        errors, warnings, infos = parse_ghdl_output(out)
        if err or rc != 0 or errors:
            for e in errors:
                log.append(log_entry("error", _format_msg(e)))
            log.append(log_entry("error", f"Analysis of testbench '{target_tb}' failed."))
            return jsonify(ok=False, message=f"{target_tb} failed to analyze.", errors=errors,
                           warnings=warnings, infos=infos, log=log, tb_entity=tb_entity,
                           stop_time=stop_time, vcd_generated=False, ghdl_version=ghdl_version())

        # Elaborate
        log.append(log_entry("cmd", f"$ ghdl -e --std={std} {tb_entity}"))
        rc, out, err = run_ghdl(["-e", f"--std={std}", tb_entity])
        errors, warnings, infos = parse_ghdl_output(out)
        if err or rc != 0 or errors:
            for e in errors:
                log.append(log_entry("error", _format_msg(e)))
            log.append(log_entry("error", f"Elaboration of '{tb_entity}' failed."))
            return jsonify(ok=False, message=f"Elaboration of '{tb_entity}' failed.", errors=errors,
                           warnings=warnings, infos=infos, log=log, tb_entity=tb_entity,
                           stop_time=stop_time, vcd_generated=False, ghdl_version=ghdl_version())

        # Run simulation & dump VCD
        log.append(log_entry("cmd", f"$ ghdl -r --std={std} {tb_entity} --vcd=wave.vcd --stop-time={stop_time}"))
        rc, out, err = run_ghdl(["-r", f"--std={std}", tb_entity, "--vcd=wave.vcd", f"--stop-time={stop_time}"],
                                timeout=max(GHDL_TIMEOUT_S, 300))
        errors, warnings, infos = parse_ghdl_output(out)
        for e in errors:
            log.append(log_entry("error", _format_msg(e)))
        for w in warnings:
            log.append(log_entry("warning", _format_msg(w)))
        for i in infos:
            log.append(log_entry("info", _format_msg(i)))

        vcd_path = WORKSPACE_DIR / "wave.vcd"
        vcd_generated = vcd_path.exists() and vcd_path.stat().st_size > 0
        if not vcd_generated:
            log.append(log_entry("error", "No wave.vcd was produced by the simulation."))
            return jsonify(ok=False, message="Simulation produced no VCD waveform.",
                           errors=errors, warnings=warnings, infos=infos, log=log,
                           tb_entity=tb_entity, stop_time=stop_time,
                           vcd_generated=False, ghdl_version=ghdl_version())

        active_tb_code = (WORKSPACE_DIR / target_tb).read_text(errors="replace") if (WORKSPACE_DIR / target_tb).exists() else ""
        try:
            parsed = parse_vcd_to_wavedrom(vcd_path, tb_entity, std=std,
                                           stop_fs=total_fs, tb_code=active_tb_code)
        except Exception as exc:
            log.append(log_entry("error", f"VCD parsing failed: {exc}"))
            return jsonify(ok=False, message=f"VCD parsing failed: {exc}",
                           errors=errors, warnings=warnings, infos=infos, log=log,
                           tb_entity=tb_entity, stop_time=stop_time,
                           vcd_generated=True, ghdl_version=ghdl_version())

        ok = rc == 0 and not errors
        if ok:
            log.append(log_entry("success",
                                 f"Simulation complete: {len(parsed['signals'])} signal(s), "
                                 f"{_fmt_ns(Decimal(str(parsed['end_time_ns'])))} ns simulated."))
        else:
            parsed["partial"] = True
            log.append(log_entry("error", "Simulation stopped early -- showing captured waveform."))
        return jsonify(ok=ok, message=None, errors=errors, warnings=warnings, infos=infos,
                       log=log, tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=True, ghdl_version=ghdl_version(), **parsed)

    # Legacy single-file mode
    design_code = data.get("design_code")
    tb_code = data.get("tb_code")
    if not design_code or not str(design_code).strip():
        return jsonify(ok=False, message="Missing 'design_code' in request body.",
                       errors=[], warnings=[], log=[]), 400
    if not tb_code or not str(tb_code).strip():
        return jsonify(ok=False, message="Missing 'tb_code' in request body.",
                       errors=[], warnings=[], log=[]), 400

    tb_entity = (data.get("tb_entity") or "").strip()
    if not tb_entity:
        m = ENTITY_RE.search(str(tb_code))
        tb_entity = m.group(1) if m else ""
        if not tb_entity:
            return jsonify(ok=False,
                           message="Could not determine the testbench entity name: "
                                   "no 'entity <name> is' found in tb_code.",
                           errors=[], warnings=[], log=[]), 400
    if not IDENT_RE.match(tb_entity):
        return jsonify(ok=False, message=f"Invalid testbench entity name {tb_entity!r}.",
                       errors=[], warnings=[], log=[]), 400

    stop_time, total_fs, stop_err = validate_stop_time(data.get("stop_time"))
    if stop_err:
        return jsonify(ok=False, message=stop_err, errors=[], warnings=[], log=[]), 400
    design_name = _validated_filename(data.get("design_filename"), "design.vhd")
    tb_name = _validated_filename(data.get("tb_filename"), "tb_design.vhd")
    if design_name is None or tb_name is None:
        return jsonify(ok=False,
                       message="Invalid source filename (expected <name>.vhd).",
                       errors=[], warnings=[], log=[]), 400

    dependencies = data.get("dependencies") or []
    reset_workspace()

    dep_ok, dep_errs, dep_warns, dep_infs, dep_log = _prepare_dependencies(dependencies, std=std)
    log = list(dep_log)
    if not dep_ok:
        return jsonify(ok=False, message="Component dependency analysis failed.",
                       errors=dep_errs, warnings=dep_warns, infos=dep_infs, log=log,
                       tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=False, ghdl_version=ghdl_version())

    log.append(log_entry("cmd", f"$ ghdl -a --std={std} workspace/{design_name}"))
    write_source(design_name, str(design_code))
    write_source(tb_name, str(tb_code))

    def fail(rc_out_err, message=None, extra=None):
        rc, out, err = rc_out_err
        errors, warnings, infos = parse_ghdl_output(out)
        if err:
            log.append(log_entry("error", err))
        for e in errors:
            log.append(log_entry("error", _format_msg(e)))
        for w in warnings:
            log.append(log_entry("warning", _format_msg(w)))
        for i in infos:
            log.append(log_entry("info", _format_msg(i)))
        log.append(log_entry("error", message or "Simulation aborted."))
        payload = dict(ok=False, message=message, errors=errors, warnings=warnings,
                       infos=infos, log=log, tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=False, ghdl_version=ghdl_version())
        payload.update(extra or {})
        return jsonify(payload)

    # step 1: analyze design
    rc, out, err = run_ghdl(["-a", f"--std={std}", design_name])
    errors, warnings, infos = parse_ghdl_output(out)
    if err:
        return fail((rc, out, err))
    if rc != 0 or errors:
        for e in errors:
            log.append(log_entry("error", _format_msg(e)))
        log.append(log_entry("error", f"Analysis of {design_name} failed "
                                      "(fix the errors before simulating)."))
        return jsonify(ok=False, message=f"{design_name} failed to analyze.",
                       errors=errors, warnings=warnings, infos=infos, log=log,
                       tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=False, ghdl_version=ghdl_version())
    for i in infos:
        log.append(log_entry("info", _format_msg(i)))

    # step 2: analyze testbench
    log.append(log_entry("cmd", f"$ ghdl -a --std={std} workspace/{tb_name}"))
    rc, out, err = run_ghdl(["-a", f"--std={std}", tb_name])
    errors, warnings, infos = parse_ghdl_output(out)
    if err:
        return fail((rc, out, err))
    if rc != 0 or errors:
        for e in errors:
            log.append(log_entry("error", _format_msg(e)))
        log.append(log_entry("error", f"Analysis of {tb_name} failed."))
        return jsonify(ok=False, message=f"{tb_name} failed to analyze.",
                       errors=errors, warnings=warnings, infos=infos, log=log,
                       tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=False, ghdl_version=ghdl_version())
    for i in infos:
        log.append(log_entry("info", _format_msg(i)))

    # step 3: elaborate behavioral model
    log.append(log_entry("cmd", f"$ ghdl -e --std={std} {tb_entity}"))
    rc, out, err = run_ghdl(["-e", f"--std={std}", tb_entity])
    if err:
        return fail((rc, out, err))
    errors, warnings, infos = parse_ghdl_output(out)
    if rc != 0 or errors:
        for e in errors:
            log.append(log_entry("error", _format_msg(e)))
        log.append(log_entry("error", f"Elaboration of '{tb_entity}' failed."))
        return jsonify(ok=False, message=f"Elaboration of '{tb_entity}' failed.",
                       errors=errors, warnings=warnings, infos=infos, log=log,
                       tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=False, ghdl_version=ghdl_version())

    # step 4: run simulation, dump VCD
    log.append(log_entry("cmd",
                         f"$ ghdl -r --std={std} {tb_entity} "
                         f"--vcd=wave.vcd --stop-time={stop_time}"))
    rc, out, err = run_ghdl(["-r", f"--std={std}", tb_entity,
                             "--vcd=wave.vcd", f"--stop-time={stop_time}"],
                            timeout=max(GHDL_TIMEOUT_S, 300))
    errors, warnings, infos = parse_ghdl_output(out)
    if err:
        return fail((rc, out, err))
    for e in errors:
        log.append(log_entry("error", _format_msg(e)))
    for w in warnings:
        log.append(log_entry("warning", _format_msg(w)))
    for i in infos:
        log.append(log_entry("info", _format_msg(i)))

    vcd_path = WORKSPACE_DIR / "wave.vcd"
    vcd_generated = vcd_path.exists() and vcd_path.stat().st_size > 0
    if not vcd_generated:
        log.append(log_entry("error", "No wave.vcd was produced by the simulation."))
        return jsonify(ok=False, message="Simulation produced no VCD waveform.",
                       errors=errors, warnings=warnings, infos=infos, log=log,
                       tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=False, ghdl_version=ghdl_version())

    # step 5: parse VCD -> WaveDrom JSON
    try:
        parsed = parse_vcd_to_wavedrom(vcd_path, tb_entity, std=std,
                                       stop_fs=total_fs, tb_code=tb_code)
    except Exception as exc:                     # malformed VCD / parser issue
        log.append(log_entry("error", f"VCD parsing failed: {exc}"))
        return jsonify(ok=False, message=f"VCD parsing failed: {exc}",
                       errors=errors, warnings=warnings, infos=infos, log=log,
                       tb_entity=tb_entity, stop_time=stop_time,
                       vcd_generated=True, ghdl_version=ghdl_version())

    ok = rc == 0 and not errors
    if ok:
        log.append(log_entry("success",
                             f"Simulation complete: {len(parsed['signals'])} signal(s), "
                             f"{_fmt_ns(Decimal(str(parsed['end_time_ns'])))} ns simulated, "
                             f"{parsed['n_slots']} time slots -> WaveDrom JSON "
                             f"(1 div = {_fmt_ns(Decimal(str(parsed['div_ns'])))} ns)."))
    else:
        parsed["partial"] = True
        log.append(log_entry("error",
                             "Simulation stopped early (assertion failure or runtime "
                             "error) -- showing the waveform captured so far."))
    return jsonify(ok=ok, message=None, errors=errors, warnings=warnings, infos=infos,
                   log=log, tb_entity=tb_entity, stop_time=stop_time,
                   vcd_generated=True, ghdl_version=ghdl_version(), **parsed)


@app.get("/api/simulation/vcd")
def download_simulation_vcd():
    """Download the raw IEEE-1364 Value Change Dump (VCD) waveform trace.

    Enables students to export the full simulation waveform and open it
    directly in GTKWave or attach it to laboratory reports.
    """
    vcd_path = WORKSPACE_DIR / "wave.vcd"
    if not vcd_path.is_file() or vcd_path.stat().st_size == 0:
        return jsonify(
            ok=False,
            message="No simulation VCD available. Run a simulation first to generate the waveform trace."
        ), 404

    raw_name = (request.args.get("name") or "wave.vcd").strip()
    safe_name = re.sub(r"[^a-zA-Z0-9_\-.]", "_", raw_name)
    if not safe_name.lower().endswith(".vcd"):
        safe_name += ".vcd"

    return send_file(
        str(vcd_path),
        as_attachment=True,
        download_name=safe_name,
        mimetype="text/plain; charset=utf-8",
        max_age=0
    )


if __name__ == "__main__":
    os.environ["VHDL_LIVE_SERVER"] = "1"
    is_restart = os.environ.pop("VHDL_RESTARTED", None) == "1"
    requested_port = int(os.environ.get("PORT", "5000"))

    # During a live restart, the previous server was already running on requested_port.
    # We must wait for and preserve the exact same port so the open browser tab's polling
    # connects seamlessly without timeout or spawning duplicate tabs.
    if is_restart:
        print(f"[*] Live restart detected: waiting for port {requested_port} to release from previous server...")
        if wait_for_port_release(requested_port, max_retries=12, delay=0.4):
            port = requested_port
        else:
            print(f"[!] Warning: Port {requested_port} was not released in time. Finding alternative port...")
            port = find_available_port(requested_port + 1)
    else:
        # Cold start: find first bindable port (handles WinError 10013 excluded port ranges)
        port = find_available_port(requested_port)

    if port != requested_port:
        print(f"[*] Port {requested_port} is busy or restricted by Windows permissions (WinError 10013 / 10048).")
        print(f"[*] Automatically switched to available port {port}.")
        os.environ["PORT"] = str(port)

    print("=" * 64)
    print(" Digital Systems Laboratory 2  (offline VHDL simulator)")
    print(f"   project root : {BASE_DIR}")
    print(f"   workspace    : {WORKSPACE_DIR}")
    print(f"   projects     : {PROJECTS_DIR}")
    print(f"   GHDL         : {ghdl_version() or 'NOT FOUND - install ghdl on PATH'}")
    print(f"   URL          : http://127.0.0.1:{port}")
    print("=" * 64)

    # Browser opening logic:
    # 1. Cold start with port redirected (e.g. 5000 -> 5050): open browser to actual port.
    # 2. Live restart that had to fallback to a different port (requested_port was lost):
    #    open browser to the new port because the old tab polling on requested_port is dead.
    # 3. Live restart on the same port: do NOT open browser; the existing active tab reloads in-place.
    if port != requested_port:
        def _redirect_browser():
            time.sleep(1.0)
            try:
                webbrowser.open(f"http://127.0.0.1:{port}")
            except Exception:
                pass
        threading.Thread(target=_redirect_browser, daemon=True).start()

    # Bind and start the WSGI server using make_server so we maintain direct control
    # over the listening socket (can explicitly server_close() and clear inheritable flag before execv)
    for attempt in range(1, 11):
        try:
            GLOBAL_SERVER = make_server("127.0.0.1", port, app, threaded=True)
            try:
                GLOBAL_SERVER.socket.set_inheritable(False)
            except Exception:
                pass
            GLOBAL_SERVER.serve_forever()
            break
        except OSError as e:
            err_code = getattr(e, "winerror", None)
            err_str = str(e)
            if attempt < 10 and (err_code in (10048, 10013) or "10048" in err_str or "10013" in err_str):
                print(f"[*] Port {port} is busy/releasing (attempt {attempt}/10, waiting 0.5s)...")
                time.sleep(0.5)
            else:
                # If chosen port failed, dynamically search for another one
                fallback = find_available_port(port + 1)
                if fallback != port:
                    print(f"[*] Switching to fallback port {fallback}...")
                    port = fallback
                    os.environ["PORT"] = str(port)
                    continue
                raise
