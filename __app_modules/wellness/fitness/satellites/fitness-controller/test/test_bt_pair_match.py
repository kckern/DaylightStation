import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from bt_pair_match import (  # noqa: E402
    classify_hid, compile_targets, match, candidate_action,
    discovery_transport, input_device_present, may_remove_bond, is_retryable,
    paired_after_read_error, hid_evidence, error_code, format_passkey, remove_after_no_input,
)

SFC30 = {"Address": "E4:17:D8:C6:54:F0", "Name": "8Bitdo SFC30 GamePad", "Icon": "input-gaming"}
TARGETS = compile_targets([{"id": "8bitdo_sfc30", "label": "8BitDo SFC30",
                            "name": "8Bitdo|SFC30", "macPrefix": "E4:17:D8"}])


class ClassifyHid(unittest.TestCase):
    def test_icons(self):
        self.assertEqual(classify_hid({"Icon": "input-gaming"}), "gamepad")
        self.assertEqual(classify_hid({"Icon": "input-keyboard"}), "keyboard")
        self.assertEqual(classify_hid({"Icon": "input-mouse"}), "mouse")
        self.assertEqual(classify_hid({"Icon": "input-tablet"}), "tablet")

    def test_classic_class_of_device(self):
        self.assertEqual(classify_hid({"Class": 0x002508}), "gamepad")   # peripheral / gamepad
        self.assertEqual(classify_hid({"Class": 0x002540}), "keyboard")  # peripheral / keyboard
        self.assertEqual(classify_hid({"Class": 0x002580}), "mouse")     # peripheral / pointing
        self.assertEqual(classify_hid({"Class": 0x00250C}), "remote")    # peripheral / remote control

    def test_le_appearance(self):
        self.assertEqual(classify_hid({"Appearance": 0x03C1}), "keyboard")
        self.assertEqual(classify_hid({"Appearance": 0x03C2}), "mouse")
        self.assertEqual(classify_hid({"Appearance": 0x03C4}), "gamepad")
        self.assertEqual(classify_hid({"Appearance": 0x03C0}), "remote")

    def test_hid_service_uuid(self):
        self.assertEqual(classify_hid({"UUIDs": ["00001812-0000-1000-8000-00805F9B34FB"]}), "remote")

    def test_gamepad_name_fallback(self):
        self.assertEqual(classify_hid({"Name": "Xbox Wireless Controller"}), "gamepad")

    def test_not_hid(self):
        self.assertIsNone(classify_hid({"Name": "JBL Flip 5", "Icon": "audio-card", "Class": 0x240414}))
        self.assertIsNone(classify_hid({"Name": "Polar H10 12345"}))


class Match(unittest.TestCase):
    def test_target_by_prefix_or_name(self):
        self.assertEqual(match(SFC30, TARGETS)["id"], "8bitdo_sfc30")

    def test_repair_mode_ignores_unlisted_keyboard(self):
        ring = {"Address": "11:22:33:44:55:66", "Name": "R1", "Icon": "input-keyboard"}
        self.assertIsNone(match(ring, TARGETS, "repair"))

    def test_repair_mode_accepts_combo_keyboard_gamepad_class(self):
        # Peripheral CoD with keyboard + gamepad minor: the pre-2026-11-20 rule accepted it.
        combo = {"Address": "AA:BB:CC:00:00:03", "Name": "Thing", "Icon": "input-keyboard", "Class": 0x002548}
        self.assertIsNotNone(match(combo, [], "repair"))

    def test_repair_mode_still_accepts_gamepad_name_alone(self):
        t = match({"Address": "AA:BB:CC:00:00:04", "Name": "LED Controller"}, [], "repair")
        self.assertIsNotNone(t)
        self.assertEqual(t["kind"], "gamepad")

    def test_repair_mode_keeps_generic_gamepad_name_rule(self):
        # A pad reporting a keyboard icon is still a pad in repair mode when its name says so.
        pad = {"Address": "AA:BB:CC:00:00:02", "Name": "Wireless Gamepad", "Icon": "input-keyboard"}
        self.assertIsNotNone(match(pad, [], "repair"))

    def test_gamepad_name_rule_names_no_brand(self):
        # Code never names a controller: a brand alone is not a gamepad name.
        self.assertIsNone(match({"Address": "AA:BB:CC:00:00:06", "Name": "8BitDo Zero 2"}, [], "repair"))


ADDR_TARGETS = compile_targets([{"id": None, "label": "R1", "address": "aa:bb:cc:11:22:33", "pin": "1234"}])


class AddressMode(unittest.TestCase):
    def test_compile_keeps_an_address_only_target(self):
        self.assertEqual(ADDR_TARGETS[0]["address"], "AA:BB:CC:11:22:33")
        self.assertEqual(ADDR_TARGETS[0]["pin"], "1234")

    def test_matches_exactly_that_address(self):
        ring = {"Address": "AA:BB:CC:11:22:33", "Name": "R1", "Icon": "input-keyboard"}
        self.assertEqual(match(ring, ADDR_TARGETS, "address")["label"], "R1")

    def test_matches_nothing_else_even_a_gamepad(self):
        self.assertIsNone(match(SFC30, ADDR_TARGETS, "address"))
        self.assertIsNone(match({"Address": "AA:BB:CC:11:22:34", "Name": "R1", "Icon": "input-keyboard"},
                                ADDR_TARGETS, "address"))

    def test_no_targets_matches_nothing(self):
        self.assertIsNone(match(SFC30, [], "address"))


class HidEvidence(unittest.TestCase):
    def test_evidence(self):
        self.assertTrue(hid_evidence({"Icon": "input-gaming"}))
        self.assertTrue(hid_evidence({"Icon": "input-dialpad"}))
        self.assertTrue(hid_evidence({"Class": 0x00250C}))
        self.assertTrue(hid_evidence({"Appearance": 0x03C0}))
        self.assertTrue(hid_evidence({"UUIDs": ["00001812-0000-1000-8000-00805F9B34FB"]}))

    def test_no_evidence(self):
        self.assertFalse(hid_evidence({"Name": "LED Controller"}))
        self.assertFalse(hid_evidence({"Name": "JBL Flip 5", "Icon": "audio-card", "Class": 0x240414}))
        self.assertFalse(hid_evidence({"Appearance": 0x0040}))

class CandidateAction(unittest.TestCase):
    def test_repair_mode(self):
        self.assertEqual(candidate_action({"Paired": True, "Connected": True}, "repair"), "skip")
        self.assertEqual(candidate_action({"Paired": True, "Connected": False}, "repair"), "remove-stale")
        self.assertEqual(candidate_action({}, "repair"), "pair")

    def test_address_mode(self):
        self.assertEqual(candidate_action({"Paired": True, "Connected": True}, "address"), "already-connected")
        # An old bond is tried first; it is only replaced if it does not come up.
        self.assertEqual(candidate_action({"Paired": True, "Connected": False}, "address"), "connect-first")
        self.assertEqual(candidate_action({"Paired": False}, "address"), "pair")


class BondSafety(unittest.TestCase):
    def test_may_remove_bond(self):
        self.assertTrue(may_remove_bond("repair", True, False))
        self.assertTrue(may_remove_bond("repair", False, False))
        self.assertTrue(may_remove_bond("address", False, False))
        # A bond that was there before this window is never removed after a Pair error.
        self.assertFalse(may_remove_bond("address", True, False))

    def test_half_made_bond_from_this_window_is_removed(self):
        self.assertTrue(may_remove_bond("address", True, True))
        self.assertTrue(may_remove_bond("repair", True, True))

    def test_read_error_fails_closed(self):
        # Only "the object is gone" means no bond; anything else counts as paired.
        self.assertFalse(paired_after_read_error("org.freedesktop.DBus.Error.UnknownObject"))
        self.assertFalse(paired_after_read_error("org.freedesktop.DBus.Error.UnknownMethod"))
        self.assertTrue(paired_after_read_error("org.freedesktop.DBus.Error.NoReply"))
        self.assertTrue(paired_after_read_error("org.freedesktop.DBus.Error.Timeout"))
        self.assertTrue(paired_after_read_error(None))

    def test_is_retryable(self):
        self.assertTrue(is_retryable("org.bluez.Error.AlreadyExists", "repair"))
        self.assertFalse(is_retryable("org.bluez.Error.AlreadyExists", "address"))
        self.assertTrue(is_retryable("org.bluez.Error.AuthenticationFailed", "address"))
        self.assertTrue(is_retryable("org.bluez.Error.InProgress", "repair"))
        self.assertFalse(is_retryable("org.bluez.Error.Failed", "repair"))
        self.assertFalse(is_retryable("", "address"))

    def test_no_input_removes_only_this_windows_bond(self):
        self.assertTrue(remove_after_no_input(True))
        self.assertFalse(remove_after_no_input(False))


class Transport(unittest.TestCase):
    def test_transport(self):
        self.assertEqual(discovery_transport("repair"), "bredr")
        self.assertEqual(discovery_transport("address"), "auto")


class ErrorCode(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(error_code("org.bluez.Error.AuthenticationFailed"), "auth-failed")
        self.assertEqual(error_code("org.bluez.Error.AuthenticationRejected"), "auth-failed")
        self.assertEqual(error_code("org.bluez.Error.AuthenticationCanceled"), "auth-canceled")
        self.assertEqual(error_code("org.bluez.Error.AuthenticationTimeout"), "timeout")
        self.assertEqual(error_code("org.freedesktop.DBus.Error.NoReply"), "timeout")
        self.assertEqual(error_code("org.bluez.Error.ConnectionAttemptFailed"), "unreachable")
        self.assertEqual(error_code("org.bluez.Error.AlreadyExists"), "already-paired")
        self.assertEqual(error_code("org.bluez.Error.InProgress"), "busy")
        self.assertEqual(error_code("org.bluez.Error.Failed"), "unknown")
        self.assertEqual(error_code(None), "unknown")


class Passkey(unittest.TestCase):
    def test_zero_padded_six_digits(self):
        self.assertEqual(format_passkey(4321), "004321")
        self.assertEqual(format_passkey(123456), "123456")


PROC = """I: Bus=0005 Vendor=2dc8 Product=2830 Version=0001
N: Name="8Bitdo SFC30 GamePad"
U: Uniq=e4:17:d8:c6:54:f0
H: Handlers=event5 js0

I: Bus=0005 Vendor=0000 Product=0000 Version=0000
N: Name="R1"
U: Uniq=
H: Handlers=kbd event6
"""


class InputDevicePresent(unittest.TestCase):
    def test_by_uniq(self):
        self.assertTrue(input_device_present(PROC, "E4:17:D8:C6:54:F0"))

    def test_name_fallback_only_when_uniq_blank(self):
        self.assertTrue(input_device_present(PROC, "11:22:33:44:55:66", "R1"))
        self.assertFalse(input_device_present(PROC, "11:22:33:44:55:66", "8Bitdo SFC30 GamePad"))

    def test_name_fallback_needs_bluetooth_bus(self):
        usb = 'I: Bus=0003 Vendor=0000 Product=0000 Version=0000\nN: Name="R1"\nU: Uniq=\nH: Handlers=kbd event7\n'
        self.assertFalse(input_device_present(usb, "11:22:33:44:55:66", "R1"))

    def test_name_fallback_when_no_uniq_line(self):
        bt = 'I: Bus=0005 Vendor=0000 Product=0000 Version=0000\nN: Name="R1"\nH: Handlers=kbd event7\n'
        self.assertTrue(input_device_present(bt, "11:22:33:44:55:66", "R1"))

    def test_absent(self):
        self.assertFalse(input_device_present(PROC, "11:22:33:44:55:66"))
        self.assertFalse(input_device_present("", "11:22:33:44:55:66", "R1"))


if __name__ == "__main__":
    unittest.main()
