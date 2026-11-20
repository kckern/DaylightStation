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
RETRYABLE = re.compile(r"AuthenticationFailed|AuthenticationRejected|AuthenticationCanceled|ConnectionAttemptFailed|Rejected|AlreadyExists|InProgress", re.I)
# Same map as ICON_KIND in btInventory.mjs; keep the two in step.
ICON_KIND = {"input-gaming": "gamepad", "input-keyboard": "keyboard",
             "input-mouse": "mouse", "input-tablet": "tablet"}
APPEARANCE_KIND = {0x03C1: "keyboard", 0x03C2: "mouse", 0x03C3: "gamepad", 0x03C4: "gamepad"}


def _peripheral_gamepad_class(props):
    """Classic CoD: major peripheral with a joystick/gamepad minor (combo pads included)."""
    cls = int(props.get("Class", 0) or 0)
    return ((cls >> 8) & 0x1F) == 0x05 and ((cls >> 2) & 0x0F) in (1, 2)


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


def hid_evidence(props):
    """True when BlueZ reports something that makes a device an input device:
    an `input-*` Icon, a peripheral Class of Device, an LE HID Appearance or a
    HID service UUID. A name alone is not evidence: a BLE light strip called
    "LED Controller" matches GAMEPAD_NAME."""
    if str(props.get("Icon", "") or "").startswith("input-"):
        return True
    cls = int(props.get("Class", 0) or 0)
    if ((cls >> 8) & 0x1F) == 0x05:
        return True
    appearance = int(props.get("Appearance", 0) or 0)
    if 0x03C0 <= appearance <= 0x03FF:
        return True
    uuids = {str(u).lower() for u in (props.get("UUIDs") or [])}
    return bool(uuids & HID_UUIDS)


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
    if mode == "add":
        # classify_hid falls back to the name; add mode accepts any HID kind,
        # so it needs real HID evidence first (repair mode keeps the name rule).
        if not hid_evidence(props):
            return None
        return {"id": None, "label": None, "pin": None, "kind": kind}
    if kind == "gamepad" or _peripheral_gamepad_class(props) \
            or (name and GAMEPAD_NAME.search(name)):
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


def may_remove_bond(mode, paired_now, made_here):
    """Whether a failed attempt may RemoveDevice.

    Add mode never deletes a bond that existed before this window. A bond the
    window's own Pair() just made (made_here) is half-made and is removed, or
    it would show as paired and every later add window would skip it.
    """
    return mode == "repair" or made_here or not paired_now


def paired_after_read_error(dbus_error_name):
    """Fail closed when re-reading Paired raises: only a vanished device object
    (UnknownObject/UnknownMethod) means no bond. NoReply or a timeout from a
    busy bluetoothd counts as paired, so the device is left alone."""
    name = str(dbus_error_name or "")
    return not name.endswith((".UnknownObject", ".UnknownMethod"))


def is_retryable(error_name, mode):
    """A Pair error worth remove-and-retry. In add mode AlreadyExists means the
    device is bonded already, so it is final (a retry would delete that bond)."""
    name = str(error_name or "")
    if not RETRYABLE.search(name):
        return False
    return not (mode == "add" and "alreadyexists" in name.lower())


def discovery_transport(mode):
    return "auto" if mode == "add" else "bredr"


def input_device_present(proc_text, mac, name=None):
    """True when /proc/bus/input/devices lists an input device for this MAC.

    Falls back to an exact match on BlueZ's Name only for a Bluetooth block
    (`I: Bus=0005`) whose Uniq is blank or missing: some BLE (HID-over-GATT)
    stacks leave Uniq empty (unverified for the ring until it is checked on
    the garage box).
    """
    want = str(mac or "").lower()
    for block in str(proc_text or "").split("\n\n"):
        uniq, dev_name, bluetooth = None, None, False
        for line in block.splitlines():
            s = line.strip()
            if s.startswith("I:"):
                bluetooth = "bus=0005" in s.lower()
            elif s.lower().startswith("u: uniq="):
                uniq = s[len("u: uniq="):].strip().lower()
            elif s.startswith('N: Name="') and s.endswith('"'):
                dev_name = s[len('N: Name="'):-1]
        if uniq and uniq == want:
            return True
        if not uniq and bluetooth and name and dev_name == name:
            return True
    return False
