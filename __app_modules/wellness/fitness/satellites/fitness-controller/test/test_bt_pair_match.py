import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from bt_pair_match import (  # noqa: E402
    classify_hid, compile_targets, match, candidate_action,
    discovery_transport, input_device_present,
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

    def test_add_mode_accepts_unlisted_keyboard_with_kind(self):
        ring = {"Address": "11:22:33:44:55:66", "Name": "R1", "Icon": "input-keyboard"}
        t = match(ring, TARGETS, "add")
        self.assertIsNone(t["id"])
        self.assertEqual(t["kind"], "keyboard")

    def test_add_mode_still_rejects_non_hid(self):
        self.assertIsNone(match({"Address": "AA:BB:CC:00:00:01", "Name": "JBL Flip 5", "Icon": "audio-card"}, [], "add"))

    def test_repair_mode_keeps_gamepad_name_rule(self):
        # An 8BitDo reporting a keyboard icon is still a pad in repair mode (old behaviour).
        pad = {"Address": "AA:BB:CC:00:00:02", "Name": "8BitDo Zero 2", "Icon": "input-keyboard"}
        self.assertIsNotNone(match(pad, [], "repair"))


class CandidateAction(unittest.TestCase):
    def test_connected_bond_is_never_touched(self):
        self.assertEqual(candidate_action({"Paired": True, "Connected": True}, "repair"), "skip")
        self.assertEqual(candidate_action({"Paired": True, "Connected": True}, "add"), "skip")

    def test_unconnected_bond(self):
        self.assertEqual(candidate_action({"Paired": True, "Connected": False}, "repair"), "remove-stale")
        self.assertEqual(candidate_action({"Paired": True, "Connected": False}, "add"), "skip")

    def test_new_device(self):
        self.assertEqual(candidate_action({"Paired": False}, "add"), "pair")
        self.assertEqual(candidate_action({}, "repair"), "pair")


class Transport(unittest.TestCase):
    def test_transport(self):
        self.assertEqual(discovery_transport("repair"), "bredr")
        self.assertEqual(discovery_transport("add"), "auto")


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

    def test_absent(self):
        self.assertFalse(input_device_present(PROC, "11:22:33:44:55:66"))
        self.assertFalse(input_device_present("", "11:22:33:44:55:66", "R1"))


if __name__ == "__main__":
    unittest.main()
