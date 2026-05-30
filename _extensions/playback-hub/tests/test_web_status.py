#!/usr/bin/env python3
"""Unit G: web.py postmortem status fields.

Tests the three new, pure, defensive field-computation helpers in web.py
(file_playlist_count, last_reconcile, integrity_failures) plus their wiring
into slot_status. Stdlib + the project's own web module only — no server is
started (web.py only binds a socket under `if __name__ == "__main__"`).

Run: python3 tests/test_web_status.py
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import web  # noqa: E402

FAILED = 0
RAN = 0


def check(cond, msg):
    global FAILED, RAN
    RAN += 1
    if not cond:
        FAILED += 1
        print(f"  FAIL: {msg}")


def iso(epoch):
    import datetime
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat()


# --- file_playlist_count -----------------------------------------------------
with tempfile.TemporaryDirectory() as td:
    tdp = Path(td)
    pl = tdp / "playlist.m3u"
    pl.write_text(
        "#EXTM3U\n"
        "#EXTINF:-1,Song A\n"
        "/home/kckern/playback-hub/cache/100.mp3\n"
        "#EXTINF:-1,Song B\n"
        "/home/kckern/playback-hub/cache/200.mp3\n"
        "#EXTINF:-1,Song C\n"
        "/home/kckern/playback-hub/cache/300.mp3\n"
    )
    check(web.file_playlist_count(pl) == 3, "file_playlist_count counts 3 cache paths")
    check(web.file_playlist_count(tdp / "missing.m3u") == 0,
          "file_playlist_count missing file -> 0")
    (tdp / "empty.m3u").write_text("#EXTM3U\n")
    check(web.file_playlist_count(tdp / "empty.m3u") == 0,
          "file_playlist_count header-only -> 0")


# --- last_reconcile ----------------------------------------------------------
with tempfile.TemporaryDirectory() as td:
    tdp = Path(td)
    ev = tdp / "events.jsonl"
    now = time.time()
    lines = [
        {"ts": iso(now - 300), "evt": "playlist.reconciled", "slot": 1},
        {"ts": iso(now - 200), "evt": "track.start", "slot": 1},
        {"ts": iso(now - 100), "evt": "playback.reconciled", "slot": 1},  # latest reconcile
        {"ts": iso(now - 50), "evt": "bg.complete", "slot": 1},
    ]
    ev.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    got = web.last_reconcile(ev)
    check(got == iso(now - 100),
          f"last_reconcile picks newest reconcile ts (got {got})")
    check(web.last_reconcile(tdp / "missing.jsonl") is None,
          "last_reconcile missing file -> None")

    # No reconcile events present -> None
    ev2 = tdp / "events2.jsonl"
    ev2.write_text(json.dumps({"ts": iso(now), "evt": "track.start"}) + "\n")
    check(web.last_reconcile(ev2) is None, "last_reconcile no reconcile evts -> None")

    # Garbage lines are skipped, not fatal
    ev3 = tdp / "events3.jsonl"
    ev3.write_text("not json\n" + json.dumps(
        {"ts": iso(now), "evt": "playlist.reconciled"}) + "\n{partial\n")
    check(web.last_reconcile(ev3) == iso(now),
          "last_reconcile tolerates garbage lines")


# --- integrity_failures ------------------------------------------------------
with tempfile.TemporaryDirectory() as td:
    tdp = Path(td)
    ev = tdp / "events.jsonl"
    now = time.time()
    lines = [
        {"ts": iso(now - 7200), "evt": "cache.integrity_fail", "slot": 1},  # 2h ago -> out
        {"ts": iso(now - 1800), "evt": "cache.integrity_fail", "slot": 1},  # 30m -> in
        {"ts": iso(now - 60), "evt": "cache.integrity_fail", "slot": 1},    # 1m -> in
        {"ts": iso(now - 30), "evt": "cache.download", "slot": 1},          # wrong evt
    ]
    ev.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    got = web.integrity_failures(ev, now=now)
    check(got == 2, f"integrity_failures counts 2 within last hour (got {got})")
    check(web.integrity_failures(tdp / "missing.jsonl", now=now) == 0,
          "integrity_failures missing file -> 0")

    ev2 = tdp / "events2.jsonl"
    ev2.write_text(json.dumps({"ts": iso(now), "evt": "track.start"}) + "\n")
    check(web.integrity_failures(ev2, now=now) == 0,
          "integrity_failures no integrity evts -> 0")


# --- slot_status integration -------------------------------------------------
# Point web.SLOTS_DIR at a temp tree, craft a slot's files, and confirm the
# three new keys are populated. Device is not playing (no mpv socket), so the
# IPC fields are None — exactly the postmortem case the fields exist for.
with tempfile.TemporaryDirectory() as td:
    tdp = Path(td)
    orig = web.SLOTS_DIR
    try:
        web.SLOTS_DIR = tdp
        sd = tdp / "2"
        sd.mkdir()
        (sd / "playlist.m3u").write_text(
            "#EXTM3U\n#EXTINF:-1,A\n/cache/1.mp3\n#EXTINF:-1,B\n/cache/2.mp3\n")
        now = time.time()
        (sd / "events.jsonl").write_text(
            json.dumps({"ts": iso(now - 10), "evt": "playlist.reconciled"}) + "\n" +
            json.dumps({"ts": iso(now - 5), "evt": "cache.integrity_fail"}) + "\n")
        st = web.slot_status({"slot": 2, "mac": "AA:BB:CC:DD:EE:FF", "name": "white"})
        check(st["file_playlist_count"] == 2,
              f"slot_status.file_playlist_count == 2 (got {st.get('file_playlist_count')})")
        check(st["last_reconcile"] == iso(now - 10),
              "slot_status.last_reconcile set from events.jsonl")
        check(st["integrity_failures"] == 1,
              f"slot_status.integrity_failures == 1 (got {st.get('integrity_failures')})")
        # Existing keys preserved.
        for k in ("slot", "playing", "playlist_count", "armed_source", "now_playing"):
            check(k in st, f"slot_status preserves existing key {k}")

        # Empty slot dir (no files) -> sane defaults, no throw.
        sd2 = tdp / "9"
        sd2.mkdir()
        st2 = web.slot_status({"slot": 9, "mac": "11:22:33:44:55:66", "name": "blank"})
        check(st2["file_playlist_count"] == 0, "empty slot -> file_playlist_count 0")
        check(st2["last_reconcile"] is None, "empty slot -> last_reconcile None")
        check(st2["integrity_failures"] == 0, "empty slot -> integrity_failures 0")
    finally:
        web.SLOTS_DIR = orig


print(f"Ran {RAN}, failed {FAILED}")
sys.exit(1 if FAILED else 0)
