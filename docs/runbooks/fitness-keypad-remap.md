# Runbook — Break-Glass Keypad Remap (garage fitness kiosk)

A SayoDevice 6x4M macropad sits on the shelf beside the fitness TV. It is pulled
down only when the kiosk needs an OS-level nudge the touchscreen cannot express:
the touchscreen only ever talks *to* the focused app, never around it, so when
the app is wedged or showing stale assets there is no touch gesture that means
"get me underneath you". The pad replaces a full-size Dell keyboard that lived at
the TV for months for exactly these four keystrokes.

A daemon on the box rewrites four of its keys into system-level chords, scoped by
USB serial so no other keyboard is affected.

> **Host placeholder.** `{garage_host}` below is the garage box's SSH alias — see
> `CLAUDE.local.md` for the actual value. The pad's serial appears verbatim in the
> config listing below so a rebuild is paste-and-go; it is a hardware serial, not
> a credential. It is also recorded in `data/system/config/fitness.yml` under
> `keypad.serial`, which is the place to look when re-identifying the device.

## Why it is not deployed from source

The live mapping is installed by hand on the box and is deliberately **not** in
source control and **not** in any deploy pipeline. It is a single-host physical
convenience with no counterpart anywhere else, and wiring it into `deploy.sh`
would imply a fleet that does not exist. This runbook is the recovery path: it
contains everything needed to rebuild after a wipe.

## What the keys do

Bound left-to-right in **escalation order** — cheapest first, most destructive
last. In the moment, the rule is: start at the left, move right only if the
previous key did not fix it.

| Key | Sticker | Chord | Reaches | Reversible |
|-----|---------|-------|---------|------------|
| 1 | Green | `ctrl+shift+r` | The page — hard reload, bypasses HTTP cache | Yes |
| 2 | Blue | `super` | xfwm4 — reveal the taskbar | Yes |
| 3 | Yellow | `ctrl+esc` | xfwm4 — main menu | Yes |
| 4 | Red | `alt+f4` | The process — force the window closed | **No** |
| 5 | White | `exec` restart script | Relaunches the kiosk as on cold boot | n/a — it *is* the recovery |

Key 5 sits outside the escalation ladder. It is what brings the kiosk back after
key 4, which matters because nothing else does: the autostart entry only fires at
session start, so an `alt+f4` on the kiosk leaves a black screen until someone
SSHes in. Key 5 is what makes key 4 safe to reach for.

The other 19 keys are unbound and unstickered, and pass through untouched.

## What is installed where

| Path | Purpose |
|------|---------|
| `/opt/daylight-keypad/keypad.py` | The daemon |
| `/etc/daylight-keypad/keymap.yml` | Live mapping — edit this to change bindings |
| `/etc/systemd/system/daylight-keypad.service` | Unit, enabled at boot |

## Rebuild from scratch

### 1. Dependencies

Ships with Linux Mint 22.2 / Ubuntu 24.04, but verify:

```bash
ssh {garage_host} 'apt-get install -y python3-evdev python3-yaml'
ssh {garage_host} 'ls -l /dev/uinput'   # must exist; the daemon writes chords through it
```

### 2. Identify the pad

The serial is the only stable handle — `/dev/input/eventN` numbers drift across
replugs and reboots, so never hardcode a node path.

```bash
ssh {garage_host} '/opt/daylight-keypad/keypad.py --list'
```

Look for `SayoDevice 6x4M`. It publishes **four** nodes under one serial: two
keyboards (6KRO boot + NKRO), a mouse the firmware declares but never uses, and a
vendor config node. Only the keyboards carry key presses.

### 3. The daemon

```bash
ssh {garage_host} 'mkdir -p /opt/daylight-keypad /etc/daylight-keypad'
```

Write `/opt/daylight-keypad/keypad.py`:

```python
#!/usr/bin/env python3
"""Break-glass keypad remapper for the garage fitness kiosk.

Turns keys on one specific USB macropad into system-level chords, so the kiosk
can be reloaded, escaped or killed when the touchscreen cannot express it --
the touchscreen only ever talks *to* the focused app, never around it.

Scoped by USB serial, so every other keyboard on the box is left alone. Chords
are synthesised through uinput rather than xdotool, so the service needs no
DISPLAY, no XAUTHORITY and no logged-in session.
"""

import argparse
import selectors
import subprocess
import sys
import time

import yaml
from evdev import InputDevice, UInput, ecodes as e, list_devices

CONFIG = "/etc/daylight-keypad/keymap.yml"

MODIFIERS = {
    "ctrl": e.KEY_LEFTCTRL, "control": e.KEY_LEFTCTRL,
    "shift": e.KEY_LEFTSHIFT,
    "alt": e.KEY_LEFTALT,
    "super": e.KEY_LEFTMETA, "meta": e.KEY_LEFTMETA, "win": e.KEY_LEFTMETA,
}


def log(msg):
    print(msg, flush=True)


def resolve_key(name):
    """Accept KEY_R, r, f5, esc, or a bare modifier name."""
    bare = name.strip().lower()
    if bare in MODIFIERS:
        return MODIFIERS[bare]
    upper = name.strip().upper()
    for candidate in (upper, "KEY_" + upper):
        if candidate in e.ecodes:
            return e.ecodes[candidate]
    raise ValueError("unknown key: %s" % name)


def parse_chord(spec):
    """ctrl+shift+r -> ([KEY_LEFTCTRL, KEY_LEFTSHIFT], KEY_R)."""
    parts = [p.strip() for p in str(spec).split("+") if p.strip()]
    if not parts:
        raise ValueError("empty chord: %r" % spec)
    mods = []
    for part in parts[:-1]:
        if part.lower() not in MODIFIERS:
            raise ValueError("%r is not a modifier in chord %r" % (part, spec))
        mods.append(MODIFIERS[part.lower()])
    return mods, resolve_key(parts[-1])


def parse_binding(spec):
    """A binding is either a chord string, or a mapping carrying `exec`.

    Chords are synthesised in-process through uinput. `exec` shells out, which
    is how key 5 restarts the kiosk -- that needs to run as the desktop user on
    their X display, which a synthetic keystroke cannot express.
    """
    if isinstance(spec, dict):
        if "exec" not in spec:
            raise ValueError("binding mapping needs an `exec` key: %r" % spec)
        return ("exec", str(spec["exec"]))
    return ("chord", parse_chord(spec))


def run_command(cmd):
    """Fire and forget, in its own session.

    Detached deliberately: restarting or stopping this daemon must never take
    the kiosk down with it.
    """
    subprocess.Popen(cmd, shell=True, start_new_session=True)


def pad_nodes(serial):
    """Keyboard nodes belonging to the pad.

    The pad publishes four nodes under one serial: two keyboards (6KRO boot and
    NKRO), a mouse it declares but never uses, and a vendor config node. Only
    the keyboards carry key presses, so filter on a real key being present
    rather than on EV_KEY, which the mouse also reports for its buttons.
    """
    found = []
    for path in list_devices():
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        if dev.uniq == serial and e.KEY_A in dev.capabilities().get(e.EV_KEY, []):
            found.append(dev)
        else:
            dev.close()
    return found


def emit(ui, mods, key):
    for mod in mods:
        ui.write(e.EV_KEY, mod, 1)
    ui.write(e.EV_KEY, key, 1)
    ui.syn()
    time.sleep(0.02)
    ui.write(e.EV_KEY, key, 0)
    for mod in reversed(mods):
        ui.write(e.EV_KEY, mod, 0)
    ui.syn()


def payload_desc(cfg, code):
    return (cfg.get("bindings") or {}).get(e.KEY[code], "?")


def run(cfg):
    serial = cfg["device"]["serial"]
    bindings = {resolve_key(k): parse_binding(v) for k, v in (cfg.get("bindings") or {}).items()}
    passthrough = cfg.get("passthrough_unmapped", True)
    debounce = cfg.get("debounce_ms", 50) / 1000.0
    log("watching for serial %s (%d bindings)" % (serial, len(bindings)))

    while True:
        devices = pad_nodes(serial)
        if not devices:
            time.sleep(2)
            continue

        keys = set(bindings)
        for kind, payload in bindings.values():
            if kind == "chord":
                mods, key = payload
                keys.update(mods)
                keys.add(key)
        for dev in devices:
            keys.update(dev.capabilities().get(e.EV_KEY, []))

        ui = None
        last_fired = {}
        try:
            for dev in devices:
                dev.grab()
                log("grabbed %s (%s)" % (dev.path, dev.name))
            ui = UInput({e.EV_KEY: sorted(keys)}, name="daylight-keypad")

            sel = selectors.DefaultSelector()
            for dev in devices:
                sel.register(dev, selectors.EVENT_READ)

            while True:
                for key_sel, _ in sel.select():
                    for event in key_sel.fileobj.read():
                        if event.type != e.EV_KEY or event.value != 1:
                            if event.type == e.EV_KEY and passthrough and event.code not in bindings:
                                ui.write(e.EV_KEY, event.code, event.value)
                                ui.syn()
                            continue

                        # The pad can announce one press on both keyboard
                        # nodes; only act on the first one seen.
                        now = time.monotonic()
                        if now - last_fired.get(event.code, 0) < debounce:
                            continue
                        last_fired[event.code] = now

                        if event.code in bindings:
                            kind, payload = bindings[event.code]
                            if kind == "chord":
                                emit(ui, *payload)
                                log("%s -> %s" % (e.KEY[event.code], payload_desc(cfg, event.code)))
                            else:
                                log("%s -> exec: %s" % (e.KEY[event.code], payload))
                                run_command(payload)
                        elif passthrough:
                            ui.write(e.EV_KEY, event.code, 1)
                            ui.syn()

        except OSError as err:
            log("pad went away (%s) -- waiting for it to come back" % err)
        finally:
            if ui:
                ui.close()
            for dev in devices:
                try:
                    dev.ungrab()
                except OSError:
                    pass
                dev.close()
            time.sleep(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=CONFIG)
    ap.add_argument("--list", action="store_true", help="print every input device and its serial")
    ap.add_argument("--dump", action="store_true", help="print key codes from the pad without grabbing it")
    args = ap.parse_args()

    if args.list:
        for path in list_devices():
            try:
                dev = InputDevice(path)
            except OSError:
                continue
            log("%-20s %-40s serial=%s" % (dev.path, dev.name, dev.uniq or "-"))
            dev.close()
        return

    cfg = yaml.safe_load(open(args.config))

    if args.dump:
        devices = pad_nodes(cfg["device"]["serial"])
        if not devices:
            log("no pad with serial %s" % cfg["device"]["serial"])
            sys.exit(1)
        log("press keys on the pad (ctrl-c to stop) -- not grabbing, keys still reach the desktop")
        sel = selectors.DefaultSelector()
        for dev in devices:
            sel.register(dev, selectors.EVENT_READ)
        while True:
            for key_sel, _ in sel.select():
                for event in key_sel.fileobj.read():
                    if event.type == e.EV_KEY and event.value == 1:
                        log("%-12s code=%-4d from %s" % (e.KEY[event.code], event.code, key_sel.fileobj.path))
        return

    run(cfg)


if __name__ == "__main__":
    main()
```

Then `chmod +x /opt/daylight-keypad/keypad.py`.

### 4. The mapping

Write `/etc/daylight-keypad/keymap.yml`:

```yaml
# Break-glass keypad -- SayoDevice 6x4M
#
# Lives on the shelf by the fitness TV, pulled down only when the kiosk needs
# an OS-level nudge the touchscreen cannot express. Replaces the full-size Dell
# keyboard that sat at the TV for months.
#
# This file is the live mapping. It is NOT deployed from source control; the
# repo only records the device facts (data/system/config/fitness.yml) and the
# rebuild procedure (docs/runbooks/fitness-keypad-remap.md).
#
# Edit, then: sudo systemctl restart daylight-keypad

device:
  # Matches evdev `uniq`, so the remap touches this pad and nothing else.
  # `keypad.py --list` prints serials for every input device on the box.
  serial: "037F2033646191AC430000000000"

# Unbound keys are forwarded untouched, so the pad still behaves as an
# ordinary keyboard if it is ever needed as one.
passthrough_unmapped: true

# The pad announces a press on both its 6KRO and NKRO keyboard nodes. Ignore a
# repeat of the same key inside this window so one press fires once.
debounce_ms: 50

# pad key -> action. Either a chord string (modifiers: ctrl shift alt super),
# or a mapping with `exec` to run a command as root.
bindings:
  KEY_1: ctrl+shift+r   # hard reload, bypasses the HTTP cache
  KEY_2: super          # reveal the xfwm4 taskbar
  KEY_3: ctrl+esc       # main menu
  KEY_4: alt+f4         # force the focused window closed

  # Recovery, not escalation: this is what brings the kiosk back after key 4.
  # A chord cannot express it -- Firefox has to be relaunched as the desktop
  # user on their X display, so it shells out. The wrapper re-runs the same
  # start-browser-kiosk.sh the autostart entry uses, so a warm restart and a
  # cold boot cannot diverge.
  KEY_5:
    exec: /usr/local/bin/restart-browser-kiosk.sh
```

### 5. The kiosk restart wrapper (key 5)

Key 5 cannot be a chord — Firefox has to be relaunched as the desktop user on
their X display, and the daemon runs as root. It shells out to this wrapper,
which deliberately re-runs the **existing** `/usr/local/bin/start-browser-kiosk.sh`
rather than reimplementing it, so a warm restart and a cold boot cannot drift
apart. That script carries a network wait and an audio-sink gate (a missing sink
freezes EmulatorJS on a white screen); reimplementing would lose both.

Write `/usr/local/bin/restart-browser-kiosk.sh`, then `chmod +x`:

```bash
#!/bin/bash
# Restart the fitness kiosk exactly the way a cold boot starts it.
#
# Bound to key 5 on the break-glass keypad. Deliberately re-runs
# start-browser-kiosk.sh rather than reimplementing it, so the warm restart
# cannot drift away from what the autostart entry actually does -- including
# its network wait and its audio-sink gate, which exists because a missing
# sink freezes EmulatorJS on a white screen.
#
# Runs as root (the keypad daemon needs root for the input grab), so it drops
# to the desktop user and hands over that session's X and D-Bus environment.
# The relaunch goes into its own transient unit so it does not die alongside
# whatever invoked it.

set -u

KIOSK_USER=kckern
KIOSK_UID=$(id -u "$KIOSK_USER")
START=/usr/local/bin/start-browser-kiosk.sh
PATTERN="/usr/lib/firefox/firefox"

echo "stopping firefox for $KIOSK_USER"
pkill -u "$KIOSK_USER" -f "$PATTERN" 2>/dev/null || true

# Let it exit on its own first; a clean shutdown lets Firefox write its session
# out, so the relaunch does not come back showing crash recovery.
for _ in $(seq 1 10); do
    pgrep -u "$KIOSK_USER" -f "$PATTERN" >/dev/null || break
    sleep 0.5
done
if pgrep -u "$KIOSK_USER" -f "$PATTERN" >/dev/null; then
    echo "firefox did not exit on its own; forcing"
    pkill -9 -u "$KIOSK_USER" -f "$PATTERN" 2>/dev/null || true
    sleep 1
fi

echo "relaunching via $START"
exec systemd-run --collect --quiet \
    --unit="kiosk-restart-$$" \
    --uid="$KIOSK_UID" --gid="$KIOSK_UID" \
    --setenv=HOME="/home/$KIOSK_USER" \
    --setenv=DISPLAY=:0 \
    --setenv=XAUTHORITY="/home/$KIOSK_USER/.Xauthority" \
    --setenv=XDG_RUNTIME_DIR="/run/user/$KIOSK_UID" \
    --setenv=DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$KIOSK_UID/bus" \
    "$START"
```

The cold-start chain it hooks into, for reference:

```
lightdm (autologin kckern)
  -> XFCE session
    -> ~/.config/autostart/browser-kiosk.desktop
      -> /usr/local/bin/start-browser-kiosk.sh
        -> exec firefox --kiosk <fitness url>
```

**One edit was made to `start-browser-kiosk.sh` itself** (original kept beside it
as `.bak-20260825`). It opened with a flat `sleep 5` to wait for X. Measured from
a real key-5 press, that sleep *was* the entire perceived lag — press to browser
was 5.7s, of which 5.0s was the sleep and everything else totalled under 700ms.
It is now a readiness probe:

```bash
export DISPLAY=:0
for _ in $(seq 1 100); do
    xset -q >/dev/null 2>&1 && break
    sleep 0.1
done
```

Better on both paths: ~7ms on a warm restart where X is already up, and 10s of
headroom at cold boot instead of 5s, where the old fixed sleep would have
launched into a dead display if X had ever been slow.

### 6. The unit

Write `/etc/systemd/system/daylight-keypad.service`:

```ini
[Unit]
Description=Break-glass keypad remapper (garage fitness kiosk)
Documentation=https://github.com/kckern/DaylightStation/blob/main/docs/runbooks/fitness-keypad-remap.md
# Deliberately not ordered after graphical.target: chords are synthesised
# through uinput, so the service is useful before anyone logs in and survives
# X restarting underneath it.
After=multi-user.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/daylight-keypad/keypad.py
# The pad is wireless and lives on a shelf; it is absent far more often than
# present. The daemon polls for it, so a non-zero exit is genuinely unexpected.
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
ssh {garage_host} 'systemctl daemon-reload && systemctl enable --now daylight-keypad'
```

### 7. Verify

```bash
ssh {garage_host} 'systemctl is-active daylight-keypad; journalctl -u daylight-keypad -n 10 --no-pager -o cat'
```

Healthy output names both keyboard nodes:

```
watching for serial 037F… (4 bindings)
grabbed /dev/input/event18 (SayoDevice SayoDevice 6x4M Keyboard)
grabbed /dev/input/event6 (SayoDevice SayoDevice 6x4M)
```

Then the only test that counts: press key 1 at the TV and confirm the kiosk
hard-reloads. The journal logs each mapped press.

## Changing the mapping

Edit the config on the box and restart — no redeploy, no rebuild:

```bash
ssh {garage_host} 'nano /etc/daylight-keypad/keymap.yml && systemctl restart daylight-keypad'
```

Key names accept `KEY_1`, `1`, `f5`, `esc`. Modifiers are `ctrl`, `shift`, `alt`,
`super`. A lone modifier (`super`) is a valid binding. Unknown names fail loudly
at startup — check the journal after a restart.

A binding is either a **chord string**, or a **mapping with `exec`** to run a
command as root:

```yaml
bindings:
  KEY_1: ctrl+shift+r
  KEY_5:
    exec: /usr/local/bin/restart-browser-kiosk.sh
```

`exec` commands are spawned detached in their own session, so restarting or
stopping the daemon never takes the spawned process down with it.

## Discovering what a key emits

Requires stopping the service, because it holds an exclusive grab:

```bash
ssh {garage_host} 'systemctl stop daylight-keypad; timeout 60 /opt/daylight-keypad/keypad.py --dump; systemctl start daylight-keypad'
```

Press keys during the window. `--dump` does not grab, so presses still reach the
desktop.

## Troubleshooting

**Keys do nothing.** Check the service is active and actually grabbed the device.
If the journal says `watching for serial …` with no `grabbed` lines, the pad is
not connected — it is wireless, so check the receiver.

**Keys type `1234` instead of firing chords.** The grab failed, so raw keys are
reaching X. Almost always the serial in the config no longer matches the hardware
(pad replaced, or a second pad added). Re-run `--list`.

**Chords fire twice.** The pad is announcing each press on both keyboard nodes.
Raise `debounce_ms`.

**The whole pad is dead after an edit.** The daemon holds an exclusive grab; if it
crashed mid-run the grab is released automatically by the kernel, so this should
self-heal on restart. Worst case, SSH in and `systemctl stop daylight-keypad` —
the pad reverts to emitting plain `1234`.

**Everything is broken and the pad cannot help.** SSH is the real escape hatch.
Behind that, the retired Dell keyboard is in storage and can be plugged back in.

## Removal

```bash
ssh {garage_host} 'systemctl disable --now daylight-keypad'
ssh {garage_host} 'rm -rf /opt/daylight-keypad /etc/daylight-keypad /etc/systemd/system/daylight-keypad.service'
ssh {garage_host} 'systemctl daemon-reload'
```

The pad reverts to its factory `1234567890` + `A`–`N` sequence.

## Notes

- Chords are synthesised through **uinput**, not `xdotool`, so the service needs
  no `DISPLAY`, no `XAUTHORITY` and no logged-in session. It works at the login
  screen and survives X restarting underneath it.
- The pad ships in **6KRO mode** — presses were observed only on the boot
  keyboard node. The daemon grabs the NKRO node too, so flipping NKRO on in the
  SayoDevice configurator will not break it.
- The pad's firmware could do this remap natively, with no host software at all.
  That was rejected because reconfiguring it requires a Chromium-based browser
  (WebHID), and a config file on the box is easier to read, edit and document
  than firmware state living only inside the device.
