#!/usr/bin/env python3
"""Run espota with its password on stdin, without debug output or argv leakage."""
import importlib.util
import sys


def main():
    if len(sys.argv) != 4:
        print('usage: espota-stdin.py <device-host> <firmware.bin> <espota.py>', file=sys.stderr)
        return 2
    host, image, uploader = sys.argv[1:]
    password = sys.stdin.readline().rstrip('\r\n')
    if not password:
        print('empty OTA password', file=sys.stderr)
        return 2
    spec = importlib.util.spec_from_file_location('daylight_espota', uploader)
    if spec is None or spec.loader is None:
        print('espota uploader unavailable', file=sys.stderr)
        return 2
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    bucket = [-1]

    def progress(value):
        next_bucket = min(10, int(float(value) * 10))
        if next_bucket > bucket[0]:
            bucket[0] = next_bucket
            print(f'{next_bucket * 10}%', file=sys.stderr, flush=True)

    module.update_progress = progress
    return module.main(['espota.py', '--ip', host, '--auth', password, '--file', image])


if __name__ == '__main__':
    raise SystemExit(main())
