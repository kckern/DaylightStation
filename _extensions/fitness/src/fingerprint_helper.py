#!/usr/bin/env python3
"""In-container libfprint enroll/identify helper for the fitness unlock flow.

Runs inside the daylight-fitness container (which carries libfprint +
gir1.2-fprint-2.0 + python3-gi and gets the U.are.U reader via /dev passthrough).
The host keeps NO fingerprint stack — host `fprintd` must be stopped/masked so
this process is the sole libfprint claimant of the device.

Templates are stored as <store>/<uuid>.tpl (libfprint-serialized FpPrint), with
the uuid baked into the print's `username` field so an identify match resolves
straight back to the uuid (and thus the user).

Subcommands:
  enroll   --uuid <uuid> --finger <name> [--store DIR]   # 6 touches, writes .tpl
  identify --uuids a,b,c [--store DIR] [--timeout SEC]    # one touch, prints JSON
  list     [--store DIR]                                  # device + template info

Output: a single JSON object on stdout. Progress/prompts go to stderr so stdout
stays parseable. Non-zero exit on hard errors (no device, capture failure).
"""
import argparse
import glob
import json
import os
import signal
import sys

import gi
gi.require_version('FPrint', '2.0')
from gi.repository import FPrint, GLib  # noqa: E402

DEFAULT_STORE = '/var/lib/daylight-unlock'

# Map our hyphenated finger names to FpFinger enum members.
FINGER_MAP = {
    'left-thumb': FPrint.Finger.LEFT_THUMB,
    'left-index': FPrint.Finger.LEFT_INDEX,
    'left-middle': FPrint.Finger.LEFT_MIDDLE,
    'left-ring': FPrint.Finger.LEFT_RING,
    'left-little': FPrint.Finger.LEFT_LITTLE,
    'right-thumb': FPrint.Finger.RIGHT_THUMB,
    'right-index': FPrint.Finger.RIGHT_INDEX,
    'right-middle': FPrint.Finger.RIGHT_MIDDLE,
    'right-ring': FPrint.Finger.RIGHT_RING,
    'right-little': FPrint.Finger.RIGHT_LITTLE,
}


def log(msg):
    sys.stderr.write(msg + '\n')
    sys.stderr.flush()


def open_device():
    # IMPORTANT: return the Context too and keep it referenced for the whole
    # device lifetime. If the Context is GC'd while the device is open, libfprint
    # segfaults (SIGSEGV) on the next device call / close.
    ctx = FPrint.Context.new()
    ctx.enumerate()
    devices = ctx.get_devices()
    if not devices:
        raise RuntimeError('no fingerprint device found (is the reader passed through and fprintd stopped?)')
    dev = devices[0]
    dev.open_sync()
    return ctx, dev


def _to_bytes(serialized):
    # gi may return bytes directly, or a (ok, data) tuple depending on version.
    if isinstance(serialized, (tuple, list)) and len(serialized) == 2 and isinstance(serialized[0], bool):
        serialized = serialized[1]
    return bytes(serialized)


def cmd_enroll(args):
    finger = FINGER_MAP.get(args.finger)
    if finger is None:
        raise SystemExit(f'unknown finger "{args.finger}"; valid: {", ".join(sorted(FINGER_MAP))}')
    os.makedirs(args.store, exist_ok=True)

    ctx, dev = open_device()  # noqa: F841 — keep ctx referenced (GC guard)
    stages = dev.get_nr_enroll_stages()
    log(f'Device ready: {dev.get_name()} — place the SAME finger {stages}x (lift between each).')

    template = FPrint.Print.new(dev)
    template.set_finger(finger)
    template.set_username(args.uuid)  # bake the uuid in → identify match maps back to it

    def progress(_device, completed, _print, _error, _data=None):
        log(f'  capture {completed}/{stages} …')

    enrolled = dev.enroll_sync(template, None, progress, None)
    data = _to_bytes(enrolled.serialize())
    path = os.path.join(args.store, args.uuid + '.tpl')
    with open(path, 'wb') as fh:
        fh.write(data)
    dev.close_sync()

    print(json.dumps({'enrolled': True, 'uuid': args.uuid, 'finger': args.finger,
                      'path': path, 'bytes': len(data)}))


def cmd_identify(args):
    store = args.store
    if args.uuids:
        uuids = [u.strip() for u in args.uuids.split(',') if u.strip()]
    else:
        uuids = [os.path.splitext(os.path.basename(p))[0]
                 for p in glob.glob(os.path.join(store, '*.tpl'))]
    if not uuids:
        print(json.dumps({'matched': False, 'reason': 'no-templates'}))
        return 0
    gallery = []
    for u in uuids:
        path = os.path.join(args.store, u + '.tpl')
        if not os.path.exists(path):
            continue
        with open(path, 'rb') as fh:
            gallery.append(FPrint.Print.deserialize(fh.read()))
    if not gallery:
        print(json.dumps({'matched': False, 'reason': 'no-templates'}))
        return

    ctx, dev = open_device()  # noqa: F841 — keep ctx referenced (GC guard)

    # One Cancellable drives BOTH the optional capture timeout AND preemption.
    # A foreground unlock preempts an in-flight emergency scan by SIGTERM-killing
    # this process; we integrate the signal into GLib's main loop (the global
    # default context, which identify_sync iterates — the same context the
    # capture timeout below already relies on) so the cancel interrupts the
    # blocking scan and the `finally` closes the device cleanly. Without this, a
    # bare kill skips close_sync and the reader stays claimed, so the next scan
    # fails to open.
    cancellable = Gio_new_cancellable()
    if args.timeout and args.timeout > 0:
        GLib.timeout_add_seconds(int(args.timeout), lambda: (cancellable.cancel(), False)[1])
    for sig in (signal.SIGTERM, signal.SIGINT):
        GLib.unix_signal_add(GLib.PRIORITY_HIGH, sig,
                             lambda *_: (cancellable.cancel(), False)[1])

    log('Place a finger on the reader …')
    try:
        try:
            matched, _scanned = dev.identify_sync(gallery, cancellable, None, None)
        except GLib.Error as e:
            if cancellable.is_cancelled():
                print(json.dumps({'matched': False, 'reason': 'cancelled'}))
                return 0
            print(json.dumps({'matched': False, 'reason': 'identify-error', 'error': str(e)}))
            return 0
    finally:
        dev.close_sync()

    if matched is None:
        print(json.dumps({'matched': False, 'reason': 'no-match'}))
        return 0
    # The uuid was stored as the print username at enroll time.
    print(json.dumps({'matched': True, 'uuid': matched.get_username()}))
    return 0


def Gio_new_cancellable():
    # Lazy import so paths that don't scan (enroll/list) need no Gio.
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio
    return Gio.Cancellable()


def cmd_list(args):
    info = {'store': args.store, 'templates': []}
    if os.path.isdir(args.store):
        info['templates'] = sorted(f[:-4] for f in os.listdir(args.store) if f.endswith('.tpl'))
    try:
        ctx, dev = open_device()  # noqa: F841 — keep ctx referenced (GC guard)
        info['device'] = {'name': dev.get_name(), 'enroll_stages': dev.get_nr_enroll_stages(),
                          'scan_type': str(dev.get_scan_type())}
        dev.close_sync()
    except Exception as exc:  # noqa: BLE001
        info['device'] = None
        info['device_error'] = str(exc)
    print(json.dumps(info))


def main():
    parser = argparse.ArgumentParser(description='libfprint enroll/identify helper')
    parser.add_argument('--store', default=DEFAULT_STORE, help='template store dir')
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_en = sub.add_parser('enroll')
    p_en.add_argument('--uuid', required=True)
    p_en.add_argument('--finger', required=True)

    p_id = sub.add_parser('identify')
    p_id.add_argument('--uuids', required=False, default=None)
    p_id.add_argument('--timeout', type=float, default=10.0)

    sub.add_parser('list')

    args = parser.parse_args()
    try:
        if args.cmd == 'enroll':
            cmd_enroll(args)
        elif args.cmd == 'identify':
            cmd_identify(args)
        elif args.cmd == 'list':
            cmd_list(args)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
