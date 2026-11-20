#!/usr/bin/env python3
"""
bt_pair_helper — one controller-pairing window over BlueZ D-Bus.

Spawned by btPairing.mjs with one JSON argument:
  {"targets": [...], "durationMs": 60000, "mode": "repair"|"address"}

`mode: address` pairs exactly the one address in `targets[0].address` (picked
from the Bluetooth screen's nearby list). See bt_pair_match.py.

Prints one JSON object per line, one per lifecycle transition, which the Node
side relays as `bt.pair.progress`:

  scanning → seen* → found → [stale-bond-removed] → pairing → [passkey|pincode]
           → [retry] → bonded → connecting → hid-wait → [hid-retry] → paired → done
  any stage → error {code, message} → done      nothing seen → done {reason:"none-found"}

Why D-Bus and not bluetoothctl: legacy-PIN pads (8BitDo SFC30) need an agent
that answers RequestPinCode with the configured PIN. bluetoothctl's
NoInputNoOutput agent answers it with garbage ("Invalid PIN length (23)") and
the pad ends Connected+Trusted but unbonded, so the kernel rejects its HID
channel ("Rejected connection from !bonded device"). This helper registers its
own default agent for the life of the window only, so it never fights a
second agent after the window ends.

Success is an INPUT DEVICE for the pad's MAC in /proc/bus/input/devices — not
merely Connected. The HID channel opens only once the pad reconnects as a
bonded device, so the helper disconnects and reconnects once if the input
device does not appear.
"""
import json
import sys
import time

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

from bt_pair_match import (address_step, candidate_action, compile_targets, discovery_transport,
                           error_code, format_passkey, input_device_present, is_retryable,
                           match as match_rule, may_remove_bond, paired_after_read_error,
                           remove_after_no_input)

BUS_NAME = "org.bluez"
ADAPTER = "/org/bluez/hci0"
AGENT_PATH = "/net/daylight/btpair/agent"
DEFAULT_PIN = "0000"
HID_WAIT_S = 15


def emit(phase, **extra):
    print(json.dumps({"phase": phase, **extra}), flush=True)


def read_input_devices():
    try:
        with open("/proc/bus/input/devices", "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def replace_old_bond(adapter, path, device, cid, emit_fn=None):
    """Address mode: the picked device's old bond did not come up, and it is
    advertising, so it has forgotten us. Remove the old bond so discovery can
    pair it fresh. True on success (reports stale-bond-removed); False when
    RemoveDevice fails (reports an error; the raw text is for logs only)."""
    emit_fn = emit_fn or emit
    try:
        adapter.RemoveDevice(path)
    except dbus.DBusException as e:
        emit_fn("error", device=device, controllerId=cid, code="unknown",
                message=f"could not remove the old bond: {e}")
        return False
    emit_fn("stale-bond-removed", device=device, controllerId=cid)
    return True


class Agent(dbus.service.Object):
    """Default agent for the window: PIN from config, SSP just-works. A code the
    person must type on the device (DisplayPasskey / DisplayPinCode, used by
    keyboards) is reported through on_display so the screen can show it."""

    def __init__(self, bus, path, pin_for, on_display):
        super().__init__(bus, path)
        self.pin_for = pin_for
        self.on_display = on_display

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="s")
    def RequestPinCode(self, device):
        pin = self.pin_for(str(device))
        emit("agent", request="pin")
        return pin

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="u")
    def RequestPasskey(self, device):
        emit("agent", request="passkey")
        pin = self.pin_for(str(device))
        return dbus.UInt32(int(pin) if pin.isdigit() else 0)

    @dbus.service.method("org.bluez.Agent1", in_signature="ou", out_signature="")
    def RequestConfirmation(self, device, passkey):
        emit("agent", request="confirm")

    @dbus.service.method("org.bluez.Agent1", in_signature="ouq", out_signature="")
    def DisplayPasskey(self, device, passkey, entered):
        self.on_display(str(device), "passkey", format_passkey(passkey), int(entered))

    @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
    def DisplayPinCode(self, device, pincode):
        self.on_display(str(device), "pincode", str(pincode), 0)

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="")
    def RequestAuthorization(self, device):
        emit("agent", request="authorize")

    @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
    def AuthorizeService(self, device, uuid):
        pass

    @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
    def Cancel(self):
        emit("agent", request="cancel")

    @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
    def Release(self):
        pass


def main():
    args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    targets = compile_targets(args.get("targets"))
    mode = args.get("mode") if args.get("mode") in ("repair", "address") else "repair"

    def match(props, tgts):
        return match_rule(props, tgts, mode)

    duration_s = max(5, int(args.get("durationMs", 60000)) // 1000)

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    loop = GLib.MainLoop()
    adapter_obj = bus.get_object(BUS_NAME, ADAPTER)
    adapter = dbus.Interface(adapter_obj, "org.bluez.Adapter1")
    adapter_props = dbus.Interface(adapter_obj, "org.freedesktop.DBus.Properties")
    om = dbus.Interface(bus.get_object(BUS_NAME, "/"), "org.freedesktop.DBus.ObjectManager")

    state = {"busy": None, "pins": {}, "attempts": {}, "seen": set(), "candidates": 0,
             "result": None, "removed": set(), "made": set(), "devices": {}, "replaced": set()}

    def pin_for(path):
        return state["pins"].get(path) or DEFAULT_PIN

    def on_display(path, kind, passkey, entered):
        emit(kind, device=state["devices"].get(path) or {"address": "", "name": ""},
             passkey=passkey, entered=entered)

    Agent(bus, AGENT_PATH, pin_for, on_display)
    mgr = dbus.Interface(bus.get_object(BUS_NAME, "/org/bluez"), "org.bluez.AgentManager1")
    try:
        mgr.UnregisterAgent(AGENT_PATH)
    except dbus.DBusException:
        pass
    mgr.RegisterAgent(AGENT_PATH, "KeyboardDisplay")
    mgr.RequestDefaultAgent(AGENT_PATH)

    def finish(result, **extra):
        if state["result"] is not None:
            return
        state["result"] = result
        try:
            adapter.StopDiscovery()
        except dbus.DBusException:
            pass
        emit("done", **extra)
        loop.quit()

    def dev_props(path):
        p = dbus.Interface(bus.get_object(BUS_NAME, path), "org.freedesktop.DBus.Properties")
        return p, p.GetAll("org.bluez.Device1")

    def start_discovery():
        try:
            adapter.StartDiscovery()
        except dbus.DBusException as e:
            if "InProgress" not in str(e):
                emit("warn", message=f"StartDiscovery: {e}")

    def describe(props, target):
        d = {"address": str(props.get("Address", "")),
             "name": str(props.get("Name", "") or (target or {}).get("label") or props.get("Address", ""))}
        if (target or {}).get("kind"):
            d["kind"] = target["kind"]
        return d

    def fail_device(path, device, cid, message, made_here=False, code="unknown"):
        """Remove the half-made bond and retry once; second failure is final.

        made_here: this window's own Pair() succeeded, so any bond is ours and
        half-made. Otherwise (a Pair error), address mode re-reads Paired: it may
        have flipped since consider(), and a bond from before the window is
        never deleted.
        """
        n = state["attempts"].get(path, 0)
        if mode == "address" and not made_here:
            try:
                _, now = dev_props(path)
                paired_now = bool(now.get("Paired", False))
            except dbus.DBusException as e:
                paired_now = paired_after_read_error(
                    e.get_dbus_name() if hasattr(e, "get_dbus_name") else None)
            if not may_remove_bond(mode, paired_now, made_here):
                state["busy"] = None
                emit("error", device=device, controllerId=cid, code="already-paired",
                     message="is paired now - left in place")
                finish("failed", paired=[], reason="pair-failed")
                return
        try:
            adapter.RemoveDevice(path)
        except dbus.DBusException:
            pass
        state["busy"] = None
        state["seen"].discard(path)
        if n < 2:
            emit("retry", device=device, controllerId=cid, code=code, message=message, attempt=n + 1)
            start_discovery()
            return
        emit("error", device=device, controllerId=cid, code=code, message=message)
        finish("failed", paired=[], reason="pair-failed")

    def wait_for_hid(path, device, cid, dev_iface, reconnected, bt_name, on_no_input=None):
        deadline = time.monotonic() + HID_WAIT_S
        emit("hid-wait", device=device, controllerId=cid, seconds=HID_WAIT_S)

        def poll():
            if state["result"] is not None:
                return False
            if input_device_present(read_input_devices(), device["address"], bt_name):
                emit("paired", device=device, controllerId=cid, connected=True, input=True)
                finish("paired", paired=[device])
                return False
            if time.monotonic() < deadline:
                return True
            if reconnected:
                if on_no_input is not None:
                    on_no_input()
                    return False
                if remove_after_no_input(path in state["made"]):
                    # This window's bond never became an input device: drop it
                    # so the next try pairs from scratch instead of skipping it.
                    try:
                        adapter.RemoveDevice(path)
                    except dbus.DBusException:
                        pass
                emit("error", device=device, controllerId=cid, code="no-input",
                     message="bonded, but no input device appeared")
                finish("failed", paired=[], reason="no-input")
                return False
            emit("hid-retry", device=device, controllerId=cid)
            try:
                dev_iface.Disconnect()
            except dbus.DBusException:
                pass
            GLib.timeout_add(2000, lambda: (connect(path, device, cid, dev_iface, True, bt_name, on_no_input), False)[1])
            return False

        GLib.timeout_add(500, poll)

    def connect(path, device, cid, dev_iface, reconnected, bt_name, on_no_input=None):
        emit("connecting", device=device, controllerId=cid, attempt=2 if reconnected else 1)

        def ok():
            wait_for_hid(path, device, cid, dev_iface, reconnected, bt_name, on_no_input)

        def err(e):
            # The device may connect back on its own; the input-device wait is the truth.
            emit("warn", device=device, message=f"Connect: {e.get_dbus_name() if hasattr(e, 'get_dbus_name') else e}")
            wait_for_hid(path, device, cid, dev_iface, reconnected, bt_name, on_no_input)

        dev_iface.Connect(reply_handler=ok, error_handler=err, timeout=30)

    def pair(path, props, target):
        device = describe(props, target)
        state["devices"][path] = device
        # BlueZ's own Name, for the input-device name fallback. Never the
        # config label or the address that describe() may put in device["name"].
        bt_name = str(props.get("Name", "") or "") or None
        cid = target.get("id")
        state["busy"] = path
        state["pins"][path] = target.get("pin") or DEFAULT_PIN
        state["attempts"][path] = state["attempts"].get(path, 0) + 1
        dev_obj = bus.get_object(BUS_NAME, path)
        dev_iface = dbus.Interface(dev_obj, "org.bluez.Device1")
        dprops = dbus.Interface(dev_obj, "org.freedesktop.DBus.Properties")
        emit("pairing", device=device, controllerId=cid, attempt=state["attempts"][path],
             pinConfigured=bool(target.get("pin")))

        def ok():
            state["made"].add(path)
            try:
                dprops.Set("org.bluez.Device1", "Trusted", dbus.Boolean(True))
                allp = dprops.GetAll("org.bluez.Device1")
            except dbus.DBusException as e:
                fail_device(path, device, cid, f"trust failed: {e}", made_here=True)
                return
            paired = bool(allp.get("Paired", False))
            bonded = bool(allp.get("Bonded", paired))
            if not (paired and bonded):
                fail_device(path, device, cid, "paired but not bonded - PIN refused",
                            made_here=True, code="auth-failed")
                return
            emit("bonded", device=device, controllerId=cid, trusted=True)
            # An LE device matched by Appearance/UUID may have had no Name yet
            # in consider(); prefer the fresh one.
            name_now = str(allp.get("Name", "") or "") or bt_name
            try:
                adapter.StopDiscovery()
            except dbus.DBusException:
                pass
            GLib.timeout_add(1000, lambda: (connect(path, device, cid, dev_iface, False, name_now), False)[1])

        def err(e):
            name = e.get_dbus_name() if hasattr(e, "get_dbus_name") else str(e)
            msg = f"{name}: {e.get_dbus_message() if hasattr(e, 'get_dbus_message') else ''}".strip(": ")
            code = error_code(name)
            if is_retryable(name, mode):
                fail_device(path, device, cid, msg, code=code)
            else:
                emit("error", device=device, controllerId=cid, code=code, message=msg)
                finish("failed", paired=[], reason="pair-failed")

        dev_iface.Pair(reply_handler=ok, error_handler=err, timeout=60)

    def on_old_bond_no_input(path, props, target):
        """connect-first did not bring the old bond up: replace it once."""
        state["replaced"].add(path)
        if not replace_old_bond(adapter, path, describe(props, target), target.get("id")):
            finish("failed", paired=[], reason="pair-failed")
            return
        state["busy"] = None
        state["seen"].discard(path)
        start_discovery()

    def consider(path, props):
        if state["result"] is not None or state["busy"] or not path.startswith(ADAPTER + "/dev_"):
            return
        if path in state["seen"]:
            return
        target = match(props, targets)
        if target is None:
            return
        state["seen"].add(path)
        action = candidate_action(props, mode)
        if action == "skip":
            return
        device = describe(props, target)
        state["candidates"] += 1
        emit("found", device=device, controllerId=target.get("id"))
        bt_name = str(props.get("Name", "") or "") or None
        if mode == "address":
            has_input = action == "already-connected" and \
                input_device_present(read_input_devices(), device["address"], bt_name)
            action = address_step(action, has_input, path in state["replaced"])
        if action == "done-paired":
            emit("already-paired", device=device, controllerId=target.get("id"))
            emit("paired", device=device, controllerId=target.get("id"), connected=True, input=True)
            finish("paired", paired=[device], reason="already-paired")
            return
        if action == "no-input":
            # Connected, but no input device: leave the bond alone.
            emit("error", device=device, controllerId=target.get("id"), code="no-input",
                 message="connected, but no input device appeared")
            finish("failed", paired=[], reason="no-input")
            return
        if action == "give-up":
            emit("error", device=device, controllerId=target.get("id"), code="unknown",
                 message="old bond still present after it was replaced")
            finish("failed", paired=[], reason="pair-failed")
            return
        if action == "connect-first":
            state["busy"] = path
            state["devices"][path] = device
            dev_iface = dbus.Interface(bus.get_object(BUS_NAME, path), "org.bluez.Device1")
            connect(path, device, target.get("id"), dev_iface, True, bt_name,
                    on_no_input=lambda: on_old_bond_no_input(path, props, target))
            return
        if action == "remove-stale" and path not in state["removed"]:
            # Repair mode only. Only reached from a LIVE inquiry result (see on_changed/on_added):
            # a bonded pad that is discoverable and not connected is in pairing
            # mode, i.e. it has forgotten us. The stored bond is stale.
            state["removed"].add(path)
            try:
                adapter.RemoveDevice(path)
            except dbus.DBusException:
                pass
            state["seen"].discard(path)
            emit("stale-bond-removed", device=device, controllerId=target.get("id"))
            start_discovery()
            return
        pair(path, props, target)

    def on_added(path, ifaces):
        if "org.bluez.Device1" in ifaces:
            props = ifaces["org.bluez.Device1"]
            if match(props, targets) is not None:
                emit("seen", device=describe(props, None))
            consider(str(path), props)

    def on_changed(iface, changed, invalidated, path=None):
        if iface != "org.bluez.Device1" or not path or path in state["seen"] or state["busy"]:
            return
        if "RSSI" not in changed and "Name" not in changed:
            return
        try:
            _, props = dev_props(path)
        except dbus.DBusException:
            return
        consider(path, props)

    bus.add_signal_receiver(on_added, dbus_interface="org.freedesktop.DBus.ObjectManager",
                            signal_name="InterfacesAdded")
    bus.add_signal_receiver(on_changed, dbus_interface="org.freedesktop.DBus.Properties",
                            signal_name="PropertiesChanged", path_keyword="path")

    try:
        adapter_props.Set("org.bluez.Adapter1", "Pairable", dbus.Boolean(True))
    except dbus.DBusException:
        pass
    try:
        adapter.SetDiscoveryFilter({"Transport": discovery_transport(mode)})
    except dbus.DBusException as e:
        emit("warn", message=f"SetDiscoveryFilter: {e}")
    emit("scanning", durationMs=duration_s * 1000, mode=mode)
    start_discovery()

    # Address mode: the person just saw this device live in the nearby list,
    # so its cached object is acted on at once (an old bond is only ever tried
    # first, never removed on cached state alone).
    if mode == "address":
        for path, ifaces in om.GetManagedObjects().items():
            if "org.bluez.Device1" in ifaces and str(path).startswith(ADAPTER + "/dev_"):
                if match(ifaces["org.bluez.Device1"], targets) is not None:
                    consider(str(path), ifaces["org.bluez.Device1"])
                    break

    # Repair mode only: cached devices are NOT candidates on their cached
    # properties (a cached RSSI is stale, and acting on it once removed a
    # working bond). They count only when this discovery reports them live
    # (RSSI change → on_changed). One exception: a configured pad that is
    # already bonded, connected and up as an input device means there is
    # nothing to do.
    for path, ifaces in (om.GetManagedObjects().items() if mode == "repair" else []):
        if "org.bluez.Device1" in ifaces and str(path).startswith(ADAPTER + "/dev_"):
            props = ifaces["org.bluez.Device1"]
            t = match(props, targets)
            if t is not None and t.get("id") and props.get("Paired") and props.get("Connected") \
                    and input_device_present(read_input_devices(), str(props.get("Address", ""))):
                device = describe(props, t)
                emit("already-paired", device=device, controllerId=t.get("id"))
                emit("paired", device=device, controllerId=t.get("id"), connected=True, input=True)
                finish("paired", paired=[device], reason="already-paired")
                break

    def timeout():
        if state["result"] is None and state["busy"] is None:
            finish("none", paired=[], reason="none-found" if state["candidates"] == 0 else "pair-failed")
            return False
        if state["result"] is None:
            return True  # let an in-flight pair/connect finish; it has its own timeouts
        return False

    GLib.timeout_add_seconds(duration_s, timeout)
    # Hard stop so a wedged D-Bus call can never hold the window open.
    GLib.timeout_add_seconds(duration_s + 120, lambda: (finish("timeout", paired=[], reason="timeout"), False)[1])
    try:
        if state["result"] is None:
            loop.run()
    finally:
        try:
            mgr.UnregisterAgent(AGENT_PATH)
        except dbus.DBusException:
            pass
    return 0 if state["result"] == "paired" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never die silently: the UI waits on a done
        emit("error", code="unknown", message=f"helper crashed: {e}")
        emit("done", paired=[], reason="helper-crashed")
        sys.exit(2)
