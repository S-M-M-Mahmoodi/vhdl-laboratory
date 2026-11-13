#!/usr/bin/env bash
# =====================================================================
#  VHDL Laboratory - One-Click Launcher (Linux / macOS)
# =====================================================================

set -e

# Resolve script directory (works regardless of current working directory)
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# 1. Locate Python 3
if command -v python3 >/dev/null 2>&1; then
    PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PY_CMD="python"
else
    echo ""
    echo "[ERROR] Python 3 is not found on PATH."
    echo "        Please install Python 3 (e.g. sudo apt install python3 python3-pip)."
    exit 1
fi

# 2. Check dependencies (Flask, vcdvcd)
if ! "$PY_CMD" -c "import flask, vcdvcd" >/dev/null 2>&1; then
    echo "[*] Installing required dependencies (Flask, vcdvcd)..."
    "$PY_CMD" -m pip install --quiet -r requirements.txt || {
        echo "[ERROR] Failed to install dependencies via pip."
        exit 1
    }
fi

# 3. Check GHDL
if ! command -v ghdl >/dev/null 2>&1; then
    echo ""
    echo "[WARNING] GHDL compiler not found on PATH."
    echo "          Please install GHDL:"
    echo "            - Ubuntu/Debian : sudo apt install ghdl"
    echo "            - Fedora/RHEL   : sudo dnf install ghdl"
    echo "            - Arch Linux    : sudo pacman -S ghdl"
    echo "            - macOS         : brew install ghdl"
    echo ""
fi

# 4. Launch web application
echo "Starting VHDL Laboratory server..."
exec "$PY_CMD" app.py "$@"
