"""
Pure rules for bt_pair_helper: which Bluetooth devices a pairing window may
touch, and what counts as "up as an input device". No D-Bus imports, so the
rules are unit-tested (test/test_bt_pair_match.py).

Two modes:
  repair  re-pair a configured pad (default; the behaviour before 2026-11-20):
          classic-only discovery, gamepads only for unlisted devices, a bonded
          pad found discoverable has forgotten us so its stale bond is removed.
  add     add a device nobody configured: classic + LE discovery, any HID
          kind, and an existing bond is never touched.
"""
import re

GAMEPAD_NAME = re.compile(r"8bitdo|xbox|dualshock|dualsense|pro controller|gamepad|controller|joy-?con", re.I)
HID_UUIDS = {"00001812-0000-1000-8000-00805f9b34fb",  # HID over GATT (LE)
             "00001124-0000-1000-8000-00805f9b34fb"}  # HID (classic)
ICON_KIND = {"input-gaming": "gamepad", "input-keyboard": "keyboard",
             "input-mouse": "mouse", "input-tablet": "tablet"}
APPEARANCE_KIND = {0x03C1: "keyboard", 0x03C2: "mouse", 0x03C3: "gamepad", 0x03C4: "gamepad"}


def _name(props):
    return str(props.get("Name", props.get("Alias", "")) or "")


def classify_hid(props):
    """'gamepad' | 'keyboard' | 'mouse' | 'tablet' | 'remote' for an input device, else None."""
    icon = str(props.get("Icon", "") or "")
    if icon in ICON_KIND:
        return ICON_KIND[icon]
    cls = int(props.get("Class", 0) or 0)
    if ((cls >> 8) & 0x1F) == 0x05:  # major class: peripheral
        minor = (cls >> 2) & 0x3F
        if (minor & 0x0F) in (1, 2):
            return "gamepad"
        if (minor >> 4) in (1, 3):
            return "keyboard"
        if (minor >> 4) == 2:
            return "mouse"
        return "remote"
    appearance = int(props.get("Appearance", 0) or 0)
    if 0x03C0 <= appearance <= 0x03FF:  # LE appearance category: HID
        return APPEARANCE_KIND.get(appearance, "remote")
    uuids = {str(u).lower() for u in (props.get("UUIDs") or [])}
    if uuids & HID_UUIDS:
        return "remote"
    name = _name(props)
    if name and GAMEPAD_NAME.search(name):
        return "gamepad"
    return None


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


def match(props, targets, mode="repair"):
    """The matched target, a generic target for an acceptable unlisted device, or None."""
    addr = str(props.get("Address", "")).upper()
    name = _name(props)
    for t in targets:
        if t["prefix"] and addr.startswith(t["prefix"]):
            return t
        if t["name_re"] and name and t["name_re"].search(name):
            return t
    kind = classify_hid(props)
    if kind is None:
        return None
    if mode == "add" or kind == "gamepad" or (name and GAMEPAD_NAME.search(name)):
        return {"id": None, "label": None, "pin": None, "kind": kind}
    return None


def candidate_action(props, mode):
    """'pair' | 'remove-stale' | 'skip' for a device seen live in this discovery."""
    paired = bool(props.get("Paired", False))
    if paired and bool(props.get("Connected", False)):
        return "skip"  # in use: never break a working bond
    if paired:
        return "skip" if mode == "add" else "remove-stale"
    return "pair"


def discovery_transport(mode):
    return "auto" if mode == "add" else "bredr"


def input_device_present(proc_text, mac, name=None):
    """True when /proc/bus/input/devices lists an input device for this MAC.

    Falls back to an exact Name match only for a block whose Uniq is blank:
    some BLE (HID-over-GATT) stacks leave Uniq empty (unverified for the ring
    until it is checked on the garage box).
    """
    want = str(mac or "").lower()
    for block in str(proc_text or "").split("\n\n"):
        uniq, dev_name = None, None
        for line in block.splitlines():
            s = line.strip()
            if s.lower().startswith("u: uniq="):
                uniq = s[len("u: uniq="):].strip().lower()
            elif s.startswith('N: Name="') and s.endswith('"'):
                dev_name = s[len('N: Name="'):-1]
        if uniq and uniq == want:
            return True
        if not uniq and name and dev_name == name:
            return True
    return False
