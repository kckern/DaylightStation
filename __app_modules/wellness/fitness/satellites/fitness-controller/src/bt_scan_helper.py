#!/usr/bin/env python3
"""
bt_scan_helper — one nearby-device search for the Bluetooth screen.

Never pairs, never registers an agent, never removes a device. Spawned by
btScan.mjs with one JSON argument {"durationMs": 60000}. Prints JSON lines:

  scanning {durationMs} → nearby {devices: [...]}* → done {reason}

`reason` is "timeout" (the window ran out) or "stopped" (SIGTERM from
btScan.mjs). Which devices count as nearby, and for how long, is the pure
NearbyTracker in bt_nearby.py. A `nearby` line is printed whenever the list
changes, and at least every HEARTBEAT_S so the screen knows it is alive.
BlueZ also stops a discovery by itself when the D-Bus client that started it
exits, so a killed helper never leaves the adapter scanning.
"""
import json
import signal
import sys
import time

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

from bt_nearby import NearbyTracker, snapshot_key

BUS_NAME = "org.bluez"
ADAPTER = "/org/bluez/hci0"
LIVE_KEYS = {"RSSI", "ManufacturerData", "ServiceData", "TxPower"}
TICK_MS = 1000
HEARTBEAT_S = 3.0


def emit(phase, **extra):
    print(json.dumps({"phase": phase, **extra}), flush=True)


def is_device(path):
    return str(path).startswith(ADAPTER + "/dev_")


def main():
    args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    duration_s = max(5, int(args.get("durationMs", 60000)) // 1000)

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    loop = GLib.MainLoop()
    adapter = dbus.Interface(bus.get_object(BUS_NAME, ADAPTER), "org.bluez.Adapter1")
    om = dbus.Interface(bus.get_object(BUS_NAME, "/"), "org.freedesktop.DBus.ObjectManager")
    tracker = NearbyTracker()
    state = {"done": False, "key": None, "emitted_at": 0.0}

    def finish(reason):
        if state["done"]:
            return
        state["done"] = True
        try:
            adapter.StopDiscovery()
        except dbus.DBusException:
            pass
        emit("done", reason=reason)
        loop.quit()

    # Cached device objects: names and flags only. They are not nearby until heard.
    for path, ifaces in om.GetManagedObjects().items():
        if is_device(path) and "org.bluez.Device1" in ifaces:
            tracker.update(str(path), ifaces["org.bluez.Device1"], time.monotonic(), live=False)

    def on_added(path, ifaces):
        if is_device(path) and "org.bluez.Device1" in ifaces:
            tracker.update(str(path), ifaces["org.bluez.Device1"], time.monotonic(), live=True)

    def on_removed(path, ifaces):
        if "org.bluez.Device1" in ifaces:
            tracker.forget(str(path))

    def on_changed(iface, changed, invalidated, path=None):
        if iface != "org.bluez.Device1" or not path or not is_device(path):
            return
        tracker.update(str(path), changed, time.monotonic(), live=bool(LIVE_KEYS & set(changed.keys())))

    bus.add_signal_receiver(on_added, dbus_interface="org.freedesktop.DBus.ObjectManager",
                            signal_name="InterfacesAdded")
    bus.add_signal_receiver(on_removed, dbus_interface="org.freedesktop.DBus.ObjectManager",
                            signal_name="InterfacesRemoved")
    bus.add_signal_receiver(on_changed, dbus_interface="org.freedesktop.DBus.Properties",
                            signal_name="PropertiesChanged", path_keyword="path")

    def tick():
        if state["done"]:
            return False
        now = time.monotonic()
        rows = tracker.snapshot(now)
        key = snapshot_key(rows)
        if key != state["key"] or now - state["emitted_at"] >= HEARTBEAT_S:
            state["key"] = key
            state["emitted_at"] = now
            emit("nearby", devices=rows)
        return True

    try:
        # DuplicateData: report repeated advertisements, so an LE device that
        # keeps advertising keeps counting as heard.
        adapter.SetDiscoveryFilter({"Transport": "auto", "DuplicateData": dbus.Boolean(True)})
    except dbus.DBusException as e:
        emit("warn", message=f"SetDiscoveryFilter: {e}")
    emit("scanning", durationMs=duration_s * 1000)
    try:
        adapter.StartDiscovery()
    except dbus.DBusException as e:
        if "InProgress" not in str(e):
            emit("warn", message=f"StartDiscovery: {e}")

    GLib.timeout_add(TICK_MS, tick)
    GLib.timeout_add_seconds(duration_s, lambda: (finish("timeout"), False)[1])
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGTERM, lambda: (finish("stopped"), False)[1])
    loop.run()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never die silently: the screen waits on a done
        emit("warn", message=f"scan helper crashed: {e}")
        emit("done", reason="helper-crashed")
        sys.exit(2)
