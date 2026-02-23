#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
PYTHON="$VENV_DIR/bin/python3"
PIP="$VENV_DIR/bin/pip"
LOG="$SCRIPT_DIR/midi_recorder_stderr.log"

cd "$SCRIPT_DIR"

# Create venv if missing
if [ ! -f "$PYTHON" ]; then
    echo "$(date): venv missing — creating and installing dependencies..." >> "$LOG"
    python3 -m venv "$VENV_DIR"
    "$PIP" install --upgrade pip >> "$LOG" 2>&1
    "$PIP" install -r requirements.txt >> "$LOG" 2>&1
fi

# Validate that critical native libs can actually load
if ! "$PYTHON" -c "import rtmidi" 2>/dev/null; then
    echo "$(date): rtmidi import failed — reinstalling dependencies..." >> "$LOG"
    "$PIP" install --force-reinstall python-rtmidi mido >> "$LOG" 2>&1

    if ! "$PYTHON" -c "import rtmidi" 2>/dev/null; then
        echo "$(date): rtmidi still broken after reinstall. Sleeping 60s to avoid crash loop." >> "$LOG"
        sleep 60
        exit 1
    fi
    echo "$(date): rtmidi reinstalled successfully." >> "$LOG"
fi

exec "$PYTHON" auto_midi_recorder.py
