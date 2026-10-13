#!/usr/bin/env python3
"""Stable School authoring command entry."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).resolve().parents[2] / "__app_modules/school/cli/scripts/bfn-author-preflight.py"), run_name="__main__")
