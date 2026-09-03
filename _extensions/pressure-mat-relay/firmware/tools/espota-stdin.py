#!/usr/bin/env python3
"""Run Arduino's espota uploader without putting its password in process argv."""

import importlib.util
import sys


def main():
    if len(sys.argv) != 4:
        print("usage: espota-stdin.py <device-host> <firmware.bin> <espota.py>", file=sys.stderr)
        return 2

    device_host, image_path, espota_path = sys.argv[1:]
    password = sys.stdin.readline().rstrip("\r\n")
    if not password:
        print("ERROR: empty OTA password on stdin", file=sys.stderr)
        return 2

    spec = importlib.util.spec_from_file_location("daylight_espota", espota_path)
    if spec is None or spec.loader is None:
        print(f"ERROR: cannot load {espota_path}", file=sys.stderr)
        return 2
    espota = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(espota)

    last_bucket = [-1]

    def concise_progress(progress):
        bucket = min(10, int(float(progress) * 10))
        if bucket > last_bucket[0]:
            last_bucket[0] = bucket
            print(f" {bucket * 10}%", file=sys.stderr, flush=True)

    espota.update_progress = concise_progress

    # Deliberately omit --debug: the framework's debug formatter dumps the
    # parsed auth option. Progress and errors remain visible without it.
    return espota.main([
        "espota.py",
        "--ip", device_host,
        "--auth", password,
        "--file", image_path,
    ])


if __name__ == "__main__":
    raise SystemExit(main())
