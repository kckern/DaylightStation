#!/usr/bin/env python3
"""slot_link.py — status words, who gets reconnected, backoff, Keeper, Fix.

Fixture BlueZ states: the real GetManagedObjects captured from the hub
(tests/fixtures/bluez_managed_objects.json) plus hand-built records for the
edge cases (stale unpaired object beside a bond, speaker seen in a scan).

Run: python3 tests/test_slot_link.py   (or: python3 -m unittest tests.test_slot_link)
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import slot_link as sl  # noqa: E402

FIXTURE = (HERE / "fixtures" / "bluez_managed_objects.json").read_text()
RED, YELLOW, GREEN, BLUE = "41:42:3A:E5:43:07", "41:42:9A:E3:65:73", "41:42:F0:91:27:E8", "41:42:8D:B7:A0:11"
BULB, YOTO, WHITE = "9C:0C:35:75:B7:75", "E8:68:E7:34:55:8E", "41:42:93:7B:A9:F2"


def rec(mac, adapter="hci1", paired=True, connected=False, rssi=None, trusted=True):
    return {"path": f"/org/bluez/{adapter}/dev_{mac.replace(':', '_')}", "adapter": adapter,
            "mac": mac, "name": "x", "paired": paired, "bonded": paired, "trusted": trusted,
            "connected": connected, "rssi": rssi}


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


class FakeBlueZ:
    """Records every call; `connect_ok` decides Connect; `on_connect` may
    mutate records (the speaker answering)."""

    def __init__(self, records, connect_ok=False, err="org.bluez.Error.Failed: br-connection-page-timeout"):
        self.records = records
        self.connect_ok = connect_ok
        self.err = err
        self.calls = []
        self.fail_reads = False

    def devices(self):
        if self.fail_reads:
            raise RuntimeError("no bus")
        return [dict(r) for r in self.records]

    def connect(self, path, timeout=0):
        self.calls.append(("connect", path))
        if self.connect_ok:
            for r in self.records:
                if r["path"] == path:
                    r["connected"] = True
            return True, ""
        return False, self.err

    def connect_profile(self, path, uuid, timeout=0):
        self.calls.append(("connect_profile", path, uuid))
        return True, ""

    def pair(self, path, timeout=0):
        self.calls.append(("pair", path))
        for r in self.records:
            if r["path"] == path:
                r["paired"] = r["bonded"] = True
        return True, ""

    def set_trusted(self, path):
        self.calls.append(("trust", path))
        return True, ""

    def set_powered(self, hci, on):
        self.calls.append(("power", hci, on))
        return True, ""

    def start_discovery(self, hci):
        self.calls.append(("scan_on", hci))
        return True, ""

    def stop_discovery(self, hci):
        self.calls.append(("scan_off", hci))
        return True, ""

    def close(self):
        pass

    def kinds(self):
        return [c[0] for c in self.calls]


class FakePlayer:
    def __init__(self, script):
        self.script = list(script)   # successive probe() results; last repeats
        self.actions = []

    def alive(self, slot):
        return self.script[0]["alive"]

    def probe(self, slot):
        p = self.script[0]
        if len(self.script) > 1:
            self.script.pop(0)
        return dict({"paused": False, "time": None, "title": None, "sink_present": True}, **p)

    def unpause(self, slot):
        self.actions.append("unpause")

    def restart(self, slot):
        self.actions.append("restart")


def make_base(devices):
    base = Path(tempfile.mkdtemp())
    (base / ".devices.runtime.json").write_text(json.dumps({"devices": devices}))
    for d in devices:
        (base / "slots" / str(d["slot"])).mkdir(parents=True)
    return base


def events(base, slot):
    p = base / "slots" / str(slot) / "events.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []


class StatusWords(unittest.TestCase):
    def setUp(self):
        self.records = sl.parse_busctl_json(FIXTURE)

    def word(self, mac, alive=False, paused=False, ok=True, records=None):
        return sl.slot_state(ok, sl.slot_record(records or self.records, mac), alive, paused)

    def test_fixture_parses_every_adapter(self):
        self.assertEqual({r["adapter"] for r in self.records},
                         {"hci0", "hci1", "hci2", "hci3", "hci4", "hci7"})

    def test_connected_and_player_running_is_playing(self):
        self.assertEqual(self.word(GREEN, alive=True), "playing")

    def test_connected_without_player_or_paused_is_idle(self):
        self.assertEqual(self.word(BLUE, alive=False), "idle")
        self.assertEqual(self.word(BLUE, alive=True, paused=True), "idle")

    def test_bonded_but_not_connected_is_off_or_out_of_range(self):
        for mac in (RED, YELLOW, BULB, WHITE):
            self.assertEqual(self.word(mac), "absent", mac)

    def test_trusted_without_bond_is_not_paired(self):
        # The Yoto: Trusted survives, the link key doesn't.
        self.assertEqual(self.word(YOTO), "unpaired")

    def test_unknown_mac_is_not_paired(self):
        self.assertEqual(self.word("00:11:22:33:44:55"), "unpaired")

    def test_stale_unpaired_object_on_another_adapter_does_not_mask_the_bond(self):
        records = [rec(RED, "hci0", paired=False), rec(RED, "hci5", paired=True)]
        self.assertEqual(self.word(RED, records=records), "absent")
        self.assertEqual(sl.slot_record(records, RED)["adapter"], "hci5")

    def test_unreadable_bluez_is_never_reported_as_not_paired(self):
        self.assertEqual(self.word(RED, ok=False), "unknown")

    def test_words_are_the_owner_vocabulary(self):
        self.assertEqual([sl.STATUS_WORDS[k] for k in ("playing", "idle", "absent", "unpaired")],
                         ["Playing", "Connected – idle", "Speaker off or out of range", "Not paired"])

    def test_detail_for_a_chased_absent_slot_shows_the_backoff(self):
        out = sl.describe_slot({"slot": 1}, rec(RED), True, player_alive=False, paused=False,
                               link={"misses": 3, "next_at": 1030}, wants=(True, "schedule"), now=1000)
        self.assertEqual(out["status"], "Speaker off or out of range")
        self.assertIn("3 tries failed, next in 30 s", out["status_detail"])

    def test_detail_for_a_released_slot(self):
        out = sl.describe_slot({"slot": 6}, rec(YOTO), True, player_alive=False, paused=False,
                               wants=(False, "released"))
        self.assertIn("press Fix", out["status_detail"])

    def test_pairing_note_overrides_detail_while_fresh(self):
        note = {"state": "pairing", "at": 1000, "until": 1120}
        out = sl.describe_slot({"slot": 6}, None, True, player_alive=False, paused=False,
                               note=note, now=1030)
        self.assertEqual(out["status"], "Not paired")
        self.assertIn("90 s left", out["status_detail"])


class WhoGetsChased(unittest.TestCase):
    NOON = 12 * 60
    NIGHT = 23 * 60

    def test_static_queue_is_chased(self):
        self.assertEqual(sl.wants_link({"queue": "592904"}, now=0, now_min=self.NOON), (True, "queue"))

    def test_schedule_window(self):
        dev = {"queue": "", "schedules": [{"start": "07:00", "end": "21:00", "queue": "plex:1"}]}
        self.assertEqual(sl.wants_link(dev, now=0, now_min=self.NOON), (True, "schedule"))
        self.assertEqual(sl.wants_link(dev, now=0, now_min=self.NIGHT), (False, "nothing_to_play"))

    def test_adhoc_speaker_is_never_grabbed(self):
        self.assertEqual(sl.wants_link({"queue": ""}, now=0, now_min=self.NOON), (False, "nothing_to_play"))

    def test_live_override_is_chased_and_expired_one_is_not(self):
        dev = {"queue": ""}
        self.assertEqual(sl.wants_link(dev, armed={"queue": "1", "expires_at": 100}, now=50, now_min=0),
                         (True, "armed"))
        self.assertEqual(sl.wants_link(dev, armed={"queue": "1", "expires_at": 100}, now=150, now_min=0),
                         (False, "nothing_to_play"))

    def test_released_beats_everything(self):
        self.assertEqual(sl.wants_link({"queue": "1"}, released=True, now=0, now_min=0), (False, "released"))

    def test_public_only_when_armed(self):
        dev = {"class": "public", "queue": "1"}
        self.assertEqual(sl.wants_link(dev, now=0, now_min=0), (False, "shared"))
        self.assertEqual(sl.wants_link(dev, armed={"queue": "2"}, now=0, now_min=0), (True, "armed"))

    def test_wind_down_only_resumes_an_open_session(self):
        dev = {"queue": "1", "wind_down": {"fallback_queue": "2", "reconnect_seconds": 120}}
        self.assertEqual(sl.wants_link(dev, session=None, now=1000, now_min=0), (False, "no_session"))
        ended = {"phase": "ended", "disconnected_at": 990}
        self.assertEqual(sl.wants_link(dev, session=ended, now=1000, now_min=0), (False, "session_ended"))
        dropped = {"phase": "primary", "disconnected_at": 950}
        self.assertEqual(sl.wants_link(dev, session=dropped, now=1000, now_min=0), (True, "session"))
        stale = {"phase": "fallback", "disconnected_at": 800}
        self.assertEqual(sl.wants_link(dev, session=stale, now=1000, now_min=0), (False, "session_ended"))


class Backoff(unittest.TestCase):
    def test_fast_then_slower_never_beyond_a_minute(self):
        seq = [sl.backoff_sec(m) for m in range(1, 31)]
        self.assertTrue(all(10 <= s <= 15 for s in seq[:4]), seq[:4])
        self.assertEqual(seq[4], 30)
        self.assertEqual(max(seq), 60)
        self.assertEqual(seq, sorted(seq))

    def test_adapter_reset_is_bounded(self):
        self.assertEqual([m for m in range(1, 40) if sl.should_escalate(m)], [3, 6, 9, 12])


class KeeperLoop(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.devices = [
            {"slot": 1, "mac": RED, "name": "musiCozy", "queue": "674397"},
            {"slot": 6, "mac": YOTO, "name": "Yoto", "queue": ""},
            {"slot": 4, "mac": BLUE, "name": "Bandou", "queue": "592904"},
        ]
        self.base = make_base(self.devices)
        self.alerts = []

    def keeper(self, bz):
        return sl.Keeper(self.base, bz, clock=self.clock, sleep=self.clock.sleep,
                         alert=lambda *a: self.alerts.append(a), pscan=lambda hci: True, threaded=False)

    def test_attempts_follow_backoff_and_every_attempt_is_logged(self):
        bz = FakeBlueZ([rec(RED, "hci1"), rec(BLUE, "hci0", connected=True)])
        k = self.keeper(bz)
        attempts = []
        for _ in range(60):          # 60 × 4 s = 4 min of ticks
            if k.tick().get(1) == "attempt":
                attempts.append(self.clock.t)
            self.clock.sleep(sl.TICK_SEC)
        gaps = [round(b - a) for a, b in zip(attempts, attempts[1:])]
        self.assertTrue(all(12 <= g <= 16 for g in gaps[:4]), gaps)
        # 30 s backoff; +4 s on the ticks that also power-cycle the adapter
        self.assertTrue(all(30 <= g <= 40 for g in gaps[4:9]), gaps)
        fails = [e for e in events(self.base, 1) if e["evt"] == "bt.reconnect"]
        self.assertEqual(len(fails), len(attempts))
        self.assertEqual(fails[0]["result"], "fail")
        self.assertEqual(fails[0]["error"], "speaker didn't answer")
        self.assertEqual(fails[0]["adapter"], "hci1")
        # Never pairs, never removes; connects only RED's bonded path.
        self.assertEqual(set(bz.kinds()) - {"power"}, {"connect"})
        self.assertTrue(all(c[1].startswith("/org/bluez/hci1/") for c in bz.calls if c[0] == "connect"))

    def test_adapter_reset_only_when_no_other_speaker_is_on_it(self):
        bz = FakeBlueZ([rec(RED, "hci0"), rec(BLUE, "hci0", connected=True)])
        k = self.keeper(bz)
        for _ in range(40):
            k.tick()
            self.clock.sleep(sl.TICK_SEC)
        self.assertNotIn("power", bz.kinds())   # BLUE is playing on hci0
        bz2 = FakeBlueZ([rec(RED, "hci1"), rec(BLUE, "hci0", connected=True)])
        self.base = make_base(self.devices)
        k2 = self.keeper(bz2)
        for _ in range(40):
            k2.tick()
            self.clock.sleep(sl.TICK_SEC)
        self.assertIn(("power", "hci1", False), bz2.calls)

    def test_speaker_switched_on_is_connected_and_recovery_logged(self):
        bz = FakeBlueZ([rec(RED, "hci1")])
        k = self.keeper(bz)
        for _ in range(10):
            k.tick()
            self.clock.sleep(sl.TICK_SEC)
        bz.connect_ok = True                     # speaker comes into range
        for _ in range(10):
            k.tick()
            self.clock.sleep(sl.TICK_SEC)
        evts = [e["evt"] + ":" + e.get("result", "") for e in events(self.base, 1)]
        self.assertIn("bt.reconnect:ok", evts)
        self.assertIn("bt.reconnect_recovered:", evts)
        self.assertEqual(k.tick()[1], "connected")
        link = json.loads((self.base / "slots/1/.link.json").read_text())
        self.assertEqual(link["misses"], 0)

    def test_unpaired_and_nothing_to_play_are_left_alone(self):
        bz = FakeBlueZ([rec(YOTO, "hci4", paired=False)])
        self.devices[1]["queue"] = "1"        # even with a queue, no bond → no Connect
        (self.base / ".devices.runtime.json").write_text(json.dumps({"devices": self.devices}))
        acts = self.keeper(bz).tick()
        self.assertEqual(acts[6], "unpaired")
        self.assertNotIn("connect", bz.kinds())

    def test_released_slot_is_not_chased(self):
        (self.base / "slots/1/.released").write_text("")
        bz = FakeBlueZ([rec(RED, "hci1")])
        self.assertEqual(self.keeper(bz).tick()[1], "idle:released")
        self.assertEqual(bz.calls, [])

    def test_unreadable_bluez_does_nothing(self):
        bz = FakeBlueZ([rec(RED)])
        bz.fail_reads = True
        self.assertEqual(self.keeper(bz).tick(), {})

    def test_alert_once_only_when_a_schedule_wants_it(self):
        self.devices[0]["schedules"] = [{"start": "00:00", "end": "00:00", "queue": "plex:1"}]
        (self.base / ".devices.runtime.json").write_text(json.dumps({"devices": self.devices}))
        bz = FakeBlueZ([rec(RED, "hci1")])
        k = self.keeper(bz)
        for _ in range(80):
            k.tick()
            self.clock.sleep(sl.TICK_SEC)
        self.assertEqual(len(self.alerts), 1)


class Fix(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.dev = {"slot": 1, "mac": RED, "name": "musiCozy", "queue": "674397", "color": "red"}
        self.base = make_base([self.dev])

    def fix(self, bz, player, **kw):
        return sl.fix_slot(self.base, self.dev, bz, player, clock=self.clock, sleep=self.clock.sleep, **kw)

    def test_paired_but_off_reports_truthfully_after_a_real_attempt(self):
        bz = FakeBlueZ([rec(RED, "hci1")])
        out = self.fix(bz, FakePlayer([{"alive": False}]))
        self.assertFalse(out["ok"])
        self.assertEqual(out["code"], "absent")
        self.assertIn("Couldn't reach the speaker (speaker didn't answer)", out["result"])
        self.assertEqual(bz.kinds().count("connect"), 2)        # once, reset, once more
        self.assertIn(("power", "hci1", False), bz.calls)
        self.assertNotIn("pair", bz.kinds())
        evts = [e["evt"] for e in events(self.base, 1)]
        self.assertEqual(evts[0], "fix.start")
        self.assertEqual(evts[-1], "fix.result")

    def test_fix_clears_a_hand_back_and_resets_backoff(self):
        (self.base / "slots/1/.released").write_text("")
        (self.base / "slots/1/.link.json").write_text(json.dumps({"misses": 20, "next_at": 9e9}))
        self.fix(FakeBlueZ([rec(RED, "hci1")]), FakePlayer([{"alive": False}]))
        self.assertFalse((self.base / "slots/1/.released").exists())
        self.assertEqual(json.loads((self.base / "slots/1/.link.json").read_text())["misses"], 0)

    def test_reconnects_then_confirms_audio_is_moving(self):
        bz = FakeBlueZ([rec(RED, "hci1")], connect_ok=True)
        player = FakePlayer([{"alive": False}, {"alive": True, "time": 1.0, "title": "Lullaby"},
                             {"alive": True, "time": 2.5, "title": "Lullaby"}])
        out = self.fix(bz, player)
        self.assertEqual((out["ok"], out["code"], out["result"]), (True, "playing", "Playing: Lullaby"))

    def test_paused_player_is_unpaused(self):
        bz = FakeBlueZ([rec(RED, "hci1", connected=True)])
        player = FakePlayer([{"alive": True, "paused": True, "time": 5.0},
                             {"alive": True, "time": 5.0}, {"alive": True, "time": 6.5, "title": "T"}])
        out = self.fix(bz, player)
        self.assertEqual(player.actions, ["unpause"])
        self.assertEqual(out["code"], "playing")
        self.assertNotIn("connect", bz.kinds())

    def test_missing_sink_restarts_the_audio_profile_and_player(self):
        bz = FakeBlueZ([rec(RED, "hci1", connected=True)])
        player = FakePlayer([{"alive": True, "sink_present": False, "time": 3.0},
                             {"alive": True, "time": 0.0}, {"alive": True, "time": 1.0, "title": "T"}])
        out = self.fix(bz, player)
        self.assertIn("connect_profile", bz.kinds())
        self.assertEqual(player.actions, ["restart"])
        self.assertEqual(out["code"], "playing")

    def test_stalled_player_is_restarted_once(self):
        bz = FakeBlueZ([rec(RED, "hci1", connected=True)])
        player = FakePlayer([{"alive": True, "time": 7.0}])
        out = self.fix(bz, player, play_wait=40)
        self.assertEqual(player.actions, ["restart"])
        self.assertEqual(out["code"], "stuck")
        self.assertFalse(out["ok"])

    def test_connected_slot_with_nothing_to_play_says_so(self):
        self.dev["queue"] = ""
        out = self.fix(FakeBlueZ([rec(RED, "hci1", connected=True)]), FakePlayer([{"alive": False}]))
        self.assertEqual((out["ok"], out["code"]), (True, "idle"))
        self.assertIn("nothing is set to play", out["result"])

    def test_not_paired_asks_for_the_button_and_starts_the_bounded_pairing(self):
        started = []
        out = self.fix(FakeBlueZ([rec(RED, "hci4", paired=False)]), FakePlayer([{"alive": False}]),
                       pair_starter=started.append)
        self.assertEqual(out["code"], "pairing")
        self.assertTrue(out["result"].startswith("Hold the speaker's pairing button"))
        self.assertEqual(started, [self.dev])

    def test_pair_job_pairs_trusts_and_connects_once_the_speaker_shows(self):
        records = [rec(RED, "hci4", paired=False, trusted=True), rec(BLUE, "hci0", connected=True)]
        bz = FakeBlueZ(records, connect_ok=True)
        ticks = {"n": 0}

        def sleep(s):
            self.clock.sleep(s)
            ticks["n"] += 1
            if ticks["n"] == 5:          # owner holds the button ~10 s in
                records[0]["rssi"] = -60
        msg = sl.pair_job(self.base, self.dev, lambda: bz, clock=self.clock, sleep=sleep,
                          configured_macs={RED, BLUE})
        self.assertTrue(msg.startswith("Paired and connected"), msg)
        self.assertEqual([k for k in bz.kinds()], ["scan_on", "scan_off", "pair", "trust", "connect", "scan_off"])
        self.assertTrue(all(c[1] == "hci4" or c[1].startswith("/org/bluez/hci4/") for c in bz.calls))

    def test_pair_job_gives_up_after_the_window(self):
        bz = FakeBlueZ([rec(RED, "hci4", paired=False)])
        msg = sl.pair_job(self.base, self.dev, lambda: bz, clock=self.clock, sleep=self.clock.sleep)
        self.assertIn("Didn't see the speaker in 2 minutes", msg)
        self.assertNotIn("pair", bz.kinds())
        note = json.loads((self.base / "slots/1/.fix.json").read_text())
        self.assertEqual(note["state"], "failed")

    def test_pair_adapter_choice_prefers_existing_object_then_a_free_adapter(self):
        records = [rec(BLUE, "hci0"), rec(RED, "hci1"), rec("AA:BB:CC:DD:EE:FF", "hci2", paired=False)]
        self.assertEqual(sl.choose_pair_adapter(records, RED, {RED, BLUE}), "hci1")
        self.assertEqual(sl.choose_pair_adapter(records, YOTO, {RED, BLUE, YOTO}), "hci2")


if __name__ == "__main__":
    unittest.main(verbosity=1)
