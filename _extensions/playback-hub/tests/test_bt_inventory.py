#!/usr/bin/env python3
"""web.py Bluetooth inventory: /api/bt/paired and /api/bt/scan's flags.

Regression: 2026-11-10 GREEN's Bandou (41:42:F0:91:27:E8, slot 3) was
connected and playing on hci2 yet missing from /api/bt/paired, because
bluetoothctl only sees the default controller and a failed `info` probe
silently dropped the device. Fixture = real GetManagedObjects from the hub.

Run: python3 tests/test_bt_inventory.py
"""
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import web  # noqa: E402

FAILED = 0
RAN = 0


def check(cond, msg):
    global FAILED, RAN
    RAN += 1
    if not cond:
        FAILED += 1
        print(f"  FAIL: {msg}")


BUSCTL = (HERE / "fixtures" / "bluez_managed_objects.json").read_text()
GREEN, BLUE, YOTO = "41:42:F0:91:27:E8", "41:42:8D:B7:A0:11", "E8:68:E7:34:55:8E"
SLOTS = [{"slot": 3, "mac": GREEN}, {"slot": 4, "mac": BLUE}]

INFO_BLUE = """Device 41:42:8D:B7:A0:11 (public)
\tName: Bandou 3.0
\tAlias: Bandou 3.0
\tPaired: yes
\tBonded: yes
\tTrusted: yes
\tBlocked: no
\tConnected: yes
"""
INFO_MISSING = "Device 41:42:F0:91:27:E8 not available\n"


def runner(table):
    """Fake _run_text: table maps a tuple(argv) prefix-key to str/exception."""
    def run(argv, timeout):
        key = tuple(argv)
        if key not in table:
            raise FileNotFoundError(argv[0])
        val = table[key]
        if callable(val):
            return val(timeout)
        if isinstance(val, BaseException):
            raise val
        return val
    return run


BUSCTL_ARGV = ("busctl", "--system", "--json=short", "call", "org.bluez", "/",
               "org.freedesktop.DBus.ObjectManager", "GetManagedObjects")

# --- D-Bus path: every controller, flags per device ----------------------
lst = web.bt_paired_list(run=runner({BUSCTL_ARGV: BUSCTL}), devices=SLOTS)
by = {e["mac"]: e for e in lst}
check(GREEN in by, "GREEN (on hci2, non-default controller) is listed")
check(BLUE in by, "BLUE (on default controller) is listed")
check(by[GREEN]["connected"] is True and by[BLUE]["connected"] is True, "both Bandous connected")
check(by[GREEN]["paired"] and by[GREEN]["bonded"] and by[GREEN]["trusted"], "GREEN flags")
check(by[GREEN]["adapter"] == "hci2", f"GREEN adapter hci2, got {by[GREEN].get('adapter')}")
check(by[GREEN]["configured_slot"] == 3 and by[GREEN]["configured"], "GREEN slot 3")
check(by[GREEN]["source"] == "dbus" and by[GREEN]["probe"] == "ok", "dbus source")
check(YOTO in by and by[YOTO]["paired"] is False and by[YOTO]["trusted"] is True,
      "trusted-only device kept, paired flag reported honestly")
check(len(lst) == 7, f"7 known devices, got {len(lst)}")
check([e["mac"] for e in lst][:2] == [GREEN, BLUE], "sorted by configured slot")

# --- parse_bt_info ----------------------------------------------------------
f = web.parse_bt_info(INFO_BLUE)
check(f == {"paired": True, "bonded": True, "trusted": True, "connected": True}, f"info flags {f}")
check(web.parse_bt_info(INFO_MISSING) is None, "'not available' -> None")
check(web.parse_bt_info("\tTrusted: yes\n") == {"paired": False, "bonded": False,
      "trusted": True, "connected": False}, "missing flags default False")

# --- bluetoothctl fallback: concurrent, timeouts keep the device -----------
calls = []


def slow(timeout):
    calls.append(time.monotonic())
    time.sleep(0.3)
    return INFO_BLUE


table = {
    ("bluetoothctl", "devices", "Paired"): f"Device {BLUE} Bandou 3.0\n",
    ("bluetoothctl", "devices", "Connected"): f"Device {GREEN} Bandou 3.0\nDevice {BLUE} Bandou 3.0\n",
    ("bluetoothctl", "devices", "Bonded"): "Invalid command\n",
    ("bluetoothctl", "devices", "Trusted"): subprocess.TimeoutExpired("bluetoothctl", 5),
    ("bluetoothctl", "devices"): f"Device {BLUE} Bandou 3.0\nDevice 11:22:33:44:55:66 Stranger\n",
    ("bluetoothctl", "info", BLUE): slow,
    ("bluetoothctl", "info", GREEN): subprocess.TimeoutExpired("bluetoothctl", 3),
    ("bluetoothctl", "info", "11:22:33:44:55:66"): slow,
}
t0 = time.monotonic()
lst = web.bt_paired_list(run=runner(table), devices=SLOTS)  # busctl missing -> fallback
elapsed = time.monotonic() - t0
by = {e["mac"]: e for e in lst}
check(GREEN in by and by[GREEN]["probe"] == "timeout", "timed-out probe keeps GREEN with probe=timeout")
check(by[GREEN]["connected"] is None, "undetermined flags are None, not False")
check(by[BLUE]["probe"] == "ok" and by[BLUE]["connected"] is True, "BLUE probed ok")
check(by[BLUE]["source"] == "bluetoothctl", "fallback source reported")
check(elapsed < 0.55, f"info probes run concurrently ({elapsed:.2f}s)")

# overall budget: a hung probe can't hold the response past BT_INFO_BUDGET
web.BT_INFO_BUDGET = 0.2
table[("bluetoothctl", "info", BLUE)] = lambda t: (time.sleep(1.0), INFO_BLUE)[1]
t0 = time.monotonic()
lst = web.bt_paired_list(run=runner(table), devices=SLOTS)
elapsed = time.monotonic() - t0
by = {e["mac"]: e for e in lst}
check(elapsed < 0.6, f"overall budget honoured ({elapsed:.2f}s)")
check(by.get(BLUE, {}).get("probe") == "timeout", "over-budget probe -> timeout, still listed")

# unknown device from plain `devices` whose info says not-paired is dropped
web.BT_INFO_BUDGET = 6
table[("bluetoothctl", "info", "11:22:33:44:55:66")] = "\tPaired: no\n\tTrusted: no\n\tConnected: no\n"
by = {e["mac"]: e for e in web.bt_paired_list(run=runner(table), devices=SLOTS)}
check("11:22:33:44:55:66" not in by, "a probed, unknown stranger is not 'paired'")

print(f"test_bt_inventory: {RAN - FAILED}/{RAN} passed")
sys.exit(1 if FAILED else 0)
