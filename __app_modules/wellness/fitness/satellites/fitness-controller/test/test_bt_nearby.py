import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from bt_nearby import NearbyTracker, nearby_row, snapshot_key  # noqa: E402

RING = {"Address": "aa:bb:cc:11:22:33", "Name": "R1", "Appearance": 0x03C1, "RSSI": -60}
SPEAKER = {"Address": "11:22:33:44:55:66", "Name": "JBL Flip 5", "Icon": "audio-card", "RSSI": -70}
STRIP = {"Address": "22:33:44:55:66:77", "Name": "LED Controller", "RSSI": -50}


class Row(unittest.TestCase):
    def test_input_device(self):
        self.assertEqual(nearby_row(RING), {"address": "AA:BB:CC:11:22:33", "name": "R1", "kind": "keyboard",
                                            "hid": True, "rssi": -60, "paired": False, "connected": False})

    def test_name_alone_gives_no_kind(self):
        row = nearby_row(STRIP)
        self.assertFalse(row["hid"])
        self.assertIsNone(row["kind"])

    def test_no_address(self):
        self.assertIsNone(nearby_row({"Name": "x"}))


class Tracker(unittest.TestCase):
    def test_cached_devices_are_not_nearby_until_heard(self):
        t = NearbyTracker()
        t.update("/dev_ring", RING, now=0, live=False)
        self.assertEqual(t.snapshot(1), [])
        t.update("/dev_ring", {"RSSI": -58}, now=2, live=True)
        rows = t.snapshot(3)
        self.assertEqual([r["address"] for r in rows], ["AA:BB:CC:11:22:33"])
        self.assertEqual(rows[0]["rssi"], -58)          # merged with the cached props
        self.assertEqual(rows[0]["ageMs"], 1000)

    def test_rows_expire_when_not_heard(self):
        t = NearbyTracker(max_age_s=15)
        t.update("/dev_ring", RING, now=0, live=True)
        self.assertEqual(len(t.snapshot(15)), 1)
        self.assertEqual(t.snapshot(15.1), [])

    def test_strongest_first_and_forget(self):
        t = NearbyTracker()
        t.update("/dev_speaker", SPEAKER, now=0, live=True)
        t.update("/dev_strip", STRIP, now=0, live=True)
        self.assertEqual([r["name"] for r in t.snapshot(1)], ["LED Controller", "JBL Flip 5"])
        t.forget("/dev_strip")
        self.assertEqual([r["name"] for r in t.snapshot(1)], ["JBL Flip 5"])

    def test_snapshot_key_ignores_age(self):
        t = NearbyTracker()
        t.update("/dev_ring", RING, now=0, live=True)
        self.assertEqual(snapshot_key(t.snapshot(1)), snapshot_key(t.snapshot(5)))


if __name__ == "__main__":
    unittest.main()
