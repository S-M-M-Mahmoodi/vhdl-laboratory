#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
test_suite.py -- End-to-end verification for Digital Systems Laboratory 2
=========================================================================
Copyright (c) 2026 S.M.M.Mahmoodi
Author & Lead Maintainer: S.M.M.Mahmoodi

Run from the project root (the folder containing app.py / index.html):

    python test_suite.py

The suite drives the real Flask application through its full HTTP stack
(Flask test client) with the real GHDL toolchain and verifies:

  T1  Check Syntax catches invalid VHDL and extracts the exact line number
  T2  Check Syntax passes a valid design (custom project filenames)
  T3  Simulate Behavioral Model produces a valid WaveDrom JSON (clock shape,
      bus transitions 0x00 -> 0x01 -> ... , reset clear, hex/dec labels,
      stop-time honored, workspace artifacts created)
  T4  Simulate with a broken design fails cleanly (parsed error, no VCD)
  T5  Simulate with a wrong testbench entity fails at elaboration
  T6  Invalid stop-time input is rejected
  T7  Back-to-back simulations are isolated (clean workspace each run)
  T8  Static UI is served (index.html, CodeMirror + WaveDrom assets) and
      private files (app.py, test_suite.py, workspace/) are NOT exposed
  T9  Project manager: save -> list -> load -> delete roundtrip
  T10 Check Syntax with target="tb" analyzes design + testbench together

Exit code 0 = all tests passed, 1 = failure, 2 = environment problem
(ghdl / flask / vcdvcd missing).
"""

import json
import os
import re
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_DIR))
PROJECTS_DIR = PROJECT_DIR / "projects"

GHDL_HINT = (
    "GHDL was not found on PATH. Install it first:\n"
    "  * Windows: download from https://github.com/ghdl/ghdl/releases\n"
    "    (ghdl-mcode-*-ucrt64.zip) and add its bin/ folder to PATH,\n"
    "    or install via MSYS2: pacman -S mingw-w64-ucrt-x86_64-ghdl-mcode\n"
    "  * Linux: apt/dnf install ghdl\n"
    "  * macOS: brew install ghdl\n"
    "Or point the GHDL_BIN environment variable at the ghdl executable."
)

DEFAULT_DESIGN = """library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity counter is
  generic (
    WIDTH : integer := 8
  );
  port (
    clk    : in  std_logic;
    rst    : in  std_logic;   -- synchronous, active-high reset
    enable : in  std_logic;   -- counting enable
    count  : out std_logic_vector(WIDTH - 1 downto 0)
  );
end entity counter;

architecture rtl of counter is
  signal cnt : unsigned(WIDTH - 1 downto 0) := (others => '0');
begin
  seq : process (clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        cnt <= (others => '0');
      elsif enable = '1' then
        cnt <= cnt + 1;
      end if;
    end if;
  end process seq;

  count <= std_logic_vector(cnt);
end architecture rtl;
"""

DEFAULT_TB = """library ieee;
use ieee.std_logic_1164.all;

entity tb_counter is
end entity tb_counter;

architecture sim of tb_counter is
  constant CLK_PERIOD : time := 10 ns;   -- 100 MHz clock

  signal clk    : std_logic := '0';
  signal rst    : std_logic := '1';
  signal enable : std_logic := '0';
  signal count  : std_logic_vector(7 downto 0) := (others => '0');
begin
  dut : entity work.counter
    generic map ( WIDTH => 8 )
    port map (
      clk    => clk,
      rst    => rst,
      enable => enable,
      count  => count
    );

  clk_gen : process
  begin
    loop
      clk <= '0';
      wait for CLK_PERIOD / 2;
      clk <= '1';
      wait for CLK_PERIOD / 2;
    end loop;
    wait;
  end process clk_gen;

  stim : process
  begin
    -- hold the synchronous reset across two rising edges
    wait for 20 ns;
    rst <= '0';

    -- keep the counter idle for two clocks
    wait for 20 ns;
    enable <= '1';                        -- start counting at t = 40 ns

    -- count up for 20 clocks (0x00 -> 0x14)
    wait for 200 ns;
    enable <= '0';                        -- pause at t = 240 ns

    wait for 50 ns;
    enable <= '1';                        -- resume at t = 290 ns

    -- count for 10 more clocks
    wait for 100 ns;
    rst <= '1';                           -- synchronous clear at t = 390 ns

    wait for 20 ns;
    rst <= '0';

    wait;                                 -- --stop-time ends the run
  end process stim;
end architecture sim;
"""

# broken design: undeclared identifier appended inside the architecture body
BAD_DESIGN = DEFAULT_DESIGN.replace(
    "  count <= std_logic_vector(cnt);",
    "  count <= std_logic_vector(cnt);\n  bad_signal <= '1';")
BAD_LINE = BAD_DESIGN.count("\n", 0, BAD_DESIGN.index("bad_signal")) + 1


# ---------------------------------------------------------------------------
# Test harness
# ---------------------------------------------------------------------------
RESULTS = []


def check(name):
    def deco(fn):
        RESULTS.append((name, fn))
        return fn
    return deco


# ---------------------------------------------------------------------------
# Build a fresh client + shared fixtures
# ---------------------------------------------------------------------------
def make_client():
    from app import app
    app.config["TESTING"] = True
    return app.test_client()


def sim_ok(client, design=DEFAULT_DESIGN, tb=DEFAULT_TB, entity="tb_counter",
           stop="1us", design_file="design.vhd", tb_file="tb_design.vhd"):
    resp = client.post("/simulate", json={
        "design_code": design, "tb_code": tb,
        "tb_entity": entity, "stop_time": stop,
        "design_filename": design_file, "tb_filename": tb_file})
    assert resp.status_code == 200, f"/simulate returned HTTP {resp.status_code}"
    return resp.get_json()


def find_signal(doc, frag):
    for row in doc["signal"]:
        if frag in row["name"]:
            return row
    raise AssertionError(f"signal containing {frag!r} not found in waveform")


# ---------------------------------------------------------------------------
# T1 / T2 : Check Syntax
# ---------------------------------------------------------------------------
@check("T1 check_syntax catches invalid VHDL with exact line number")
def t1(client):
    resp = client.post("/check_syntax", json={"design_code": BAD_DESIGN})
    assert resp.status_code == 200, f"HTTP {resp.status_code}"
    d = resp.get_json()
    assert d["ok"] is False, "invalid design must report ok=False"
    assert isinstance(d["errors"], list) and d["errors"], "no errors returned"
    e = d["errors"][0]
    assert e["line"] == BAD_LINE, \
        f"expected error line {BAD_LINE}, got {e['line']} ({e})"
    assert "bad_signal" in e["message"].lower(), f"message lost target: {e}"
    assert e["file"] == "design.vhd", f"file attribution wrong: {e}"
    # console log echoes the error text for the student
    log_text = json.dumps(d["log"])
    assert "design.vhd" in log_text and str(BAD_LINE) in log_text


@check("T2 check_syntax passes a valid design with custom filenames")
def t2(client):
    resp = client.post("/check_syntax", json={
        "design_code": DEFAULT_DESIGN,
        "design_filename": "counter8.vhd"})
    d = resp.get_json()
    assert resp.status_code == 200 and d["ok"] is True, d
    assert d["errors"] == [], d["errors"]
    assert any(e["level"] == "cmd" and "counter8.vhd" in e["text"] for e in d["log"]), \
        "console must show the ghdl -a command for the custom filename"


# ---------------------------------------------------------------------------
# T3 : Simulate Behavioral Model -> WaveDrom JSON
# ---------------------------------------------------------------------------
@check("T3 simulate produces valid, time-aligned WaveDrom transitions")
def t3(client):
    d = sim_ok(client, design=DEFAULT_DESIGN, tb=DEFAULT_TB, entity="tb_counter",
               stop="1us", design_file="counter8.vhd", tb_file="tb_counter8.vhd")
    assert d["ok"] is True, json.dumps({"errors": d.get("errors"),
                                        "log": d.get("log")}, indent=1)
    assert d["vcd_generated"] is True
    assert abs(d["end_time_ns"] - 1000.0) < 1e-6, d["end_time_ns"]
    assert d["div_ns"] == 5.0, d["div_ns"]          # GCD of all edges = 5 ns
    assert d["n_slots"] == 201, d["n_slots"]        # 200x5ns + stop-boundary slot

    wd = d["wavedrom"]
    assert "signal" in wd and len(wd["signal"]) >= 4

    clk = find_signal(wd, "clk")
    # clk starts at 0, toggles every 5 ns; GHDL dumps a final toggle exactly
    # at the --stop-time boundary (t=1000 ns) -> own trailing slot
    assert clk["wave"] == "01" * 100 + "0", \
        f"clock wave mismatch (first 20: {clk['wave'][:20]!r})"
    rst = find_signal(wd, "rst")
    assert rst["wave"][:5] == "1...0", rst["wave"][:10]   # reset released @20ns
    en = find_signal(wd, "enable")
    assert en["wave"][:9] == "0.......1", en["wave"][:12]  # enable @40ns

    cnt = find_signal(wd, "count")
    assert cnt["wave"].startswith("=") and "." in cnt["wave"]
    data = cnt["data"]
    assert data[0] == "0x00" and data[1] == "0x01" and data[2] == "0x02", data[:3]
    assert data.index("0x14") == 20, "0x14 expected after 20 increments"
    assert data.index("0x1E") == 30, "0x1E expected after resume block"
    assert data[31] == "0x00", "synchronous clear must return the bus to 0x00"
    assert len(data) == 91, f"unexpected transition count {len(data)}"

    dec = find_signal(d["wavedrom_dec"], "count")
    assert dec["data"][20] == "20" and dec["data"][31] == "0", \
        "dec labels must mirror the hex labels"

    # raw transition data for the JS waveform viewer
    raw = {s["name"]: s for s in d["raw"]}
    assert set(raw) == {"clk", "rst", "enable", "count[7:0]", "dut.cnt[7:0]"}, \
        sorted(raw)
    assert raw["clk"]["width"] == 1 and raw["count[7:0]"]["width"] == 8
    cnt_tv = raw["count[7:0]"]["tv"]
    # first count transition lands on the 3rd rising edge (t = 45 ns delta)
    assert cnt_tv[0] == [0.0, "00000000"], cnt_tv[:1]
    assert cnt_tv[1] == [45.0, "00000001"], cnt_tv[:2]
    assert raw["clk"]["tv"][1] == [5.0, "1"], raw["clk"]["tv"][:3]
    # raw times are strictly increasing and within the stop time
    for s in d["raw"]:
        ts = [t for t, _ in s["tv"]]
        assert ts == sorted(ts) and all(0 <= t <= 1000.0 for t in ts), s["name"]

    # every lane must share the same grid length
    waves = {len(row["wave"]) for row in wd["signal"]}
    assert waves == {201}, f"lane lengths differ: {waves}"

    # ISE-style process pipeline is visible in the console log
    log_text = json.dumps(d["log"])
    assert "ghdl -a" in log_text and "ghdl -e" in log_text \
        and "--vcd=wave.vcd" in log_text and "--stop-time=1us" in log_text

    # workspace scratchpad artifacts exist as promised
    ws = PROJECT_DIR / "workspace"
    for fname in ("counter8.vhd", "tb_counter8.vhd", "wave.vcd"):
        p = ws / fname
        assert p.exists() and p.stat().st_size > 0, f"{fname} missing in workspace"
    vcd = (ws / "wave.vcd").read_text(errors="replace")
    assert "$timescale" in vcd and "enddefinitions" in vcd


# ---------------------------------------------------------------------------
# T4/T5/T6 : failure paths
# ---------------------------------------------------------------------------
@check("T4 simulate with broken design fails cleanly without VCD")
def t4(client):
    d = sim_ok(client, design=BAD_DESIGN)
    assert d["ok"] is False
    assert d["vcd_generated"] is False
    assert d["errors"] and d["errors"][0]["line"] == BAD_LINE, d["errors"][:1]
    assert d.get("wavedrom") is None


@check("T5 simulate with unknown testbench entity fails at elaboration")
def t5(client):
    d = sim_ok(client, entity="tb_wrong")
    assert d["ok"] is False
    blob = json.dumps(d["errors"]).lower()
    assert "cannot find" in blob, blob


@check("T6 invalid stop time is rejected")
def t6(client):
    resp = client.post("/simulate", json={
        "design_code": DEFAULT_DESIGN, "tb_code": DEFAULT_TB,
        "tb_entity": "tb_counter", "stop_time": "banana"})
    assert resp.status_code == 400, resp.status_code
    d = resp.get_json()
    assert d["ok"] is False and "stop time" in d["message"].lower()


# ---------------------------------------------------------------------------
# T7/T8 : robustness & static serving
# ---------------------------------------------------------------------------
@check("T7 back-to-back simulations are isolated and reproducible")
def t7(client):
    first = sim_ok(client)
    second = sim_ok(client, stop="500ns")
    assert first["ok"] is True and second["ok"] is True
    assert second["end_time_ns"] == 500.0, second["end_time_ns"]
    third = sim_ok(client)                       # back to 1us still works
    assert third["ok"] is True and third["end_time_ns"] == 1000.0


@check("T8 UI + vendor assets served, private files not exposed")
def t8(client):
    r = client.get("/")
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    for needle in ("Digital Systems Laboratory 2", "New Project",
                   "Check Syntax", "Simulate Behavioral Model",
                   "assets/js/app.js", "assets/css/app.css",
                   "assets/js/waveviewer.js",
                   "assets/vendor/codemirror.min.js",
                   "assets/vendor/vhdl.min.js",
                   "id=\"vSplit\"", "id=\"btnWave\"", "id=\"waveModal\"",
                   "id=\"wvSavePng\"", "id=\"wvSaveSvg\"", "id=\"wvFormat\""):
        assert needle in html, f"index.html missing {needle!r}"
    # the retired side waveform pane and WaveDrom must be gone
    assert "wave_output0" not in html and "wavedrom.min.js" not in html \
        and "skin-default.js" not in html, "stale WaveDrom markup present"
    # ligature disabling is in the stylesheet (keeps <= as two characters)
    css = client.get("/assets/css/app.css").get_data(as_text=True)
    assert "font-variant-ligatures" in css, "ligature suppression missing"
    assert "font-feature-settings" in css, "font-feature-settings missing"
    for needle_css in (".vsplit", ".wv-window", ".wv-titlebar", ".wv-grip"):
        assert needle_css in css, f"app.css missing {needle_css!r}"
    js_wv = client.get("/assets/js/waveviewer.js").get_data(as_text=True)
    for fn in ("savePng", "saveSvg", "buildExportSvg", "wireInteractions",
               "AUTO_COLORS", "fmtValue"):
        assert fn in js_wv, f"waveviewer.js missing {fn!r}"
    assert "XHTML" not in js_wv
    assert "Xilinx ISE" not in html, "old branding still present"
    for asset, min_size in (
            ("assets/vendor/codemirror.min.js", 100_000),
            ("assets/vendor/vhdl.min.js", 1_000),
            ("assets/css/app.css", 10_000),
            ("assets/js/app.js", 10_000),
            ("assets/js/waveviewer.js", 10_000),
            ("assets/fonts/inter-400.woff2", 10_000),
            ("assets/fonts/jetbrains-mono-400.woff2", 10_000)):
        r = client.get("/" + asset)
        assert r.status_code == 200, f"{asset} not served"
        assert len(r.get_data()) >= min_size, f"{asset} suspiciously small"
    # removed vendor files must no longer be served
    assert client.get("/assets/vendor/wavedrom.min.js").status_code == 404
    assert client.get("/assets/vendor/skin-default.js").status_code == 404
    assert client.get("/app.py").status_code == 404
    assert client.get("/test_suite.py").status_code == 404
    assert client.get("/workspace/wave.vcd").status_code == 404
    assert client.get("/projects/x.json").status_code == 404
    h = client.get("/health").get_json()
    assert h["ok"] is True and h["ghdl_found"] is True
    assert h["app"] == "Digital Systems Laboratory 2"


# ---------------------------------------------------------------------------
# T9 / T10 : project manager & testbench syntax target
# ---------------------------------------------------------------------------
WIZARD_PROJECT = {
    "name": "reg4",
    "entity": "reg4",
    "architecture": "Behavioral",
    "ports": [
        {"name": "clk", "dir": "in", "vector": False, "msb": None, "lsb": None},
        {"name": "d", "dir": "in", "vector": True, "msb": 3, "lsb": 0},
        {"name": "q", "dir": "out", "vector": True, "msb": 3, "lsb": 0},
    ],
    "design_code": "library ieee;\nuse ieee.std_logic_1164.all;\n\n"
                   "entity reg4 is\n  port (\n"
                   "    clk : in  std_logic;\n"
                   "    d   : in  std_logic_vector(3 downto 0);\n"
                   "    q   : out std_logic_vector(3 downto 0)\n  );\n"
                   "end entity reg4;\n\n"
                   "architecture Behavioral of reg4 is\nbegin\n"
                   "  process (clk)\n  begin\n"
                   "    if rising_edge(clk) then\n      q <= d;\n    end if;\n"
                   "  end process;\n"
                   "end architecture Behavioral;\n",
    "tb_code": "library ieee;\nuse ieee.std_logic_1164.all;\n\n"
               "entity tb_reg4 is\nend entity tb_reg4;\n\n"
               "architecture sim of tb_reg4 is\n"
               "  signal clk : std_logic := '0';\n"
               "  signal d, q : std_logic_vector(3 downto 0) := (others => '0');\n"
               "begin\n"
               "  dut : entity work.reg4 port map (clk => clk, d => d, q => q);\n"
               "  clk_gen : process\n  begin\n"
               "    clk <= '0'; wait for 5 ns; clk <= '1'; wait for 5 ns;\n"
               "  end process;\n"
               "  stim : process\n  begin\n"
               "    d <= \"1010\"; wait for 20 ns;\n    d <= \"0110\"; wait;\n"
               "  end process;\n"
               "end architecture sim;\n",
    "design_ok": False,
    "tb_ok": False,
}


@check("T9 project manager save -> list -> load -> delete roundtrip")
def t9(client):
    # clean slate for this name
    client.post("/api/projects/delete", json={"name": "reg4"})

    r = client.post("/api/projects/save", json={"project": WIZARD_PROJECT})
    assert r.status_code == 200, r.status_code
    d = r.get_json()
    assert d["ok"] is True and d["saved"] == "reg4", d
    assert (PROJECTS_DIR / "reg4" / "project.json").exists() or (PROJECTS_DIR / "reg4.json").exists(), "project file not stored"

    r = client.get("/api/projects")
    names = [p["name"] for p in r.get_json()["projects"]]
    assert "reg4" in names, names
    entry = next(p for p in r.get_json()["projects"] if p["name"] == "reg4")
    assert entry["has_tb"] is True and entry["ports"] and len(entry["ports"]) == 3

    r = client.post("/api/projects/load", json={"name": "reg4"})
    d = r.get_json()
    assert d["ok"] is True, d
    p = d["project"]
    assert p["entity"] == "reg4" and p["architecture"] == "Behavioral"
    assert p["ports"][1]["msb"] == 3 and p["ports"][1]["lsb"] == 0
    assert "entity reg4 is" in p["design_code"]
    assert "tb_reg4" in p["tb_code"]

    # invalid payloads are rejected
    r = client.post("/api/projects/save",
                    json={"project": {"name": "bad name!", "entity": "x"}})
    assert r.status_code == 400, r.status_code
    r = client.post("/api/projects/load", json={"name": "missing_proj"})
    assert r.status_code == 404, r.status_code
    r = client.post("/api/projects/delete", json={"name": "missing_proj"})
    assert r.status_code == 404, r.status_code

    r = client.post("/api/projects/delete", json={"name": "reg4"})
    assert r.get_json()["ok"] is True
    assert not (PROJECTS_DIR / "reg4" / "project.json").exists() and not (PROJECTS_DIR / "reg4.json").exists()


@check("T10 check_syntax target=tb analyzes design + testbench together")
def t10(client):
    # design passes, tb passes -> ok, stage=tb
    r = client.post("/check_syntax", json={
        "target": "tb",
        "design_code": WIZARD_PROJECT["design_code"],
        "tb_code": WIZARD_PROJECT["tb_code"],
        "design_filename": "reg4.vhd",
        "tb_filename": "tb_reg4.vhd"})
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True, d
    assert d["stage"] == "tb", d.get("stage")
    log_text = json.dumps(d["log"])
    assert "reg4.vhd" in log_text and "tb_reg4.vhd" in log_text

    # broken tb -> fails at stage=tb with line number
    bad_tb = WIZARD_PROJECT["tb_code"].replace(
        "  stim : process",
        "  stim : process\n    broken_signal <= '1';")
    bad_line = bad_tb.count("\n", 0, bad_tb.index("broken_signal")) + 1
    r = client.post("/check_syntax", json={
        "target": "tb",
        "design_code": WIZARD_PROJECT["design_code"],
        "tb_code": bad_tb,
        "design_filename": "reg4.vhd",
        "tb_filename": "tb_reg4.vhd"})
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is False, d
    assert d["stage"] == "tb", d.get("stage")
    assert d["errors"] and d["errors"][0]["line"] == bad_line, d["errors"][:1]
    assert d["errors"][0]["file"] == "tb_reg4.vhd", d["errors"][0]

    # missing tb_code with target=tb -> rejected
    r = client.post("/check_syntax", json={
        "target": "tb", "design_code": WIZARD_PROJECT["design_code"]})
    assert r.status_code == 400, r.status_code

    # bad target -> rejected
    r = client.post("/check_syntax", json={
        "target": "banana", "design_code": DEFAULT_DESIGN})
    assert r.status_code == 400, r.status_code


@check("T11 structural VHDL compilation with component dependencies")
def test_11_structural_component_simulation(client):
    not_gate_code = """
library ieee;
use ieee.std_logic_1164.all;

entity not_gate is
  port (
    a : in  std_logic;
    y : out std_logic
  );
end entity not_gate;

architecture rtl of not_gate is
begin
  y <= not a;
end architecture rtl;
"""
    top_code = """
library ieee;
use ieee.std_logic_1164.all;

entity double_not is
  port (
    d_in  : in  std_logic;
    d_out : out std_logic
  );
end entity double_not;

architecture structural of double_not is
  component not_gate is
    port (
      a : in  std_logic;
      y : out std_logic
    );
  end component not_gate;

  signal mid : std_logic;
begin
  u1 : not_gate port map (a => d_in, y => mid);
  u2 : not_gate port map (a => mid, y => d_out);
end architecture structural;
"""
    tb_code = """
library ieee;
use ieee.std_logic_1164.all;

entity tb_double_not is
end entity tb_double_not;

architecture sim of tb_double_not is
  signal d_in  : std_logic := '0';
  signal d_out : std_logic;
begin
  dut : entity work.double_not
    port map (d_in => d_in, d_out => d_out);

  stim : process
  begin
    d_in <= '0';
    wait for 20 ns;
    d_in <= '1';
    wait for 20 ns;
    d_in <= '0';
    wait for 20 ns;
    wait;
  end process;
end architecture sim;
"""
    # 1. Test check_syntax with dependency
    r = client.post("/check_syntax", json={
        "target": "tb",
        "design_code": top_code,
        "tb_code": tb_code,
        "design_filename": "double_not.vhd",
        "tb_filename": "tb_double_not.vhd",
        "dependencies": [
            {"entity": "not_gate", "code": not_gate_code}
        ]
    })
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True, d

    # 2. Test simulate with dependency
    r = client.post("/simulate", json={
        "design_code": top_code,
        "tb_code": tb_code,
        "tb_entity": "tb_double_not",
        "design_filename": "double_not.vhd",
        "tb_filename": "tb_double_not.vhd",
        "stop_time": "100ns",
        "dependencies": [
            {"entity": "not_gate", "code": not_gate_code}
        ]
    })
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True, d
    assert d["vcd_generated"] is True
    assert "d_in" in d["signals"] and "d_out" in d["signals"]

    # 3. Test api/components endpoint
    r = client.get("/api/components")
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True
    assert "components" in d and isinstance(d["components"], list)


@check("T12 multi-file project navigator compilation & simulation")
def test_12_multifile_project_navigator(client):
    ha_code = """
library ieee;
use ieee.std_logic_1164.all;
entity half_adder is
  port (a, b : in std_logic; sum, carry : out std_logic);
end entity half_adder;
architecture rtl of half_adder is
begin
  sum <= a xor b;
  carry <= a and b;
end architecture rtl;
"""
    fa_code = """
library ieee;
use ieee.std_logic_1164.all;
entity full_adder is
  port (a, b, cin : in std_logic; sum, cout : out std_logic);
end entity full_adder;
architecture structural of full_adder is
  component half_adder is
    port (a, b : in std_logic; sum, carry : out std_logic);
  end component;
  signal s1, c1, c2 : std_logic;
begin
  ha1: half_adder port map (a => a, b => b, sum => s1, carry => c1);
  ha2: half_adder port map (a => s1, b => cin, sum => sum, carry => c2);
  cout <= c1 or c2;
end architecture structural;
"""
    tb_fa_code = """
library ieee;
use ieee.std_logic_1164.all;
entity tb_full_adder is
end entity tb_full_adder;
architecture sim of tb_full_adder is
  signal a, b, cin, sum, cout : std_logic := '0';
begin
  dut: entity work.full_adder port map (a => a, b => b, cin => cin, sum => sum, cout => cout);
  stim: process
  begin
    a <= '0'; b <= '0'; cin <= '0'; wait for 10 ns;
    a <= '1'; b <= '0'; cin <= '0'; wait for 10 ns;
    a <= '1'; b <= '1'; cin <= '0'; wait for 10 ns;
    a <= '1'; b <= '1'; cin <= '1'; wait for 10 ns;
    wait;
  end process;
end architecture sim;
"""
    project_payload = {
        "name": "AdderMultiFile",
        "top_entity": "full_adder",
        "active_tb": "tb_full_adder.vhd",
        "files": [
            {"filename": "half_adder.vhd", "entity": "half_adder", "type": "design", "code": ha_code},
            {"filename": "full_adder.vhd", "entity": "full_adder", "type": "design", "code": fa_code},
            {"filename": "tb_full_adder.vhd", "entity": "tb_full_adder", "type": "simulation", "code": tb_fa_code},
        ]
    }

    # 1. Save multi-file project
    r = client.post("/api/projects/save", json=project_payload)
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True, d

    # 2. Check syntax using multi-file payload
    r = client.post("/check_syntax", json={
        "files": project_payload["files"],
        "target": "tb",
        "top_entity": "full_adder",
        "active_tb": "tb_full_adder.vhd",
    })
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True, d

    # 3. Simulate multi-file project
    r = client.post("/simulate", json={
        "files": project_payload["files"],
        "top_entity": "full_adder",
        "tb_filename": "tb_full_adder.vhd",
        "tb_entity": "tb_full_adder",
        "stop_time": "50ns",
    })
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True, d
    assert d["vcd_generated"] is True
    assert "sum" in d["signals"] and "cout" in d["signals"]

    # 4. Clean up saved test project
    client.post("/api/projects/delete", json={"name": "AdderMultiFile"})


@check("T13 check_syntax handles projects with no active testbench gracefully")
def test_check_syntax_no_tb(client):
    r = client.post("/check_syntax", json={
        "files": [
            {"filename": "counter.vhd", "entity": "counter", "type": "design", "code": DEFAULT_DESIGN}
        ],
        "active_tb": "",
        "top_entity": "counter",
        "target": "design",
    })
    assert r.status_code == 200, f"Expected status 200, got {r.status_code}"
    assert "application/json" in r.content_type, f"Expected JSON, got {r.content_type}"
    d = r.get_json()
    assert d.get("ok") is True, f"Expected ok=True, got: {d}"
    assert d.get("errors") == [], f"Expected no errors, got: {d.get('errors')}"


@check("T14 simulate without testbench returns clean JSON error (no HTTP 500)")
def test_simulate_no_tb(client):
    r = client.post("/simulate", json={
        "files": [
            {"filename": "counter.vhd", "entity": "counter", "type": "design", "code": DEFAULT_DESIGN}
        ],
        "active_tb": "",
        "top_entity": "counter",
        "stop_time": "1us",
    })
    assert r.status_code == 200, f"Expected status 200, got {r.status_code}"
    assert "application/json" in r.content_type, f"Expected JSON, got {r.content_type}"
    d = r.get_json()
    assert d.get("ok") is False, f"Expected ok=False, got: {d}"
    assert "No simulation testbench specified" in d.get("message", ""), f"Unexpected message: {d.get('message')}"


@check("T15 directory-based project saves individual on-disk .vhd files & project.json")
def test_directory_project_lifecycle(client):
    folder_name = "lab_counter_test"
    project_payload = {
        "name": "LabCounter",
        "folder": folder_name,
        "standard": "08",
        "author": "Dr. Engineer",
        "created": "2026-11-06",
        "top_entity": "counter",
        "active_tb": "tb_counter.vhd",
        "files": [
            {"filename": "counter.vhd", "entity": "counter", "type": "design", "code": DEFAULT_DESIGN},
            {"filename": "tb_counter.vhd", "entity": "tb_counter", "type": "simulation", "code": DEFAULT_TB},
        ]
    }

    # 1. Save project
    r = client.post("/api/projects/save", json={"project": project_payload})
    assert r.status_code == 200 and r.get_json()["ok"] is True, r.get_json()

    # 2. Verify on-disk directory and individual files exist
    target_dir = PROJECTS_DIR / folder_name
    assert target_dir.is_dir(), f"Project folder {target_dir} was not created on disk"
    assert (target_dir / "counter.vhd").is_file(), "counter.vhd not found in project folder"
    assert (target_dir / "tb_counter.vhd").is_file(), "tb_counter.vhd not found in project folder"
    assert (target_dir / "project.json").is_file(), "project.json not found in project folder"

    # Verify on-disk content matches
    with open(target_dir / "counter.vhd", "r", encoding="utf-8") as f:
        disk_code = f.read()
    assert "entity counter is" in disk_code

    # 3. List projects - should report folder, standard, author, and created
    r = client.get("/api/projects/list")
    assert r.status_code == 200
    listed = [p for p in r.get_json()["projects"] if p["name"] == "LabCounter"]
    assert listed, "Project not returned in /api/projects/list"
    p_info = listed[0]
    assert p_info.get("folder") == folder_name
    assert p_info.get("standard") == "08"
    assert p_info.get("author") == "Dr. Engineer"

    # 4. Load project - should read code directly from the on-disk files
    r = client.post("/api/projects/load", json={"name": folder_name})
    assert r.status_code == 200 and r.get_json()["ok"] is True, r.get_json()
    loaded = r.get_json()["project"]
    assert loaded["name"] == "LabCounter"
    assert loaded["folder"] == folder_name
    assert loaded["standard"] == "08"
    assert loaded["author"] == "Dr. Engineer"
    assert len(loaded["files"]) == 2
    f_counter = next(f for f in loaded["files"] if f["filename"] == "counter.vhd")
    assert "entity counter is" in f_counter["code"]

    # 5. Delete project - directory must be cleanly removed
    r = client.post("/api/projects/delete", json={"name": folder_name})
    assert r.status_code == 200 and r.get_json()["ok"] is True, r.get_json()
    assert not target_dir.exists(), f"Project directory {target_dir} was not deleted"


@check("T16 VHDL standard flag (--std=08 vs --std=93c) passed correctly to GHDL")
def test_vhdl_standard_flag(client):
    # VHDL-2008 syntax: 'process(all)' is only valid in VHDL-2008 (--std=08).
    # In VHDL-93 (--std=93c), it must be rejected as a syntax error.
    vhdl2008_code = """library ieee;
use ieee.std_logic_1164.all;

entity comb_logic is
  port (
    a : in  std_logic;
    b : in  std_logic;
    y : out std_logic
  );
end entity comb_logic;

architecture rtl of comb_logic is
begin
  process(all)
  begin
    y <= a and b;
  end process;
end architecture rtl;
"""
    # 1. Under standard VHDL-2008: must PASS
    r = client.post("/check_syntax", json={
        "files": [{"filename": "comb_logic.vhd", "entity": "comb_logic", "type": "design", "code": vhdl2008_code}],
        "top_entity": "comb_logic",
        "standard": "08",
        "target": "design",
    })
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is True, f"VHDL-2008 process(all) failed in --std=08: {d}"

    # 2. Under standard VHDL-93: must FAIL due to process(all)
    r = client.post("/check_syntax", json={
        "files": [{"filename": "comb_logic.vhd", "entity": "comb_logic", "type": "design", "code": vhdl2008_code}],
        "top_entity": "comb_logic",
        "standard": "93c",
        "target": "design",
    })
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] is False, f"VHDL-93 should reject process(all), but passed: {d}"
    assert any("all" in (e.get("message", "").lower() + e.get("text", "").lower()) or e.get("line") for e in d.get("errors", []) + d.get("log", [])), \
        "Expected error mentioning invalid syntax in VHDL-93"


@check("T17 /api/components categorizes modules by project & supports multiple files")
def test_components_by_project(client):
    proj_name = "MultiAdderLab"
    folder_name = "multi_adder_lab"
    ha_code = "library ieee; use ieee.std_logic_1164.all; entity ha_sub is port(a, b: in std_logic; s, c: out std_logic); end; architecture rtl of ha_sub is begin s <= a xor b; c <= a and b; end;"
    fa_code = "library ieee; use ieee.std_logic_1164.all; entity fa_sub is port(a, b, cin: in std_logic; s, cout: out std_logic); end; architecture rtl of fa_sub is begin s <= a xor b xor cin; cout <= (a and b) or (cin and (a xor b)); end;"

    payload = {
        "name": proj_name,
        "folder": folder_name,
        "standard": "08",
        "top_entity": "fa_sub",
        "files": [
            {"filename": "ha_sub.vhd", "entity": "ha_sub", "type": "design", "code": ha_code},
            {"filename": "fa_sub.vhd", "entity": "fa_sub", "type": "design", "code": fa_code},
        ]
    }
    client.post("/api/projects/save", json={"project": payload})

    # Query components
    r = client.get("/api/components")
    assert r.status_code == 200, f"HTTP {r.status_code}"
    comps = r.get_json().get("components", [])
    lab_comps = [c for c in comps if c.get("project_name") == proj_name or c.get("project_folder") == folder_name]
    assert len(lab_comps) >= 2, f"Expected both ha_sub and fa_sub in components, found: {lab_comps}"

    entities = {c["entity"] for c in lab_comps}
    assert "ha_sub" in entities and "fa_sub" in entities, f"Missing entities: {entities}"
    for c in lab_comps:
        assert c.get("project_name") == proj_name
        assert c.get("project_folder") == folder_name
        assert "declaration" in c.get("snippets", {})
        assert "instantiation" in c.get("snippets", {})

    # Clean up
    client.post("/api/projects/delete", json={"name": folder_name})


@check("T18 /api/projects/export_rar saves to custom path & downloads valid RAR archive")
def test_export_rar_archive(client):
    import tempfile
    proj_name = "RarExportTest"
    folder_name = "rar_export_test"
    payload = {
        "name": proj_name,
        "folder": folder_name,
        "standard": "08",
        "author": "Archiver Test",
        "top_entity": "counter",
        "files": [
            {"filename": "counter.vhd", "entity": "counter", "type": "design", "code": DEFAULT_DESIGN},
            {"filename": "tb_counter.vhd", "entity": "tb_counter", "type": "simulation", "code": DEFAULT_TB},
        ]
    }
    client.post("/api/projects/save", json={"project": payload})

    with tempfile.TemporaryDirectory() as tmp_dir:
        custom_rar_target = Path(tmp_dir) / "CustomDestination" / "LabProject.rar"

        # 1. Direct save to custom disk path
        r1 = client.post("/api/projects/export_rar", json={
            "project": payload,
            "target_path": str(custom_rar_target)
        })
        assert r1.status_code == 200, f"Export to disk failed: {r1.get_json()}"
        d1 = r1.get_json()
        assert d1["ok"] is True
        assert custom_rar_target.is_file(), f"Target file {custom_rar_target} not created"
        assert custom_rar_target.stat().st_size > 0

        # Verify RAR magic signature (RAR 5: 0x52 0x61 0x72 0x21 0x1A 0x07 0x01 0x00)
        rar_header = custom_rar_target.read_bytes()[:7]
        assert rar_header.startswith(b"Rar!\x1a\x07"), f"Invalid RAR header: {rar_header}"

        # 2. Browser stream download
        r2 = client.post("/api/projects/export_rar", json={
            "project": payload
        })
        assert r2.status_code == 200, f"Download failed: {r2.status_code}"
        assert "application/x-rar-compressed" in r2.content_type
        assert r2.data.startswith(b"Rar!\x1a\x07"), "Downloaded bytes do not have RAR header"

    # Clean up
    client.post("/api/projects/delete", json={"name": folder_name})


@check("T19 GHDL report note/warning parsed into infos/warnings (not errors)")
def t19(client):
    tb_report_code = (
        "library ieee;\n"
        "use ieee.std_logic_1164.all;\n\n"
        "entity tb_rep is\n"
        "end entity tb_rep;\n\n"
        "architecture sim of tb_rep is\n"
        "  signal s : std_logic := '0';\n"
        "begin\n"
        "  process\n"
        "  begin\n"
        "    report \"HELLO NOTE FROM REPORT\";\n"
        "    report \"A MINOR WARNING\" severity warning;\n"
        "    s <= '1';\n"
        "    wait for 10 ns;\n"
        "    s <= '0';\n"
        "    wait for 10 ns;\n"
        "    wait;\n"
        "  end process;\n"
        "end architecture sim;\n"
    )
    r = client.post("/simulate", json={
        "files": [
            {"filename": "tb_rep.vhd", "entity": "tb_rep", "type": "simulation", "code": tb_report_code}
        ],
        "active_tb": "tb_rep.vhd",
        "stop_time": "20ns"
    })
    assert r.status_code == 200, r.get_data(as_text=True)
    d = r.get_json()
    assert d["ok"] is True, f"Simulation should succeed, got {d}"
    assert len(d["errors"]) == 0, f"Expected 0 errors, got: {d['errors']}"
    info_msgs = [i["message"] for i in d.get("infos", [])]
    assert any("HELLO NOTE FROM REPORT" in m for m in info_msgs), f"Missing report note in infos: {info_msgs}"
    warn_msgs = [w["message"] for w in d.get("warnings", [])]
    assert any("A MINOR WARNING" in m for m in warn_msgs), f"Missing warning in warnings: {warn_msgs}"


@check("T20 Multi-file simulation validates tb_entity against IDENT_RE")
def t20(client):
    r = client.post("/simulate", json={
        "files": [
            {"filename": "tb_bad.vhd", "entity": "tb_bad", "type": "simulation", "code": "-- empty"}
        ],
        "tb_entity": "invalid entity with spaces!",
        "stop_time": "20ns"
    })
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    d = r.get_json()
    assert d["ok"] is False
    assert "Invalid testbench entity name" in d["message"]


@check("T21 Component dependency resolution handles folder projects without design_code")
def t21(client):
    client.post("/api/projects/delete", json={"name": "my_sub"})
    client.post("/api/projects/delete", json={"name": "my_top"})

    sub_code = (
        "library ieee;\n"
        "use ieee.std_logic_1164.all;\n\n"
        "entity my_sub is\n"
        "  port ( a : in std_logic; b : out std_logic );\n"
        "end entity my_sub;\n\n"
        "architecture Behavioral of my_sub is\n"
        "begin\n"
        "  b <= not a;\n"
        "end architecture Behavioral;\n"
    )

    r_save = client.post("/api/projects/save", json={
        "project": {
            "name": "my_sub",
            "folder": "my_sub",
            "entity": "my_sub",
            "standard": "08",
            "files": [
                {"filename": "my_sub.vhd", "entity": "my_sub", "type": "design", "code": sub_code}
            ]
        }
    })
    assert r_save.status_code == 200

    top_code = (
        "library ieee;\n"
        "use ieee.std_logic_1164.all;\n\n"
        "entity my_top is\n"
        "  port ( x : in std_logic; y : out std_logic );\n"
        "end entity my_top;\n\n"
        "architecture Structural of my_top is\n"
        "  component my_sub is\n"
        "    port ( a : in std_logic; b : out std_logic );\n"
        "  end component;\n"
        "begin\n"
        "  u1 : my_sub port map ( a => x, b => y );\n"
        "end architecture Structural;\n"
    )

    r_check = client.post("/check_syntax", json={
        "files": [
            {"filename": "my_top.vhd", "entity": "my_top", "type": "design", "code": top_code}
        ],
        "dependencies": ["my_sub"]
    })
    assert r_check.status_code == 200, r_check.get_data(as_text=True)
    d_check = r_check.get_json()
    assert d_check["ok"] is True, f"Check syntax failed: {d_check}"
    assert len(d_check["errors"]) == 0

    client.post("/api/projects/delete", json={"name": "my_sub"})
    client.post("/api/projects/delete", json={"name": "my_top"})


@check("T22 Thread-safe simulation & check_syntax via SIM_LOCK")
def t22(client):
    import concurrent.futures

    tb_code = (
        "library ieee;\n"
        "use ieee.std_logic_1164.all;\n\n"
        "entity tb_lock is\n"
        "  port ( clk : out std_logic );\n"
        "end entity tb_lock;\n\n"
        "architecture sim of tb_lock is\n"
        "begin\n"
        "  process\n"
        "  begin\n"
        "    clk <= '0'; wait for 5 ns;\n"
        "    clk <= '1'; wait for 5 ns;\n"
        "  end process;\n"
        "end architecture sim;\n"
    )

    def run_sim():
        return client.post("/simulate", json={
            "files": [
                {"filename": "tb_lock.vhd", "entity": "tb_lock", "type": "simulation", "code": tb_code}
            ],
            "active_tb": "tb_lock.vhd",
            "stop_time": "20ns"
        })

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(run_sim) for _ in range(3)]
        results = [f.result() for f in futures]

    for r in results:
        assert r.status_code == 200
        d = r.get_json()
        assert d["ok"] is True


@check("T23 Advanced waveform viewer features (snap, stats, CSV, maximize, persistence)")
def t23(client):
    html = client.get("/").get_data(as_text=True)
    assert 'id="wvMax"' in html, "HTML missing #wvMax maximize button"
    assert 'id="wvSnap"' in html, "HTML missing #wvSnap snap toggle button"
    assert 'id="wvStats"' in html, "HTML missing #wvStats timing stats button"
    assert 'id="wvSaveCsv"' in html, "HTML missing #wvSaveCsv CSV export button"
    assert 'id="wvStatsPanel"' in html, "HTML missing #wvStatsPanel drawer"
    assert 'id="wvStatsTbody"' in html, "HTML missing #wvStatsTbody table"
    assert 'id="wvCopyStats"' in html, "HTML missing #wvCopyStats clipboard button"

    css = client.get("/assets/css/app.css").get_data(as_text=True)
    assert ".wv-stats-panel" in css, "app.css missing .wv-stats-panel"
    assert ".wv-stats-table" in css, "app.css missing .wv-stats-table"
    assert ".wv-name.dragging" in css, "app.css missing .wv-name.dragging"
    assert ".wv-btn.active" in css, "app.css missing .wv-btn.active"

    js = client.get("/assets/js/waveviewer.js").get_data(as_text=True)
    for fn in ("snapToNearestEdge", "computeSignalStats", "updateStatsPanel",
               "copyStatsText", "exportCsv", "toggleMaximize",
               "saveSignalPrefs", "saveSignalOrder"):
        assert fn in js, f"waveviewer.js missing {fn!r}"

    # Verify simulation duration extends to full testbench stimulus duration (100ns)
    resp = client.post("/simulate", json={
        "files": [
            {"filename": "adder.vhd", "code": Path("projects/adder/adder.vhd").read_text()},
            {"filename": "tb_adder.vhd", "code": Path("projects/adder/tb_adder.vhd").read_text()},
        ],
        "active_tb": "tb_adder.vhd",
        "stop_time": "1us",
    })
    d = resp.get_json()
    assert d["ok"] is True
    assert d["end_time_ns"] == 100.0, f"Expected 100.0 ns but got {d.get('end_time_ns')}"
    for sig in d.get("raw", []):
        assert sig["tv"][-1][0] == 100.0, f"Signal {sig['name']} last timestamp {sig['tv'][-1][0]} != 100.0"


@check("T24 Desktop EDA Menubar & Quick-Access Toolbar")
def t24(client):
    html = client.get("/").get_data(as_text=True)
    assert 'class="topbar eda-header"' in html, "HTML missing eda-header"
    assert 'class="eda-menubar"' in html, "HTML missing eda-menubar"
    assert 'class="eda-toolbar"' in html, "HTML missing eda-toolbar"
    for menu in ("menuFile", "menuEdit", "menuView", "menuProject", "menuSim", "menuHelp"):
        assert f'id="{menu}"' in html, f"HTML missing menu {menu!r}"
    for btn_id in ("btnBack", "btnSave", "btnToolbarAddSource", "btnComponents", "btnCheck", "btnSim", "btnWave"):
        assert f'id="{btn_id}"' in html, f"HTML missing toolbar button {btn_id!r}"
    assert 'id="mHelpGuide"' in html, "HTML missing mHelpGuide"
    assert 'id="btnWelcomeGuide"' in html, "HTML missing btnWelcomeGuide"

    css = client.get("/assets/css/app.css").get_data(as_text=True)
    assert ".eda-header" in css, "app.css missing .eda-header"
    assert ".eda-menubar" in css, "app.css missing .eda-menubar"
    assert ".eda-toolbar" in css, "app.css missing .eda-toolbar"

    js = client.get("/assets/js/app.js").get_data(as_text=True)
    assert "wireEdaMenubar" in js, "app.js missing wireEdaMenubar"


@check("T25 VHDL Laboratory branding, Light/Monokai/Solarized themes, templates modal & status display")
def t25(client):
    html = client.get("/").get_data(as_text=True)

    # 1. Branding: VHDL Laboratory present in title and brand elements
    assert "VHDL Laboratory" in html, "index.html missing 'VHDL Laboratory' branding"
    assert '<span class="brand-title">VHDL Laboratory</span>' in html, "brand-title missing 'VHDL Laboratory'"

    # 2. Themes in View menu
    for theme_id in ("mThemeDark", "mThemeOneDark", "mThemeCyberpunk", "mThemeLight", "mThemeMonokai", "mThemeSolarizedDark", "mThemeSolarizedLight"):
        assert f'id="{theme_id}"' in html, f"HTML missing theme button {theme_id!r}"

    # 3. Clean editor tab bar (no redundant buttons crammed in editor bar)
    assert '<div class="editor-tab-actions">' in html, "HTML missing editor-tab-actions"
    assert 'id="fontDec"' in html and 'id="fontInc"' in html, "HTML missing font size buttons"
    assert '<select id="selTheme"' not in html, "Stale selTheme still present in editor tabs"
    assert '<select id="selSnippet"' not in html, "Stale selSnippet still present in editor tabs"

    # 4. Template Picker Modal
    assert 'id="templateModal"' in html, "HTML missing templateModal"
    assert 'id="mEditTemplate"' in html, "HTML missing mEditTemplate"
    assert 'id="templateInsert"' in html, "HTML missing templateInsert button"

    # 5. Status indicator display
    assert 'id="statusIndicator"' in html, "HTML missing statusIndicator"

    # 6. CSS theme support
    css = client.get("/assets/css/app.css").get_data(as_text=True)
    assert "body.theme-onedark" in css, "app.css missing body.theme-onedark"
    assert "body.theme-cyberpunk" in css, "app.css missing body.theme-cyberpunk"
    assert "body.theme-light" in css, "app.css missing body.theme-light"
    assert "body.theme-monokai" in css, "app.css missing body.theme-monokai"
    assert "body.theme-solarized-dark" in css, "app.css missing body.theme-solarized-dark"
    assert "body.theme-solarized-light" in css, "app.css missing body.theme-solarized-light"
    assert ".template-modal" in css, "app.css missing .template-modal"
    assert ".editor-tab-actions" in css, "app.css missing .editor-tab-actions"

    # 7. JS template & theme logic
    js = client.get("/assets/js/app.js").get_data(as_text=True)
    assert "openTemplateModal" in js, "app.js missing openTemplateModal"
    assert "TEMPLATE_METADATA" in js, "app.js missing TEMPLATE_METADATA"
    assert 'switchGuideTab("guideShortcuts")' in js, "app.js missing shortcut tab switch"

    # 8. Testbench duration parser supports 'after' clauses & concurrent stimulus
    from app import estimate_testbench_duration_fs
    # Test concurrent after clause (s <= '1' after 30 ns;)
    dur_fs, has_clk = estimate_testbench_duration_fs("s <= '1' after 30 ns;")
    assert dur_fs == 30_000_000, f"Expected 30000000 fs, got {dur_fs}"
    assert has_clk is False, "Expected has_clk to be False for single delayed assignment"

    # Test concurrent clock loop (clk <= not clk after 10 ns;)
    dur_fs, has_clk = estimate_testbench_duration_fs("clk <= not clk after 10 ns;")
    assert has_clk is True, "Expected has_clk to be True for self-referential clock"

    # Test sequential process with wait; and after delay
    proc_tb = "process begin s <= '1' after 25 ns; wait; end process;"
    dur_fs, has_clk = estimate_testbench_duration_fs(proc_tb)
    assert dur_fs == 25_000_000, f"Expected 25000000 fs, got {dur_fs}"
    assert has_clk is False

    # Test end-to-end simulation with concurrent after 30 ns stimulus
    concurrent_tb = """
library ieee;
use ieee.std_logic_1164.all;
entity tb_after is end entity;
architecture sim of tb_after is
    signal sig : std_logic := '0';
begin
    sig <= '1' after 30 ns;
end architecture;
"""
    resp = client.post("/simulate", json={
        "files": [
            {"filename": "tb_after.vhd", "code": concurrent_tb}
        ],
        "active_tb": "tb_after.vhd",
        "stop_time": "1us"
    })
    d = resp.get_json()
    assert d["ok"] is True
    assert d["end_time_ns"] == 30.0, f"Expected 30.0 ns, got {d.get('end_time_ns')}"


@check("T26 In-App Update Patch system, safety guards & instructor packager")
def t26(client):
    import io
    import zipfile
    import shutil

    # 1. UI elements check
    html = client.get("/").get_data(as_text=True)
    assert 'id="mHelpUpdate"' in html, "HTML missing mHelpUpdate in Help menu"
    assert 'id="btnWelcomeUpdate"' in html, "HTML missing btnWelcomeUpdate"
    assert 'id="updateModal"' in html, "HTML missing updateModal"
    assert 'id="updateDropzone"' in html, "HTML missing updateDropzone"
    assert 'id="btnApplyUpdate"' in html, "HTML missing btnApplyUpdate"

    css = client.get("/assets/css/app.css").get_data(as_text=True)
    assert ".update-dropzone" in css, "app.css missing .update-dropzone"
    assert ".update-notice" in css, "app.css missing .update-notice"

    js = client.get("/assets/js/app.js").get_data(as_text=True)
    assert "openUpdateModal" in js, "app.js missing openUpdateModal"
    assert "applyUpdatePatch" in js, "app.js missing applyUpdatePatch"

    # 2. Version endpoint
    ver = client.get("/api/version").get_json()
    assert ver["app"] == "VHDL Laboratory"
    assert "version" in ver
    assert "boot_id" in ver
    h = client.get("/health").get_json()
    assert h["boot_id"] == ver["boot_id"]

    # 3. Missing file / bad requests
    r = client.post("/api/system/update")
    assert r.status_code == 400

    r = client.post("/api/system/update", data={"patch_file": (io.BytesIO(b"not a zip"), "patch.txt")})
    assert r.status_code == 400

    # 4. Zip Slip security guard
    slip_buf = io.BytesIO()
    with zipfile.ZipFile(slip_buf, "w") as zf:
        zf.writestr("../../escape.txt", "malicious payload")
    slip_buf.seek(0)
    r = client.post("/api/system/update", data={"patch_file": (slip_buf, "slip.zip")})
    assert r.status_code == 400
    assert "Illegal file path" in r.get_json()["message"]

    # 5. Protected directories guard (projects/ cannot be overwritten)
    fake_project_file = PROJECT_DIR / "projects" / "protected_test.vhd"
    fake_project_file.parent.mkdir(parents=True, exist_ok=True)
    fake_project_file.write_text("original content")

    protect_buf = io.BytesIO()
    with zipfile.ZipFile(protect_buf, "w") as zf:
        zf.writestr("projects/protected_test.vhd", "overwritten content")
        zf.writestr("test_dummy.txt", "valid content")
    protect_buf.seek(0)
    r = client.post("/api/system/update", data={"patch_file": (protect_buf, "patch.zip")})
    assert r.status_code == 200
    d = r.get_json()
    assert d["ok"] is True
    # Verify protected file remained intact!
    assert fake_project_file.read_text() == "original content"
    assert "test_dummy.txt" in d["updated_files"]

    # Clean up test artifacts
    dummy_file = PROJECT_DIR / "test_dummy.txt"
    if dummy_file.exists():
        dummy_file.unlink()
    if fake_project_file.exists():
        fake_project_file.unlink()


@check("T27 IEEE-1364 VCD trace download endpoint & GTKWave integration")
def t27(client):
    # 1. UI element checks
    html = client.get("/").get_data(as_text=True)
    assert 'id="mSimVcd"' in html, "HTML missing mSimVcd in Simulation menu"
    assert 'id="wvSaveVcd"' in html, "HTML missing wvSaveVcd in Waveform toolbar"

    js = client.get("/assets/js/waveviewer.js").get_data(as_text=True)
    assert "downloadVcd" in js, "waveviewer.js missing downloadVcd"

    # 2. Endpoint behavior: when workspace/wave.vcd does not exist
    vcd_path = PROJECT_DIR / "workspace" / "wave.vcd"
    if vcd_path.exists():
        vcd_path.unlink()
    r = client.get("/api/simulation/vcd")
    assert r.status_code == 404
    data = r.get_json()
    assert data["ok"] is False
    assert "No simulation VCD available" in data["message"]

    # 3. Simulate design and verify VCD export
    d = sim_ok(client, design=DEFAULT_DESIGN, tb=DEFAULT_TB, entity="tb_counter", stop="1us")
    assert d["ok"] is True
    assert vcd_path.is_file() and vcd_path.stat().st_size > 0

    # 4. GET /api/simulation/vcd with default and custom name
    r_vcd = client.get("/api/simulation/vcd")
    assert r_vcd.status_code == 200
    assert "attachment; filename=wave.vcd" in r_vcd.headers.get("Content-Disposition", "")
    assert "$timescale" in r_vcd.get_data(as_text=True)

    r_vcd_named = client.get("/api/simulation/vcd?name=tb_counter.vcd")
    assert r_vcd_named.status_code == 200
    assert "attachment; filename=tb_counter.vcd" in r_vcd_named.headers.get("Content-Disposition", "")

    # 5. Security check: direct access to /workspace/wave.vcd must return 404 (T8 protection)
    r_sec = client.get("/workspace/wave.vcd")
    assert r_sec.status_code == 404


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def preflight():
    problems = []
    try:
        import flask  # noqa: F401
    except ImportError:
        problems.append("flask is not installed ->  pip install flask")
    try:
        import vcdvcd  # noqa: F401
    except ImportError:
        problems.append("vcdvcd is not installed ->  pip install vcdvcd")
    import shutil
    if os.environ.get("GHDL_BIN"):
        if not Path(os.environ["GHDL_BIN"]).exists():
            problems.append(f"GHDL_BIN={os.environ['GHDL_BIN']} does not exist")
    elif shutil.which("ghdl") is None:
        bundled = PROJECT_DIR / "ghdl-mcode-6.0.0-ucrt64" / "bin" / "ghdl.exe"
        if bundled.is_file():
            os.environ["GHDL_BIN"] = str(bundled)
            bin_dir = str(bundled.parent)
            if bin_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = f"{bin_dir};{os.environ.get('PATH', '')}"
        else:
            problems.append(GHDL_HINT)
    return problems


def main():
    print("=" * 72)
    print(" Digital Systems Laboratory 2 -- end-to-end test suite")
    print(f" project root : {PROJECT_DIR}")
    print("=" * 72)

    problems = preflight()
    if problems:
        print("\nENVIRONMENT PROBLEMS:")
        for p in problems:
            print("  -", p)
        return 2

    client = make_client()
    failed = []
    for name, fn in RESULTS:
        try:
            fn(client)
            print(f"  [PASS] {name}")
        except AssertionError as exc:
            import traceback
            failed.append(name)
            print(f"  [FAIL] {name}\n         {exc}")
            traceback.print_exc()
        except Exception as exc:                     # noqa: BLE001
            failed.append(name)
            print(f"  [FAIL] {name}\n         unexpected {type(exc).__name__}: {exc}")

    total, passed = len(RESULTS), len(RESULTS) - len(failed)
    print("-" * 72)
    print(f" RESULT: {passed}/{total} tests passed" + (" -- 100% VERIFIED"
          if not failed else ""))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
