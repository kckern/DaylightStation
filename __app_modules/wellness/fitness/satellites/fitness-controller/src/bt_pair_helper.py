#!/usr/bin/env python3
"""
bt_pair_helper — one controller-pairing window over BlueZ D-Bus.

Spawned by btPairing.mjs with one JSON argument:
  {"targets": [{"id","label","name","macPrefix","pin"}], "durationMs": 60000}

Prints one JSON object per line, one per lifecycle transition, which the Node
side relays as `bt.pair.progress`:

  scanning → seen* → found → [stale-bond-removed] → pairing → [retry]
           → bonded → connecting → hid-wait → [hid-retry] → paired → done
  any stage → error → done          nothing seen → done {reason:"none-found"}

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
import re
import sys
import time

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

BUS_NAME = "org.bluez"
ADAPTER = "/org/bluez/hci0"
AGENT_PATH = "/net/daylight/btpair/agent"
DEFAULT_PIN = "0000"
HID_WAIT_S = 15
RETRYABLE = re.compile(r"AuthenticationFailed|AuthenticationRejected|AuthenticationCanceled|ConnectionAttemptFailed|Rejected|AlreadyExists|InProgress", re.I)
GAMEPAD_NAME = re.compile(r"8bitdo|xbox|dualshock|dualsense|pro controller|gamepad|controller|joy-?con", re.I)


def emit(phase, **extra):
    print(json.dumps({"phase": phase, **extra}), flush=True)


def has_input_device(mac):
    want = mac.lower()
    try:
        with open("/proc/bus/input/devices", "r", encoding="utf-8") as f:
            for line in f:
                low = line.strip().lower()
                if low.startswith("u: uniq=") and low[len("u: uniq="):].strip() == want:
                    return True
    except OSError:
        return False
    return False


def compile_targets(raw):
    out = []
    for t in raw or []:
        if not isinstance(t, dict):
            continue
        name_re = None
        if t.get("name"):
            try:
                name_re = re.compile(str(t["name"]), re.I)
            except re.error:
                name_re = None
        prefix = str(t.get("macPrefix") or "").upper() or None
        if not name_re and not prefix:
            continue
        pin = t.get("pin")
        out.append({"id": t.get("id"), "label": t.get("label"), "name_re": name_re,
                    "prefix": prefix, "pin": str(pin) if pin not in (None, "") else None})
    return out


def match(props, targets):
    """Return the matched target dict, a generic {} for an unlisted gamepad, or None."""
    addr = str(props.get("Address", "")).upper()
    name = str(props.get("Name", props.get("Alias", "")))
    for t in targets:
        if t["prefix"] and addr.startswith(t["prefix"]):
            return t
        if t["name_re"] and name and t["name_re"].search(name):
            return t
    icon = str(props.get("Icon", ""))
    cls = int(props.get("Class", 0) or 0)
    if icon == "input-gaming" or (((cls >> 8) & 0x1F) == 0x05 and ((cls >> 2) & 0x0F) in (1, 2)):
        return {"id": None, "label": None, "pin": None}
    if name and GAMEPAD_NAME.search(name):
        return {"id": None, "label": None, "pin": None}
    return None


class Agent(dbus.service.Object):
    """Default agent for the window: PIN from config, SSP just-works."""

    def __init__(self, bus, path, pin_for):
        super().__init__(bus, path)
        self.pin_for = pin_for

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
    duration_s = max(5, int(args.get("durationMs", 60000)) // 1000)

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    loop = GLib.MainLoop()
    adapter_obj = bus.get_object(BUS_NAME, ADAPTER)
    adapter = dbus.Interface(adapter_obj, "org.bluez.Adapter1")
    adapter_props = dbus.Interface(adapter_obj, "org.freedesktop.DBus.Properties")
    om = dbus.Interface(bus.get_object(BUS_NAME, "/"), "org.freedesktop.DBus.ObjectManager")

    state = {"busy": None, "pins": {}, "attempts": {}, "seen": set(), "candidates": 0,
             "result": None, "removed": set()}

    def pin_for(path):
        return state["pins"].get(path) or DEFAULT_PIN

    Agent(bus, AGENT_PATH, pin_for)
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
        return {"address": str(props.get("Address", "")),
                "name": str(props.get("Name", "") or (target or {}).get("label") or props.get("Address", ""))}

    def fail_device(path, device, cid, message):
        """Remove the half-made bond and retry once; second failure is final."""
        n = state["attempts"].get(path, 0)
        try:
            adapter.RemoveDevice(path)
        except dbus.DBusException:
            pass
        state["busy"] = None
        state["seen"].discard(path)
        if n < 2:
            emit("retry", device=device, controllerId=cid, message=message, attempt=n + 1)
            start_discovery()
            return
        emit("error", device=device, controllerId=cid, message=message)
        finish("failed", paired=[], reason="pair-failed")

    def wait_for_hid(path, device, cid, dev_iface, reconnected):
        deadline = time.monotonic() + HID_WAIT_S
        emit("hid-wait", device=device, controllerId=cid, seconds=HID_WAIT_S)

        def poll():
            if state["result"] is not None:
                return False
            if has_input_device(device["address"]):
                emit("paired", device=device, controllerId=cid, connected=True, input=True)
                finish("paired", paired=[device])
                return False
            if time.monotonic() < deadline:
                return True
            if reconnected:
                emit("error", device=device, controllerId=cid,
                     message="bonded, but the controller never came up as an input device - turn it off and on (START)")
                finish("failed", paired=[], reason="no-input")
                return False
            emit("hid-retry", device=device, controllerId=cid)
            try:
                dev_iface.Disconnect()
            except dbus.DBusException:
                pass
            GLib.timeout_add(2000, lambda: (connect(path, device, cid, dev_iface, True), False)[1])
            return False

        GLib.timeout_add(500, poll)

    def connect(path, device, cid, dev_iface, reconnected):
        emit("connecting", device=device, controllerId=cid, attempt=2 if reconnected else 1)

        def ok():
            wait_for_hid(path, device, cid, dev_iface, reconnected)

        def err(e):
            # The pad may connect back on its own (it initiates on wake); the
            # input-device wait is still the truth.
            emit("warn", device=device, message=f"Connect: {e.get_dbus_name() if hasattr(e, 'get_dbus_name') else e}")
            wait_for_hid(path, device, cid, dev_iface, reconnected)

        dev_iface.Connect(reply_handler=ok, error_handler=err, timeout=30)

    def pair(path, props, target):
        device = describe(props, target)
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
            try:
                dprops.Set("org.bluez.Device1", "Trusted", dbus.Boolean(True))
                allp = dprops.GetAll("org.bluez.Device1")
            except dbus.DBusException as e:
                fail_device(path, device, cid, f"trust failed: {e}")
                return
            paired = bool(allp.get("Paired", False))
            bonded = bool(allp.get("Bonded", paired))
            if not (paired and bonded):
                fail_device(path, device, cid, "paired but not bonded - the controller refused the PIN")
                return
            emit("bonded", device=device, controllerId=cid, trusted=True)
            try:
                adapter.StopDiscovery()
            except dbus.DBusException:
                pass
            GLib.timeout_add(1000, lambda: (connect(path, device, cid, dev_iface, False), False)[1])

        def err(e):
            name = e.get_dbus_name() if hasattr(e, "get_dbus_name") else str(e)
            msg = f"{name}: {e.get_dbus_message() if hasattr(e, 'get_dbus_message') else ''}".strip(": ")
            if RETRYABLE.search(name or ""):
                fail_device(path, device, cid, msg)
            else:
                emit("error", device=device, controllerId=cid, message=msg)
                finish("failed", paired=[], reason="pair-failed")

        dev_iface.Pair(reply_handler=ok, error_handler=err, timeout=60)

    def consider(path, props):
        if state["result"] is not None or state["busy"] or not path.startswith(ADAPTER + "/dev_"):
            return
        if path in state["seen"]:
            return
        target = match(props, targets)
        if target is None:
            return
        state["seen"].add(path)
        if bool(props.get("Paired", False)) and bool(props.get("Connected", False)):
            # In use already — never break a working bond. Not a pairing candidate.
            return
        device = describe(props, target)
        state["candidates"] += 1
        emit("found", device=device, controllerId=target.get("id"))
        if bool(props.get("Paired", False)) and path not in state["removed"]:
            # Only reached from a LIVE inquiry result (see on_changed/on_added):
            # a bonded pad that is discoverable and not connected is in pairing
            # mode, i.e. it has forgotten us — the stored bond is stale.
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
        adapter.SetDiscoveryFilter({"Transport": "bredr"})
    except dbus.DBusException as e:
        emit("warn", message=f"SetDiscoveryFilter: {e}")
    emit("scanning", durationMs=duration_s * 1000)
    start_discovery()

    # Cached devices are NOT candidates on their cached properties (a cached
    # RSSI is stale, and acting on it once removed a working bond). They count
    # only when this discovery reports them live (RSSI change → on_changed).
    # One exception: a configured pad that is already bonded, connected and
    # up as an input device means there is nothing to do.
    for path, ifaces in om.GetManagedObjects().items():
        if "org.bluez.Device1" in ifaces and str(path).startswith(ADAPTER + "/dev_"):
            props = ifaces["org.bluez.Device1"]
            t = match(props, targets)
            if t is not None and t.get("id") and props.get("Paired") and props.get("Connected") \
                    and has_input_device(str(props.get("Address", ""))):
                device = describe(props, t)
                emit("already-paired", device=device, controllerId=t.get("id"))
                emit("paired", device=device, controllerId=t.get("id"), connected=True, input=True)
                finish("paired", paired=[device])
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
        emit("error", message=f"helper crashed: {e}")
        emit("done", paired=[], reason="helper-crashed")
        sys.exit(2)
