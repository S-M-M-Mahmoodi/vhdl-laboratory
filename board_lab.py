# -*- coding: utf-8 -*-
"""
Board Lab backend: FPGA board-level simulation for VHDL Laboratory.

Compiles the student's design, wraps it in a generated board testbench that
drives the DUT from virtual board elements (DIP switches, push buttons,
clock), runs GHDL and returns the final value of every output port so the
web UI can light LEDs / 7-segment digits / LCD text realistically.

Endpoints
---------
POST /api/board/simulate
    {files, board_tb (entity, generics, inputs), stop_time, standard}
    -> {ok, outputs: {port: {bits, hex, value}}, end_time_ns, log, ...}
"""

from __future__ import annotations

import re
from pathlib import Path

from flask import Blueprint, jsonify, request

bp = Blueprint("boardlab", __name__)

# Helpers are imported lazily from the host app (app.py imports this module
# at the very bottom, so a top-level `from app import ...` here would be
# circular at module init time).
def _helpers():
    import app as _app
    return _app

IDENT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

# Total simulated time for a board run (must fit validate_stop_time's cap).
BOARD_STOP_TIME = "500 ns"

# Fast incremental compilation cache for Board Lab
_COMPILED_DESIGN_SIG: tuple | None = None
_COMPILED_TB_SIG: tuple | None = None


# ---------------------------------------------------------------------------
# Generic extraction
# ---------------------------------------------------------------------------

_GENERIC_RE = re.compile(
    r"\b(\w+)\s*:\s*(integer|natural|positive|boolean|string)\b[^;]*(?:;|$)",
    re.IGNORECASE,
)


def _parse_generics_vhdl(code: str, target_entity: str | None = None) -> list[dict]:
    """Extract generic names + integer defaults from the target entity."""
    if not code:
        return []
    no_comments = re.sub(r"--[^\n]*", " ", code)
    if target_entity:
        pattern = rf"\bentity\s+{re.escape(target_entity)}\s+is\b"
    else:
        pattern = r"\bentity\s+([A-Za-z][A-Za-z0-9_]*)\s+is\b"
    m = re.search(pattern, no_comments, re.IGNORECASE)
    if not m:
        return []
    after = no_comments[m.end():]
    end_m = re.search(r"\bend\b", after, re.IGNORECASE)
    body = after[:end_m.start()] if end_m else after
    gm = re.search(r"\bgeneric\s*\(", body, re.IGNORECASE)
    if not gm:
        return []
    start, depth, end_idx = gm.end(), 1, -1
    for i in range(start, len(body)):
        if body[i] == "(":
            depth += 1
        elif body[i] == ")":
            depth -= 1
            if depth == 0:
                end_idx = i
                break
    if end_idx == -1:
        return []
    generics = []
    for chunk in body[start:end_idx].split(";"):
        cm = re.match(
            r"^\s*(\w+)\s*:\s*(integer|natural|positive)\s*(?::=\s*(\d+)\s*)?$",
            chunk.strip(), re.IGNORECASE,
        )
        if not cm:
            cm2 = re.match(r"^\s*(\w+)\s*:\s*(\w+)\s*(?::=\s*([^)]*))?$",
                           chunk.strip(), re.IGNORECASE)
            if not cm2:
                continue
            name, typ, default = cm2.group(1), cm2.group(2).lower(), cm2.group(3)
        else:
            name, typ, default = cm.group(1), cm.group(2).lower(), cm.group(3)
        if typ not in ("integer", "natural", "positive"):
            continue
        val = None
        if default:
            dm = re.search(r"(\d+)", default)
            if dm:
                val = int(dm.group(1))
        generics.append({"name": name, "type": typ, "default": val})
    return generics


# ---------------------------------------------------------------------------
# Board testbench generation
# ---------------------------------------------------------------------------

def _norm_bits(bits: list[str], width: int) -> list[str]:
    """Normalize a list of '0'/'1' chars to exactly `width` entries (msb-first)."""
    bits = [b if b in ("0", "1") else "0" for b in bits]
    if len(bits) >= width:
        return bits[:width]
    return ["0"] * (width - len(bits)) + bits


def _sv_literal(bits: list[str]) -> str:
    """Build a VHDL std_logic_vector literal: \"1010\" — msb first."""
    return '"' + "".join(bits) + '"'


def _safe_ident(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", name) or "sig"


def generate_board_testbench(entity: str, ports: list[dict],
                             generics: list[dict] | None = None,
                             inputs: dict | None = None,
                             clock_port: str | None = None,
                             clock_half_period_ns: float = 10.0) -> str:
    """Generate a board-level testbench around the student's entity.

    Every input port is driven from a constant value derived from the virtual
    board elements. The clock port (auto-detected or chosen in the UI) toggles
    forever with the requested half period. Output ports are simply left to
    propagate; their final values are read from the VCD.
    """
    generics = generics or []
    inputs = inputs or {}

    # Resolved generic values (UI value > VHDL default > type floor) used to
    # recompute vector widths for ports declared with generic bounds such as
    # std_logic_vector(N-1 downto 0).
    resolved: dict[str, int] = {}
    generic_map = []
    for g in generics:
        gname = g["name"]
        val = inputs.get("generics", {}).get(gname)
        if val is None:
            val = g.get("default")
        if val is None:
            val = 1 if g["type"] == "integer" else 0
        try:
            val = int(val)
        except (TypeError, ValueError):
            val = 1 if g["type"] == "integer" else 0
        resolved[gname] = val
        generic_map.append(f"{gname} => {val}")
    generic_map_str = ("generic map (\n      " + ",\n      ".join(generic_map) + "\n    )") if generic_map else ""

    # If the parsed msb came from a generic expression, recompute with resolved generic values
    for p in ports:
        raw = (p.get("rawType") or "")
        m = re.search(r"\(\s*([A-Za-z][A-Za-z0-9_]*)\s*([+-])\s*(\d+)\s+(?:downto|to)\s*(\d+)\s*\)", raw)
        if m and m.group(1) in resolved:
            gname, op, off, lsb = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))
            top = resolved[gname] + off if op == "+" else resolved[gname] - off
            p["msb"], p["lsb"] = top, lsb
            p["_width"] = abs(top - lsb) + 1

    port_map = []
    decl_lines = []
    drive_lines = []
    clk_decl_done = False
    num_in = 0

    for p in ports:
        pname = p["name"]
        pdir = p["dir"]
        vector = bool(p.get("vector"))
        msb = int(p.get("msb") or 7)
        lsb = int(p.get("lsb") or 0)
        width = abs(msb - lsb) + 1
        raw_bits = inputs.get(pname) or inputs.get(pname.lower())

        if pdir in ("out", "buffer", "inout"):
            # output / inout observed side: wire directly to the DUT pin
            port_map.append(f"{pname} => {pname}")
            if vector:
                decl_lines.append(f"  signal {pname} : std_logic_vector({msb} downto {lsb});")
            else:
                decl_lines.append(f"  signal {pname} : std_logic;")
            continue

        # input side
        num_in += 1
        is_clk = (clock_port and pname.lower() == clock_port.lower())
        if is_clk and not clk_decl_done:
            # clock port: free-running board clock (initialized so 'not' works)
            half = max(0.001, float(clock_half_period_ns))
            decl_lines.append(f"  signal {pname} : std_logic := '0';")
            decl_lines.append(f"  constant {pname}_half_period : time := {half:g} ns;")
            drive_lines.append(
                f"  {pname} <= not {pname} after {pname}_half_period;"
            )
            port_map.append(f"{pname} => {pname}")
            clk_decl_done = True
            continue

        if vector:
            decl_lines.append(f"  signal {pname} : std_logic_vector({msb} downto {lsb});")
        else:
            decl_lines.append(f"  signal {pname} : std_logic;")
        port_map.append(f"{pname} => {pname}")

        if vector:
            bits = _norm_bits(list(str(raw_bits or "")), width)
            drive_lines.append(
                f"  {pname} <= {_sv_literal(bits)};  -- driven by board elements"
            )
        else:
            bit = "0"
            if raw_bits is not None:
                s = str(raw_bits).strip()
                bit = s[-1] if s[-1] in ("0", "1") else "0"
            drive_lines.append(f"  {pname} <= '{bit}';")

    # If no clock port was requested but a port named clk/clock exists and the
    # user did not explicitly map it to an element, default it to a clock.
    pm_body = ",\n      ".join(port_map) if port_map else ""

    inst = []
    inst.append(f"  u_dut : entity work.{entity}")
    if generic_map_str:
        inst.append(f"    {generic_map_str}")
    inst.append(f"    port map (\n      {pm_body}\n    );")
    inst_str = "\n".join(inst)

    decl_str = "\n".join(decl_lines)
    drive_str = "\n".join(drive_lines)

    tb_name = "tb_board_" + re.sub(r"[^A-Za-z0-9_]", "_", entity)
    return f"""--------------------------------------------------------------------------------
-- Auto-generated board testbench for entity '{entity}'
-- Generated by VHDL Laboratory :: Board Lab
--------------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;

entity {tb_name} is
end entity {tb_name};

architecture board of {tb_name} is
{decl_str}
begin
{inst_str}

  -- Board-level input drivers --------------------------------------------
{drive_str}

end architecture board;
"""


# ---------------------------------------------------------------------------
# VCD result extraction
# ---------------------------------------------------------------------------

def _vcd_final_values(vcd_path: Path) -> tuple[dict[str, dict], float | None]:
    """Read the last value of every top-level VCD signal and simulation end time in ns.

    Returns ({leaf_name: {"width": int, "bits": "0101...", "value": int|None}}, end_time_ns)
    where bits is msb-first as written in the VCD.
    """
    from vcdvcd import VCDVCD

    raw = vcd_path.read_text(errors="replace")
    mult = 1.0
    m = re.search(r"\$timescale\s+(\d+)\s*([A-Za-z]+)", raw, re.IGNORECASE)
    unit_map = {"fs": 1, "ps": 1_000, "ns": 1_000_000, "us": 1_000_000_000, "ms": 1_000_000_000_000, "s": 1_000_000_000_000_000}
    if m:
        num = float(m.group(1))
        unit = (m.group(2) or "fs").lower()
        mult = num * unit_map.get(unit, 1)

    vcd = VCDVCD(str(vcd_path))
    end_raw = getattr(vcd, "endtime", 0) or 0
    end_ns = round((float(end_raw) * mult) / 1_000_000.0, 3) if end_raw else None

    result: dict[str, dict] = {}
    for name in vcd.signals:
        sig = vcd.data[vcd.references_to_ids[name]]
        # top-level signals of the board testbench only (no DUT internals)
        segs = name.split(".")
        if len(segs) > 2:
            continue
        leaf = segs[-1]
        # strip GHDL's vector suffix: a[7:0] -> a
        base = re.sub(r"\[\d+:\d+\]$", "", leaf)
        if base in result:           # first definition wins (top-level)
            continue
        try:
            width = int(str(getattr(sig, "size", None) or 1))
        except ValueError:
            width = 1
        tv = list(sig.tv)
        if not tv:
            continue
        raw_val = str(tv[-1][1]).strip()
        v = raw_val.lower()
        if v.startswith("b"):
            v = v[1:]
        if not v or set(v) - set("01xz"):
            continue
        if any(c in "xz" for c in v):
            # resolve per-bit: keep '0'/'1', map unknowns to 0 for display
            bits = "".join("0" if c in "xz" else c for c in v)
            unknown = True
        else:
            bits = v
            unknown = False
        try:
            value = int(bits, 2) if bits else 0
        except ValueError:
            value = None
        result[base] = {"width": width, "bits": bits, "value": value,
                        "unknown": unknown}
    return result, end_ns


def _detect_periodicity(frames: list[dict], out_ports: list[str]) -> tuple[int, int]:
    """Detect if sequence of frames enters a periodic loop.
    Returns (period_start, period). If non-periodic or too short, returns (0, 0).
    """
    if len(frames) < 8:
        return 0, 0
    sigs = []
    for f in frames:
        out = f.get("outputs", {})
        sig = tuple((p, out.get(p, {}).get("bits", "")) for p in out_ports)
        sigs.append(sig)

    n = len(sigs)
    seen: dict[tuple, list[int]] = {}
    for i in range(n):
        s = sigs[i]
        if s in seen:
            for prev in seen[s]:
                p = i - prev
                if p >= 1 and i + p <= n:
                    is_periodic = True
                    for j in range(i, n):
                        expected = sigs[prev + ((j - prev) % p)]
                        if sigs[j] != expected:
                            is_periodic = False
                            break
                    if is_periodic:
                        return prev, p
            seen[s].append(i)
        else:
            seen[s] = [i]
    return 0, 0


def _vcd_timeline_frames(vcd_path: Path, ports: list[dict],
                         clock_port: str | None = None,
                         clock_half_ns: float = 10.0,
                         batch_cycles: int = 1024) -> tuple[dict[str, dict], list[dict], int, int, float | None]:
    """Extract final outputs and a cycle-by-cycle frames timeline from VCD.

    Returns: (finals, frames, period_start, period, end_ns)
    """
    from vcdvcd import VCDVCD

    raw = vcd_path.read_text(errors="replace")
    mult = 1.0
    m = re.search(r"\$timescale\s+(\d+)\s*([A-Za-z]+)", raw, re.IGNORECASE)
    unit_map = {"fs": 1, "ps": 1_000, "ns": 1_000_000, "us": 1_000_000_000, "ms": 1_000_000_000_000, "s": 1_000_000_000_000_000}
    if m:
        num = float(m.group(1))
        unit = (m.group(2) or "fs").lower()
        mult = num * unit_map.get(unit, 1)

    vcd = VCDVCD(str(vcd_path))
    end_raw = getattr(vcd, "endtime", 0) or 0
    end_ns = round((float(end_raw) * mult) / 1_000_000.0, 3) if end_raw else None

    out_sigs: dict[str, tuple[any, int]] = {}
    for name in vcd.signals:
        sig = vcd.data[vcd.references_to_ids[name]]
        segs = name.split(".")
        if len(segs) > 2:
            continue
        leaf = segs[-1]
        base = re.sub(r"\[\d+:\d+\]$", "", leaf)
        if base in out_sigs:
            continue
        try:
            width = int(str(getattr(sig, "size", None) or 1))
        except ValueError:
            width = 1
        out_sigs[base] = (sig, width)

    # 1. Final values
    finals: dict[str, dict] = {}
    for p in ports:
        pname = p["name"]
        if p["dir"] not in ("out", "buffer", "inout"):
            continue
        if pname in out_sigs:
            sig, width = out_sigs[pname]
            tv = list(sig.tv)
            if tv:
                raw_val = str(tv[-1][1]).strip().lower()
                if raw_val.startswith("b"):
                    raw_val = raw_val[1:]
                bits = "".join("0" if c in "xz" else c for c in raw_val) if set(raw_val) - set("01xz") == set() else ""
                try:
                    val = int(bits, 2) if bits else 0
                except ValueError:
                    val = None
                finals[pname] = {"width": width, "bits": bits, "value": val,
                                "unknown": any(c in "xz" for c in raw_val)}
        if pname not in finals:
            msb = int(p.get("msb") or 0)
            lsb = int(p.get("lsb") or 0)
            w = abs(msb - lsb) + 1 if p.get("vector") else 1
            finals[pname] = {"width": w, "bits": "0" * w, "value": 0, "unknown": True}

    # 2. Cycle-by-cycle frames timeline
    frames: list[dict] = []
    if not clock_port or batch_cycles <= 1:
        frames.append({"cycle": 0, "outputs": finals})
        return finals, frames, 0, 0, end_ns

    half = max(0.001, float(clock_half_ns))
    delta = min(5.0, half * 0.2)

    sig_tv = {}
    sig_idx = {}
    sig_widths = {}
    for p in ports:
        pname = p["name"]
        if p["dir"] not in ("out", "buffer", "inout"):
            continue
        if pname in out_sigs:
            sig, w = out_sigs[pname]
            sig_tv[pname] = list(sig.tv)
            sig_idx[pname] = 0
            sig_widths[pname] = w

    max_k = max(1, min(batch_cycles, 4096))
    for cycle in range(max_k):
        t_ns = (half * 0.5) if cycle == 0 else ((2 * cycle - 1) * half + delta)
        t_scaled = int(round((t_ns * 1_000_000.0) / mult))
        if end_raw and t_scaled > end_raw:
            break
        frame_out: dict[str, dict] = {}
        for p in ports:
            pname = p["name"]
            if p["dir"] not in ("out", "buffer", "inout"):
                continue
            if pname in sig_tv and sig_tv[pname]:
                tv = sig_tv[pname]
                idx = sig_idx[pname]
                while idx + 1 < len(tv) and tv[idx + 1][0] <= t_scaled:
                    idx += 1
                sig_idx[pname] = idx
                raw_val = str(tv[idx][1]).strip().lower()
                if raw_val.startswith("b"):
                    raw_val = raw_val[1:]
                bits = "".join("0" if c in "xz" else c for c in raw_val) if set(raw_val) - set("01xz") == set() else ""
                try:
                    val = int(bits, 2) if bits else 0
                except ValueError:
                    val = None
                frame_out[pname] = {
                    "width": sig_widths[pname],
                    "bits": bits,
                    "value": val,
                    "unknown": any(c in "xz" for c in raw_val)
                }
            else:
                frame_out[pname] = finals.get(pname, {"width": 1, "bits": "0", "value": 0, "unknown": True})
        frames.append({"cycle": cycle, "outputs": frame_out})

    out_port_names = [p["name"] for p in ports if p["dir"] in ("out", "buffer", "inout")]
    period_start, period = _detect_periodicity(frames, out_port_names)
    return finals, frames, period_start, period, end_ns


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@bp.post("/api/board/simulate")
def board_simulate():
    h = _helpers()
    data = request.get_json(silent=True) or {}
    std = h._get_std(data)
    files = data.get("files") or []

    entity = (data.get("entity") or "").strip()
    board_tb = data.get("board_tb") or {}
    inputs = board_tb.get("inputs") or {}
    clock_port = board_tb.get("clock_port") or None
    clock_half = board_tb.get("clock_half_period_ns") or 10.0
    clock_cycles = board_tb.get("clock_cycles")
    batch_cycles = board_tb.get("batch_cycles") or data.get("batch_cycles")

    if batch_cycles is not None:
        try:
            b_cycles = max(1, int(batch_cycles))
            half = max(0.001, float(clock_half))
            raw_ns = min(900_000.0, (2 * b_cycles) * half + max(1.0, half * 0.5))
            stop_time = f"{int(round(raw_ns))}ns"
        except (ValueError, TypeError):
            stop_time = (data.get("stop_time") or BOARD_STOP_TIME).strip() or BOARD_STOP_TIME
    elif clock_cycles is not None:
        try:
            cycles = int(clock_cycles)
            if cycles >= 0:
                half = max(0.001, float(clock_half))
                if cycles == 0:
                    raw_ns = half * 0.5
                else:
                    raw_ns = (2 * cycles - 1) * half + max(1.0, half * 0.2)
                if raw_ns >= 1.0:
                    stop_time = f"{int(round(raw_ns))}ns"
                else:
                    stop_time = f"{raw_ns:.3f}".rstrip("0").rstrip(".") + "ns"
            else:
                stop_time = (data.get("stop_time") or BOARD_STOP_TIME).strip() or BOARD_STOP_TIME
        except (ValueError, TypeError):
            stop_time = (data.get("stop_time") or BOARD_STOP_TIME).strip() or BOARD_STOP_TIME
    else:
        stop_time = (data.get("stop_time") or BOARD_STOP_TIME).strip() or BOARD_STOP_TIME
    # GHDL expects a unit directly attached to the number (--stop-time=500ns)
    stop_time = re.sub(r"\s+", "", stop_time)

    log: list[dict] = []

    if not files:
        return jsonify(ok=False, message="No source files in request.",
                       log=[], ghdl_version=h.ghdl_version()), 400

    # The file whose entity we wrap on the board
    design_file = None
    design_code = ""
    ports: list[dict] = []
    generics: list[dict] = []

    if entity:
        for f in files:
            code = str(f.get("code") or "")
            if f.get("entity") == entity or entity in _entities_in(code):
                design_file, design_code = f, code
                break
    if design_file is None:                     # fall back to first design file
        for f in files:
            if str(f.get("type") or "design").lower() == "design":
                design_file, design_code = f, str(f.get("code") or "")
                break
    if design_file is None:
        design_file, design_code = files[0], str(files[0].get("code") or "")

    if not design_code.strip():
        return jsonify(ok=False, message="Design source is empty.",
                       log=log, ghdl_version=h.ghdl_version()), 400

    if entity:
        ports = h._parse_entity_ports_vhdl(design_code, entity)
        generics = _parse_generics_vhdl(design_code, entity)
    if not ports:
        # try to auto-detect the top entity of the design file
        m = re.search(r"\bentity\s+([A-Za-z][A-Za-z0-9_]*)\s+is\b", design_code, re.IGNORECASE)
        entity = m.group(1) if m else ""
        if not entity:
            return jsonify(ok=False, message="Could not find any entity in the design source.",
                           log=log, ghdl_version=h.ghdl_version()), 400
        ports = h._parse_entity_ports_vhdl(design_code, entity)
        generics = _parse_generics_vhdl(design_code, entity)

    if not IDENT_RE.match(entity):
        return jsonify(ok=False, message=f"Invalid entity name {entity!r}.",
                       log=log, ghdl_version=h.ghdl_version()), 400

    # --- write sources & compile (thread-safe workspace) -----------------
    with h.SIM_LOCK:
        global _COMPILED_DESIGN_SIG, _COMPILED_TB_SIG

        dependencies = data.get("dependencies") or []
        cf_path = h.WORKSPACE_DIR / f"work-obj{std}.cf"
        design_sig = (
            std,
            entity,
            tuple((f.get("filename", ""), str(f.get("code", "")), str(f.get("type", ""))) for f in files),
            tuple((d.get("name", ""), str(d.get("code", ""))) for d in dependencies)
        )

        design_cached = (_COMPILED_DESIGN_SIG == design_sig) and cf_path.is_file()

        design_files: list[str] = []
        tb_files: list[str] = []
        for f in files:
            fname = h._validated_filename(f.get("filename"), None)
            if not fname:
                continue
            ftype = str(f.get("type") or ("simulation" if fname.lower().startswith("tb_") else "design")).lower()
            (tb_files if ftype == "simulation" else design_files).append(fname)

        if not design_cached:
            _COMPILED_DESIGN_SIG = None
            _COMPILED_TB_SIG = None
            h.reset_workspace()
            for f in files:
                fname = h._validated_filename(f.get("filename"), None)
                if not fname:
                    continue
                code = str(f.get("code") or "")
                h.write_source(fname, code)

            dep_ok, dep_errs, dep_warns, dep_infs, dep_log = h._prepare_dependencies(dependencies, std=std)
            log.extend(dep_log)
            if not dep_ok:
                return jsonify(ok=False, message="Component dependency analysis failed.",
                               errors=dep_errs, log=log, outputs={},
                               ghdl_version=h.ghdl_version()), 400

            if design_files:
                log.append(h.log_entry("cmd", f"$ ghdl -a --std={std} " +
                                     " ".join(f"workspace/{fn}" for fn in design_files)))
                rc, out, _ = h.run_ghdl(["-a", f"--std={std}"] + design_files)
                errors, warnings, infos = h.parse_ghdl_output(out)
                if rc != 0 or errors:
                    for e in errors:
                        log.append(h.log_entry("error", f"{e.get('file') or ''}:{e.get('line') or '?'}: {e.get('message') or ''}"))
                    return jsonify(ok=False, message="Design analysis failed.",
                                   errors=errors, log=log, outputs={},
                                   ghdl_version=h.ghdl_version()), 400
            _COMPILED_DESIGN_SIG = design_sig

        # --- generate & compile the board testbench ---------------------------
        tb_entity = "tb_board_" + re.sub(r"[^A-Za-z0-9_]", "_", entity)
        tb_code = generate_board_testbench(
            entity, ports, generics,
            inputs=inputs, clock_port=clock_port,
            clock_half_period_ns=float(clock_half),
        )
        tb_filename = tb_entity.lower() + ".vhd"

        tb_sig = (tb_entity, tb_code, std)
        tb_cached = design_cached and (_COMPILED_TB_SIG == tb_sig) and (h.WORKSPACE_DIR / tb_filename).is_file()

        if not tb_cached:
            _COMPILED_TB_SIG = None
            h.write_source(tb_filename, tb_code)
            log.append(h.log_entry("cmd", f"$ ghdl -a --std={std} workspace/{tb_filename}"))
            rc, out, _ = h.run_ghdl(["-a", f"--std={std}", tb_filename])
            errors, warnings, infos = h.parse_ghdl_output(out)
            if rc != 0 or errors:
                for e in errors:
                    log.append(h.log_entry("error", f"{e.get('file') or ''}:{e.get('line') or '?'}: {e.get('message') or ''}"))
                return jsonify(ok=False, message="Board testbench analysis failed.",
                               errors=errors, log=log, outputs={},
                               ghdl_version=h.ghdl_version()), 400

            log.append(h.log_entry("cmd", f"$ ghdl -e --std={std} {tb_entity}"))
            rc, out, _ = h.run_ghdl(["-e", f"--std={std}", tb_entity])
            errors, warnings, infos = h.parse_ghdl_output(out)
            if rc != 0 or errors:
                for e in errors:
                    log.append(h.log_entry("error", f"{e.get('file') or ''}:{e.get('line') or '?'}: {e.get('message') or ''}"))
                return jsonify(ok=False, message=f"Elaboration of '{tb_entity}' failed.",
                               errors=errors, log=log, outputs={},
                               ghdl_version=h.ghdl_version()), 400
            _COMPILED_TB_SIG = tb_sig

        log.append(h.log_entry("cmd",
                             f"$ ghdl -r --std={std} {tb_entity} --vcd=board.vcd --stop-time={stop_time}"))
        rc, out, _ = h.run_ghdl(["-r", f"--std={std}", tb_entity, "--vcd=board.vcd",
                               f"--stop-time={stop_time}"],
                              timeout=max(h.GHDL_TIMEOUT_S, 120))
        errors, warnings, infos = h.parse_ghdl_output(out)

        vcd_path = h.WORKSPACE_DIR / "board.vcd"
        if not vcd_path.is_file():
            # give students a clear hint when the design never produced an event
            return jsonify(ok=False, message="Board simulation produced no VCD file.",
                           errors=errors, log=log, outputs={},
                           ghdl_version=h.ghdl_version()), 400

        try:
            requested_cycles = int(batch_cycles) if batch_cycles is not None else (int(clock_cycles) if clock_cycles is not None else 1)
            finals, frames, period_start, period, end_ns = _vcd_timeline_frames(
                vcd_path, ports, clock_port=clock_port,
                clock_half_ns=float(clock_half),
                batch_cycles=requested_cycles
            )
            # Smart frame slicing: for periodic designs with trim_periodic=True,
            # only return the unique periodic loop frames (e.g. 16 frames instead of 2048)
            trim_periodic = bool(board_tb.get("trim_periodic", False) or data.get("trim_periodic", False))
            if trim_periodic and period and period > 0 and len(frames) > (period_start + period):
                frames = frames[:period_start + period]
        except Exception as exc:
            return jsonify(ok=False, message=f"VCD parsing failed: {exc}",
                           errors=errors, log=log, outputs={},
                           ghdl_version=h.ghdl_version()), 400

        # Build the outputs payload keyed by port name
        outputs: dict[str, dict] = {}
        for p in ports:
            pname = p["name"]
            if p["dir"] not in ("out", "buffer", "inout"):
                continue
            fin = finals.get(pname)
            if fin is None:
                msb = int(p.get("msb") or 0)
                lsb = int(p.get("lsb") or 0)
                width = abs(msb - lsb) + 1 if p.get("vector") else 1
                fin = {"width": width, "bits": "0" * width, "value": 0, "unknown": True}
            outputs[pname] = fin

        ok = rc == 0 and not errors
        log.append(h.log_entry("success" if ok else "error",
                             f"Board simulation finished ({stop_time}) — "
                             f"{len(outputs)} output port(s) captured." if ok else
                             "Board simulation stopped early — see errors."))
        return jsonify(ok=ok, message=None, errors=errors, warnings=warnings,
                       infos=infos, log=log, outputs=outputs, frames=frames,
                       period=period, period_start=period_start, entity=entity,
                       stop_time=stop_time, ghdl_version=h.ghdl_version(), end_time_ns=end_ns)


def _entities_in(code: str) -> list[str]:
    return re.findall(r"\bentity\s+([A-Za-z][A-Za-z0-9_]*)\s+is\b",
                      code or "", re.IGNORECASE)
