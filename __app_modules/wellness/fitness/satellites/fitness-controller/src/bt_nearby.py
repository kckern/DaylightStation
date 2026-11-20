"""
Pure nearby-device list for the Bluetooth screen's search (bt_scan_helper.py).
No D-Bus imports, so it is unit-tested (test/test_bt_nearby.py).

A device is nearby only while BlueZ reports it live in this discovery: a new
device object, or a change to its RSSI or advertising data. A cached device
object (BlueZ remembers devices it saw earlier) is listed only once it is
heard, never on its cached RSSI. A row drops out MAX_AGE_S after the last
report.
"""
from bt_pair_match import classify_hid, hid_evidence

MAX_AGE_S = 15


def nearby_row(props):
    addr = str(props.get("Address", "") or "").upper()
    if not addr:
        return None
    evidence = hid_evidence(props)
    rssi = props.get("RSSI")
    return {
        "address": addr,
        "name": str(props.get("Name", "") or ""),
        "kind": classify_hid(props) if evidence else None,
        "hid": evidence,
        "rssi": int(rssi) if rssi is not None else None,
        "paired": bool(props.get("Paired", False)),
        "connected": bool(props.get("Connected", False)),
    }


class NearbyTracker:
    """Device props merged per D-Bus object path, and when each was last heard."""

    def __init__(self, max_age_s=MAX_AGE_S):
        self.max_age_s = max_age_s
        self.props = {}
        self.heard = {}

    def update(self, key, props, now, live):
        self.props[key] = {**self.props.get(key, {}), **dict(props)}
        if live:
            self.heard[key] = now

    def forget(self, key):
        self.props.pop(key, None)
        self.heard.pop(key, None)

    def snapshot(self, now):
        rows = []
        for key, at in self.heard.items():
            age = now - at
            if age > self.max_age_s:
                continue
            row = nearby_row(self.props.get(key, {}))
            if row:
                row["ageMs"] = int(round(age * 1000))
                rows.append(row)
        rows.sort(key=lambda r: (r["rssi"] is None, -(r["rssi"] or 0), r["address"]))
        return rows


def snapshot_key(rows):
    """What changed between two snapshots, ignoring how old each report is."""
    return [(r["address"], r["name"], r["kind"], r["rssi"], r["paired"], r["connected"]) for r in rows]
