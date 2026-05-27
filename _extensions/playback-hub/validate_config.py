#!/usr/bin/env python3
"""
validate_config.py — load devices.yml, validate schema, emit JSON.

Called from playback-hub.sh's refresh_config_cache(). On any validation
failure, exits non-zero with an error message on stderr so the calling
shell can keep the previous good runtime cache. On success, writes the
JSON form of the validated config to stdout.

Validation rules:
  - Top-level must be a YAML mapping.
  - `devices` is required and must be a non-empty list.
  - Every device must have a `color` (canonical id). Colors must be unique.
  - `class` defaults to `private`. Allowed: `private` | `public`.
  - `class: public` requires `ha_entity_id`.
  - `volume.min <= volume.default <= volume.max`, all in [0, 100].
  - Every `scheduled` entry must reference an existing device color via
    `target`, and must have `time` and `queue`.

Usage:
  python3 validate_config.py path/to/devices.yml > runtime.json
"""

import json
import sys

try:
    import yaml
except ImportError:
    sys.stderr.write("PyYAML required but not installed\n")
    sys.exit(2)


def fail(msg):
    sys.stderr.write(f"config validation failed: {msg}\n")
    sys.exit(1)


def validate_volume(color, vol):
    if not isinstance(vol, dict):
        fail(f"device {color!r} volume must be a mapping")
    vmin = vol.get("min", 0)
    vmax = vol.get("max", 100)
    vdef = vol.get("default", 60)
    for k, v in (("min", vmin), ("max", vmax), ("default", vdef)):
        if not isinstance(v, (int, float)) or v < 0 or v > 100:
            fail(f"device {color!r} volume.{k} must be 0-100, got {v!r}")
    if not (vmin <= vdef <= vmax):
        fail(
            f"device {color!r} volume: min({vmin}) <= default({vdef}) <= max({vmax}) violated"
        )


def main(yml_path):
    try:
        with open(yml_path) as f:
            doc = yaml.safe_load(f)
    except (OSError, yaml.YAMLError) as e:
        fail(f"could not parse {yml_path}: {e}")

    if not isinstance(doc, dict):
        fail("YAML root must be a mapping")

    devices = doc.get("devices")
    if not isinstance(devices, list) or len(devices) == 0:
        fail("`devices` must be a non-empty list")

    seen_colors = []
    seen_macs = []
    for i, dev in enumerate(devices):
        if not isinstance(dev, dict):
            fail(f"devices[{i}] must be a mapping")
        color = dev.get("color")
        if not color:
            fail(f"devices[{i}] missing canonical id `color`")
        if color in seen_colors:
            fail(f"duplicate color {color!r}")
        seen_colors.append(color)

        mac = dev.get("mac")
        if mac:
            if mac in seen_macs:
                fail(f"duplicate mac {mac!r} (device {color!r})")
            seen_macs.append(mac)

        cls = dev.get("class", "private")
        if cls not in ("private", "public"):
            fail(f"device {color!r} class must be private or public, got {cls!r}")
        if cls == "public" and not dev.get("ha_entity_id"):
            fail(f"public device {color!r} requires ha_entity_id")

        if "volume" in dev and dev["volume"] is not None:
            validate_volume(color, dev["volume"])

    # Top-level scheduled (one-shot fires). Optional.
    for i, sch in enumerate(doc.get("scheduled") or []):
        if not isinstance(sch, dict):
            fail(f"scheduled[{i}] must be a mapping")
        target = sch.get("target")
        if target not in seen_colors:
            fail(f"scheduled[{i}] target {target!r} not a known device color")
        if not sch.get("time"):
            fail(f"scheduled[{i}] missing `time`")
        if not sch.get("queue"):
            fail(f"scheduled[{i}] missing `queue`")
        days = sch.get("days", "all")
        if isinstance(days, str):
            if days not in ("all", "weekdays", "weekends"):
                fail(f"scheduled[{i}] days string must be all|weekdays|weekends, got {days!r}")
        elif isinstance(days, list):
            valid = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
            for d in days:
                if d not in valid:
                    fail(f"scheduled[{i}] days list contains invalid day {d!r}")
        else:
            fail(f"scheduled[{i}] days must be string or list")

    # daylight_station block validation (optional but if present must have base_url)
    ds = doc.get("daylight_station")
    if ds is not None:
        if not isinstance(ds, dict):
            fail("daylight_station must be a mapping")
        if not ds.get("base_url"):
            fail("daylight_station.base_url is required when daylight_station block is present")

    json.dump(doc, sys.stdout)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.stderr.write(f"usage: {sys.argv[0]} <devices.yml>\n")
        sys.exit(2)
    main(sys.argv[1])
