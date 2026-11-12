#!/usr/bin/env python3
"""Per-slot Bluetooth link: truthful status, auto-reconnect and Fix.

Three jobs, one source of truth (BlueZ's ObjectManager over D-Bus, every
Device1 on every adapter — the same source /api/bt/paired reads):

* ``slot_state``/``describe_slot`` turn a slot's BlueZ record + its player
  into ONE word: Playing / Connected – idle / Speaker off or out of range /
  Not paired. "Not paired" is said only when BlueZ holds no bond for the MAC
  on any adapter (the slot's adapter is wherever the bond lives).
* ``Keeper`` (``slot_link.py keep``, started by the daemon) pages each slot's
  bonded speaker on its own adapter while the slot has something to play,
  every 12 s and backing off to 60 s while the speaker stays away. It only
  ever calls Connect — never Pair, never Remove. When the link comes up the
  daemon's connect handler resumes the slot's armed / scheduled source.
* ``fix_slot`` is the owner's one button: reconnect, restart the slot's
  player if it is wedged, confirm it plays, and say what happened in one
  line. A slot with no bond gets "Hold the speaker's pairing button" and a
  bounded (2 min) background scan that pairs + trusts it the moment it shows.

Pure logic takes plain dicts so tests drive it with fixture BlueZ states.
"""
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

A2DP_SINK_UUID = "0000110b-0000-1000-8000-00805f9b34fb"

TICK_SEC = 4                 # keeper wake-up; per-slot attempts follow the backoff
CONNECT_TIMEOUT_SEC = 20     # one outbound Connect (page timeout is ~5 s; BlueZ may retry)
ESCALATE_AFTER_SEC = 180     # adapter power-cycle only after 3 min of outage ...
ESCALATE_GAP_SEC = 180       # ... at most every 3 min ...
ESCALATE_MAX = 4             # ... and at most 4 per outage: past that it's the speaker, not the adapter
LEDGER_EVERY = 30            # events.jsonl gets attempt 1, every 30th, and results; the journal gets all
ALERT_AFTER_MISSES = 5       # one alert per outage, only while a schedule/override wants it
PAIR_WINDOW_SEC = 120        # Fix on an unpaired slot scans this long for the speaker
FIX_PLAY_WAIT_SEC = 25       # Fix waits this long for audio to start after the link is up
FIX_CONNECT_TIMEOUT_SEC = 10 # per Fix Connect; worst case 10+4+10+25 s stays under a 60 s proxy
FIX_NOTE_TTL_SEC = 600       # a Fix/pairing note shows in status for this long

STATUS_WORDS = {
    "playing": "Playing",
    "idle": "Connected – idle",
    "absent": "Speaker off or out of range",
    "unpaired": "Not paired",
    "unknown": "Bluetooth not answering",
}

# Plain words for the BlueZ errors a Connect/Pair actually returns.
_ERROR_WORDS = (
    ("page-timeout", "speaker didn't answer"),
    ("host is down", "speaker didn't answer"),
    ("hostdown", "speaker didn't answer"),
    ("key-missing", "speaker forgot this hub"),
    ("profile-unavailable", "speaker refused audio"),
    ("inprogress", "already connecting"),
    ("in progress", "already connecting"),
    ("alreadyconnected", "already connected"),
    ("doesnotexist", "no such device on this adapter"),
    ("does not exist", "no such device on this adapter"),
    ("authenticationfailed", "speaker rejected the pairing"),
    ("authentication failed", "speaker rejected the pairing"),
    ("authenticationcanceled", "pairing was cancelled"),
    ("connectionattemptfailed", "speaker didn't answer"),
    ("noreply", "BlueZ timed out"),
    ("timeout", "timed out"),
)


def plain_error(err):
    text = (err or "").lower().replace(".", "")
    for needle, word in _ERROR_WORDS:
        if needle.replace(".", "") in text:
            return word
    return (err or "failed").strip()[:80]


# ---------------------------------------------------------------------------
# Pure logic — status, wants, backoff
# ---------------------------------------------------------------------------

def _busy_error(err):
    e = (err or "").lower().replace(".", "")
    if "page-timeout" in e:            # the speaker really didn't answer
        return False
    return e == "timeout" or any(k in e for k in ("inprogress", "in progress", "noreply",
                                                  "did not receive a reply", "timed out"))


def wait_connected(bluez, path, clock=time.time, sleep=time.sleep, within=15):
    """BlueZ keeps connecting after a D-Bus caller gives up (NoReply) and a
    second caller gets InProgress — so poll Connected instead of calling that
    a failure."""
    end = clock() + within
    while clock() < end:
        try:
            for r in bluez.devices():
                if r.get("path") == path and r.get("connected"):
                    return True
        except Exception:
            pass
        sleep(1)
    return False


def bonded(rec):
    return bool(rec and (rec.get("paired") or rec.get("bonded")))


def slot_record(records, mac):
    """Best BlueZ record for a MAC across adapters: connected > bonded > any.
    The bonded record IS the slot's adapter — a stale unpaired object for the
    same MAC on another adapter never masks it."""
    mac = (mac or "").upper()
    mine = [r for r in records if (r.get("mac") or "").upper() == mac]
    if not mine:
        return None
    for pick in (lambda r: r.get("connected"), bonded, lambda r: True):
        for r in mine:
            if pick(r):
                return r
    return None


def slot_state(inventory_ok, rec, player_alive, paused):
    """-> one of STATUS_WORDS' keys. Connected wins (it is a fact on the
    wire); then the bond decides between 'off/out of range' and 'not paired'."""
    if not inventory_ok:
        return "unknown"
    if rec and rec.get("connected"):
        return "playing" if (player_alive and not paused) else "idle"
    if not bonded(rec):
        return "unpaired"
    return "absent"


def backoff_sec(misses):
    """Seconds until the next Connect after `misses` consecutive failures."""
    if misses < 5:
        return 12     # first minute: a speaker just switched on is caught fast
    if misses < 15:
        return 30
    return 60


def should_escalate(outage_sec, since_last_reset_sec, resets_done):
    """Power-cycle a lonely adapter only for a sustained outage, spaced out and
    bounded — a speaker that was simply switched off must not churn its
    adapter (and a pairing scan on it) every half-minute."""
    return (outage_sec >= ESCALATE_AFTER_SEC and since_last_reset_sec >= ESCALATE_GAP_SEC
            and resets_done < ESCALATE_MAX)


def ledger_worthy(attempt):
    return attempt == 1 or attempt % LEDGER_EVERY == 0


def _minutes(value):
    try:
        h, m = str(value).split(":")
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    if 0 <= h < 24 and 0 <= m < 60:
        return h * 60 + m
    return None


def in_window(start, end, now_min):
    s, e = _minutes(start), _minutes(end)
    if s is None or e is None:
        return False
    if s == e:
        return True
    if s < e:
        return s <= now_min < e
    return now_min >= s or now_min < e


def active_schedule(device, now_min):
    for entry in device.get("schedules") or []:
        start, end = entry.get("start") or "", entry.get("end") or ""
        if not start and not end:
            return entry
        if start and end and in_window(start, end, now_min):
            return entry
    return None


def armed_live(armed, now):
    if not isinstance(armed, dict):
        return False
    exp = armed.get("expires_at")
    return not (isinstance(exp, (int, float)) and now > exp)


def wants_link(device, *, armed=None, released=False, session=None, now=None, now_min=None):
    """Should the hub page this slot's speaker right now? -> (bool, reason).

    Only a slot with something to play is chased, so an ad-hoc speaker shared
    with a phone (no queue, no schedule) is never grabbed, and one handed back
    with `disconnect` stays handed back until Fix / a play / the speaker itself
    connecting. A wind-down headband is chased only to resume an open session
    inside its reconnect window — never to restart a finished one.
    """
    now = time.time() if now is None else now
    if now_min is None:
        lt = time.localtime(now)
        now_min = lt.tm_hour * 60 + lt.tm_min
    if released:
        return False, "released"
    if (device.get("class") or "private") == "public":
        return (True, "armed") if armed_live(armed, now) else (False, "shared")
    profile = device.get("wind_down")
    if profile:
        if not session:
            return False, "no_session"
        if session.get("phase") not in ("primary", "fallback"):
            return False, "session_ended"
        gap = session.get("disconnected_at")
        window = profile.get("reconnect_seconds", 120)
        if gap is not None and now - gap > window:
            return False, "session_ended"
        return True, "session"
    if armed_live(armed, now) and armed.get("queue"):
        return True, "armed"
    sched = active_schedule(device, now_min)
    if sched is not None and sched.get("queue"):
        return True, "schedule"
    if device.get("queue"):
        return True, "queue"
    return False, "nothing_to_play"


REASON_WORDS = {
    "released": "handed back to other devices — press Fix to take it back",
    "shared": "shared speaker — it plays only when something is sent to it",
    "no_session": "bedtime headband — it starts when switched on",
    "session_ended": "bedtime session finished — switch the headband on to start a new one",
    "nothing_to_play": "nothing is set to play on this slot",
}


def describe_slot(device, rec, inventory_ok, *, player_alive, paused, title=None,
                  link=None, note=None, wants=(False, ""), now=None):
    """-> {"status", "status_code", "status_detail"} for /api/status."""
    now = time.time() if now is None else now
    code = slot_state(inventory_ok, rec, player_alive, paused)
    want, reason = wants
    link = link or {}
    detail = ""
    if code == "playing":
        detail = title or ""
    elif code == "idle":
        if player_alive and paused:
            detail = "paused"
        elif want or reason in ("armed", "schedule", "queue", "session"):
            detail = "player not running — press Fix"
        else:
            detail = REASON_WORDS.get(reason, "")
    elif code == "absent":
        if want:
            misses = int(link.get("misses") or 0)
            nxt = link.get("next_at")
            if misses and isinstance(nxt, (int, float)):
                detail = f"reconnecting — {misses} tr{'y' if misses == 1 else 'ies'} failed, next in {max(0, int(nxt - now))} s"
            else:
                detail = "reconnecting"
        else:
            detail = REASON_WORDS.get(reason, "")
    elif code == "unpaired":
        detail = "press Fix, then hold the speaker's pairing button"
    elif code == "unknown":
        detail = "couldn't read BlueZ — try again in a moment"
    if note and isinstance(note.get("at"), (int, float)) and now - note["at"] <= FIX_NOTE_TTL_SEC:
        if note.get("state") == "pairing":
            left = max(0, int((note.get("until") or now) - now))
            detail = f"looking for it — hold the pairing button ({left} s left)"
        elif note.get("message") and code != "playing":
            detail = note["message"]
    return {"status": STATUS_WORDS[code], "status_code": code, "status_detail": detail}


# ---------------------------------------------------------------------------
# Slot files
# ---------------------------------------------------------------------------

def slot_dir(base, slot):
    return Path(base) / "slots" / str(slot)


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data))
    os.replace(tmp, path)


def load_devices(base):
    doc = read_json(Path(base) / ".devices.runtime.json", {}) or {}
    devs = doc.get("devices", doc if isinstance(doc, list) else [])
    return [d for d in devs if isinstance(d, dict) and d.get("slot") is not None and d.get("mac")]


def slot_context(base, device, now=None):
    d = slot_dir(base, device["slot"])
    return {
        "armed": read_json(d / ".armed.json"),
        "released": (d / ".released").exists(),
        "session": read_json(d / "session.json") if device.get("wind_down") else None,
        "link": read_json(d / ".link.json", {}) or {},
        "note": read_json(d / ".fix.json"),
    }


def device_tag(device):
    return f"slot={device['slot']} mac={device['mac']} name={device.get('name') or 'device'}"


def logev(base, device, evt, ledger=True, **fields):
    """Same contract as the daemon's logev: a human line on stderr (journal)
    and one JSON object per line in slots/<N>/events.jsonl. `ledger=False`
    keeps a high-rate event in the journal only (the 5 MB ledger is for
    events that matter a week later)."""
    kv = " ".join(f"{k}={v}" for k, v in fields.items())
    print(f"[{time.strftime('%H:%M:%S')}] [{device_tag(device)}] evt={evt} {kv}".rstrip(),
          file=sys.stderr, flush=True)
    if not ledger:
        return
    d = slot_dir(base, device["slot"])
    try:
        d.mkdir(parents=True, exist_ok=True)
        jl = d / "events.jsonl"
        if jl.exists() and jl.stat().st_size > 5 * 1024 * 1024:
            os.replace(jl, d / "events.jsonl.1")
        rec = {"ts": datetime.now().astimezone().isoformat(timespec="seconds"),
               "evt": evt, "slot": device["slot"]}
        rec.update({k: ("" if v is None else str(v)) for k, v in fields.items()})
        with open(jl, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------------------
# BlueZ access (dbus-python; busctl fallback for reads + Connect)
# ---------------------------------------------------------------------------

def _record(path, props):
    parts = path.split("/")
    rssi = props.get("RSSI")
    return {
        "path": path,
        "adapter": parts[3] if len(parts) > 3 else None,
        "mac": str(props.get("Address") or "").upper(),
        "name": str(props.get("Alias") or props.get("Name") or ""),
        "paired": bool(props.get("Paired")),
        "bonded": bool(props.get("Bonded", props.get("Paired"))),
        "trusted": bool(props.get("Trusted")),
        "connected": bool(props.get("Connected")),
        "rssi": int(rssi) if rssi is not None else None,
    }


def parse_managed_objects(objs):
    """GetManagedObjects mapping -> [record] (one per adapter path)."""
    return [_record(str(p), {str(k): v for k, v in ifs["org.bluez.Device1"].items()})
            for p, ifs in (objs or {}).items() if "org.bluez.Device1" in ifs]


def parse_busctl_json(text):
    """`busctl --json=short call ... GetManagedObjects` -> [record]."""
    doc = json.loads(text)
    objs = (doc.get("data") or [{}])[0]
    flat = {p: {i: {k: (v.get("data") if isinstance(v, dict) and "type" in v else v)
                    for k, v in props.items()}
                for i, props in ifs.items()} for p, ifs in objs.items()}
    return parse_managed_objects(flat)


class DBusBlueZ:
    """Thin BlueZ client. One private system-bus connection per instance, so
    a discovery session lives exactly as long as the instance does."""

    def __init__(self):
        import dbus  # python3-dbus; imported lazily so tests never need it
        self.dbus = dbus
        self.bus = dbus.SystemBus(private=True)

    def _iface(self, path, iface):
        return self.dbus.Interface(self.bus.get_object("org.bluez", path), iface)

    def devices(self):
        om = self._iface("/", "org.freedesktop.DBus.ObjectManager")
        return parse_managed_objects(om.GetManagedObjects(timeout=5))

    def _call(self, fn, *args, timeout=CONNECT_TIMEOUT_SEC):
        try:
            fn(*args, timeout=timeout)
            return True, ""
        except self.dbus.exceptions.DBusException as e:
            return False, f"{e.get_dbus_name()}: {e.get_dbus_message() or ''}".strip(": ")

    def connect(self, path, timeout=CONNECT_TIMEOUT_SEC):
        return self._call(self._iface(path, "org.bluez.Device1").Connect, timeout=timeout)

    def connect_profile(self, path, uuid, timeout=CONNECT_TIMEOUT_SEC):
        return self._call(self._iface(path, "org.bluez.Device1").ConnectProfile, uuid, timeout=timeout)

    def pair(self, path, timeout=60):
        return self._call(self._iface(path, "org.bluez.Device1").Pair, timeout=timeout)

    def set_trusted(self, path):
        props = self._iface(path, "org.freedesktop.DBus.Properties")
        return self._call(props.Set, "org.bluez.Device1", "Trusted", self.dbus.Boolean(True), timeout=5)

    def set_powered(self, hci, on):
        props = self._iface(f"/org/bluez/{hci}", "org.freedesktop.DBus.Properties")
        return self._call(props.Set, "org.bluez.Adapter1", "Powered", self.dbus.Boolean(on), timeout=10)

    def start_discovery(self, hci):
        ad = self._iface(f"/org/bluez/{hci}", "org.bluez.Adapter1")
        try:
            ad.SetDiscoveryFilter({"Transport": "bredr"}, timeout=5)
        except self.dbus.exceptions.DBusException:
            pass
        return self._call(ad.StartDiscovery, timeout=10)

    def stop_discovery(self, hci):
        return self._call(self._iface(f"/org/bluez/{hci}", "org.bluez.Adapter1").StopDiscovery, timeout=10)

    def close(self):
        try:
            self.bus.close()
        except Exception:
            pass


class BusctlBlueZ:
    """Fallback when python3-dbus is missing: reads + Connect via busctl."""

    def devices(self):
        out = subprocess.run(["busctl", "--system", "--json=short", "call", "org.bluez", "/",
                              "org.freedesktop.DBus.ObjectManager", "GetManagedObjects"],
                             capture_output=True, timeout=5, check=True).stdout
        return parse_busctl_json(out)

    def _busctl(self, argv, timeout):
        try:
            r = subprocess.run(["busctl", "--system"] + argv, capture_output=True, text=True, timeout=timeout)
            return r.returncode == 0, (r.stderr or "").strip()
        except subprocess.TimeoutExpired:
            return False, "timeout"

    def connect(self, path, timeout=CONNECT_TIMEOUT_SEC):
        return self._busctl(["call", "org.bluez", path, "org.bluez.Device1", "Connect"], timeout)

    def connect_profile(self, path, uuid, timeout=CONNECT_TIMEOUT_SEC):
        return self._busctl(["call", "org.bluez", path, "org.bluez.Device1", "ConnectProfile", "s", uuid], timeout)

    def pair(self, path, timeout=60):
        return False, "pairing needs python3-dbus"

    def set_trusted(self, path):
        return self._busctl(["set-property", "org.bluez", path, "org.bluez.Device1", "Trusted", "b", "true"], 5)

    def set_powered(self, hci, on):
        return self._busctl(["set-property", "org.bluez", f"/org/bluez/{hci}", "org.bluez.Adapter1",
                             "Powered", "b", "true" if on else "false"], 10)

    def start_discovery(self, hci):
        return False, "discovery needs python3-dbus"

    def stop_discovery(self, hci):
        return True, ""

    def close(self):
        pass


def open_bluez():
    try:
        return DBusBlueZ()
    except Exception:
        return BusctlBlueZ()


def read_records(bluez):
    """-> (records, inventory_ok). Never raises."""
    try:
        return bluez.devices(), True
    except Exception:
        return [], False


def adapter_has_pscan(hci):
    try:
        out = subprocess.run(["hciconfig", hci], capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return True  # can't tell → don't power-cycle on a guess
    return "PSCAN" in out.split()


def pairing_on(base, adapter, now=None):
    """True while a Fix pairing scan is running on this adapter (any slot)."""
    now = time.time() if now is None else now
    for note in Path(base).glob("slots/*/.fix.json"):
        n = read_json(note) or {}
        if n.get("state") == "pairing" and n.get("adapter") == adapter and (n.get("until") or 0) > now:
            return True
    return False


def others_connected_on(records, adapter, mac):
    return [r for r in records if r.get("adapter") == adapter and r.get("connected")
            and (r.get("mac") or "").upper() != (mac or "").upper()]


def cycle_adapter(bluez, hci, sleep=time.sleep):
    bluez.set_powered(hci, False)
    sleep(2)
    bluez.set_powered(hci, True)
    sleep(2)


# ---------------------------------------------------------------------------
# Player (mpv IPC) — read-only probes + the two nudges Fix may apply
# ---------------------------------------------------------------------------

class Player:
    def __init__(self, base):
        self.base = Path(base)

    def _dir(self, slot):
        return slot_dir(self.base, slot)

    def pid(self, slot):
        try:
            pid = int((self._dir(slot) / "mpv.pid").read_text().strip())
            os.kill(pid, 0)
            return pid
        except Exception:
            return None

    def alive(self, slot):
        return self.pid(slot) is not None

    def ipc(self, slot, cmd):
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(2)
            s.connect(str(self._dir(slot) / "mpv-socket"))
            s.sendall((json.dumps({"command": cmd}) + "\n").encode())
            data = b""
            while b"\n" not in data:
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk
            s.close()
            return json.loads(data.split(b"\n")[0])
        except Exception:
            return None

    def get(self, slot, prop):
        r = self.ipc(slot, ["get_property", prop])
        return r.get("data") if isinstance(r, dict) and r.get("error") == "success" else None

    def probe(self, slot):
        """-> {alive, paused, time, title, sink_present} (None = unknown)."""
        if not self.alive(slot):
            return {"alive": False, "paused": None, "time": None, "title": None, "sink_present": None}
        dev = self.get(slot, "audio-device")
        devs = self.get(slot, "audio-device-list")
        sink = None
        if dev and isinstance(devs, list):
            sink = any(isinstance(d, dict) and d.get("name") == dev for d in devs)
        return {"alive": True, "paused": self.get(slot, "pause"), "time": self.get(slot, "playback-time"),
                "title": self.get(slot, "media-title"), "sink_present": sink}

    def unpause(self, slot):
        return self.ipc(slot, ["set_property", "pause", False]) is not None

    def restart(self, slot):
        """Kill this slot's mpv; the daemon's watchdog respawns it on the live
        sink and resumes from state.json (saved every 5 s)."""
        pid = self.pid(slot)
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
                return True
            except OSError:
                return False
        return False


# ---------------------------------------------------------------------------
# Keeper — auto-reconnect loop
# ---------------------------------------------------------------------------

class Keeper:
    def __init__(self, base, bluez, *, clock=time.time, sleep=time.sleep, alert=None,
                 pscan=adapter_has_pscan, threaded=True, bluez_factory=None):
        self.base = Path(base)
        self.bluez = bluez
        # Each attempt thread gets its own bus connection (a blocking Connect
        # must not share one with the tick's reads); tests reuse the fake.
        self.bluez_factory = bluez_factory or (lambda: bluez)
        self.clock = clock
        self.sleep = sleep
        self.alert = alert or (lambda *a: None)
        self.pscan = pscan
        self.threaded = threaded
        self.inflight = set()
        self.lock = threading.Lock()

    def _link(self, slot):
        return read_json(slot_dir(self.base, slot) / ".link.json", {}) or {}

    def _save(self, slot, link):
        write_json(slot_dir(self.base, slot) / ".link.json", link)

    def tick(self):
        """One pass over every configured slot. Returns {slot: action} so tests
        can see what was decided without a real BlueZ."""
        now = self.clock()
        records, ok = read_records(self.bluez)
        actions = {}
        if not ok:
            return actions
        for device in load_devices(self.base):
            slot = device["slot"]
            ctx = slot_context(self.base, device, now)
            link = ctx["link"]
            rec = slot_record(records, device["mac"])
            want, reason = wants_link(device, armed=ctx["armed"], released=ctx["released"],
                                      session=ctx["session"], now=now)
            if rec and rec.get("connected"):
                if int(link.get("misses") or 0) > 0:
                    start = link.get("outage_start") or now
                    logev(self.base, device, "bt.reconnect_recovered", misses=link.get("misses"),
                          outage_sec=int(now - start), adapter=rec.get("adapter"))
                if link.get("misses") or link.get("wants") != want or link.get("reason") != reason:
                    self._save(slot, {"misses": 0, "wants": want, "reason": reason, "connected_at": now})
                actions[slot] = "connected"
                continue
            if not want:
                if link.get("misses") or link.get("wants") or link.get("reason") != reason:
                    self._save(slot, {"misses": 0, "wants": False, "reason": reason})
                actions[slot] = f"idle:{reason}"
                continue
            if not bonded(rec):
                if link.get("reason") != "unpaired":
                    logev(self.base, device, "bt.reconnect_skipped", reason="not_paired")
                    self._save(slot, {"misses": 0, "wants": True, "reason": "unpaired"})
                actions[slot] = "unpaired"
                continue
            with self.lock:
                if slot in self.inflight:
                    actions[slot] = "inflight"
                    continue
            if link.get("reason") != reason or not link.get("wants"):
                link = dict(link, wants=True, reason=reason)
                self._save(slot, link)
            if now < (link.get("next_at") or 0) or now < (link.get("hold_until") or 0):
                actions[slot] = "waiting"
                continue
            with self.lock:
                if slot in self.inflight:
                    actions[slot] = "inflight"
                    continue
                self.inflight.add(slot)
            actions[slot] = "attempt"
            if self.threaded:
                threading.Thread(target=self._attempt, args=(device, rec, records, reason),
                                 daemon=True).start()
            else:
                self._attempt(device, rec, records, reason)
        return actions

    def _attempt(self, device, rec, records, reason):
        slot = device["slot"]
        bz = self.bluez_factory()
        try:
            link = self._link(slot)
            misses = int(link.get("misses") or 0)
            adapter = rec.get("adapter")
            lonely = (not others_connected_on(records, adapter, device["mac"])
                      and not pairing_on(self.base, adapter, self.clock()))
            if lonely and adapter and not self.pscan(adapter):
                logev(self.base, device, "bt.adapter_heal", adapter=adapter, why="pscan_missing")
                cycle_adapter(bz, adapter, self.sleep)
            t0 = self.clock()
            ok, err = bz.connect(rec["path"], CONNECT_TIMEOUT_SEC)
            if not ok and "alreadyconnected" in err.lower().replace(".", ""):
                ok = True
            took = round(self.clock() - t0, 1)
            now = self.clock()
            if not ok and _busy_error(err):
                ok = wait_connected(bz, rec["path"], self.clock, self.sleep)
            if ok:
                logev(self.base, device, "bt.reconnect", result="ok", attempt=misses + 1,
                      adapter=adapter, reason=reason, took_sec=took)
                if misses:
                    logev(self.base, device, "bt.reconnect_recovered", misses=misses,
                          outage_sec=int(now - (link.get("outage_start") or now)), adapter=adapter)
                self._save(slot, {"misses": 0, "wants": True, "reason": reason, "connected_at": now})
                return
            misses += 1
            delay = backoff_sec(misses)
            link.setdefault("outage_start", now)
            logev(self.base, device, "bt.reconnect", ledger=ledger_worthy(misses), result="fail",
                  attempt=misses, adapter=adapter, reason=reason, error=plain_error(err),
                  took_sec=took, next_in=delay)
            resets = int(link.get("resets") or 0)
            if lonely and should_escalate(now - link["outage_start"], now - (link.get("last_reset_at") or 0), resets):
                logev(self.base, device, "bt.adapter_reset", adapter=adapter, misses=misses,
                      outage_sec=int(now - link["outage_start"]))
                cycle_adapter(bz, adapter, self.sleep)
                link.update(resets=resets + 1, last_reset_at=self.clock())
                now = self.clock()
            link.update(misses=misses, next_at=now + delay, wants=True, reason=reason,
                        last_error=plain_error(err), last_attempt_at=now)
            if (misses >= ALERT_AFTER_MISSES and not link.get("alerted")
                    and reason in ("schedule", "armed", "session")):
                link["alerted"] = True
                self.alert("warning", "bt_reconnect_fail",
                           f"{device.get('name')} (slot {slot}) should be playing but its speaker "
                           f"hasn't answered for {misses} tries — off, out of range, or a BT fault")
            self._save(slot, link)
        except Exception as e:  # never let one slot kill the keeper
            logev(self.base, device, "bt.reconnect", result="error", error=str(e)[:120])
        finally:
            if bz is not self.bluez:
                bz.close()
            with self.lock:
                self.inflight.discard(slot)

    def run(self):
        print(f"[{time.strftime('%H:%M:%S')}] [link-keeper] started (tick {TICK_SEC}s)",
              file=sys.stderr, flush=True)
        while True:
            try:
                self.tick()
            except Exception as e:
                print(f"[link-keeper] tick error: {e}", file=sys.stderr, flush=True)
            self.sleep(TICK_SEC)


def shell_alert(base):
    script = Path(base) / "playback-hub.sh"

    def alert(severity, event, message):
        try:
            subprocess.run([str(script), "alert", severity, event, message],
                           capture_output=True, timeout=30)
        except Exception:
            pass
    return alert


# ---------------------------------------------------------------------------
# Fix — the one button
# ---------------------------------------------------------------------------

def choose_pair_adapter(records, mac, configured_macs):
    """Adapter to pair on: the one already holding an object for this MAC;
    else one with no bonded configured speaker (one speaker per adapter)."""
    mine = [r for r in records if (r.get("mac") or "").upper() == mac.upper()]
    if mine:
        return mine[0]["adapter"]
    adapters = sorted({r["adapter"] for r in records if r.get("adapter")})
    taken = {r["adapter"] for r in records
             if bonded(r) and (r.get("mac") or "").upper() in configured_macs}
    for a in adapters:
        if a not in taken:
            return a
    return adapters[0] if adapters else "hci0"


def bluetoothctl_pair(adapter, mac, bluez, clock=time.time, sleep=time.sleep, within=30):
    """Second route to a bond when a bare Device1.Pair is refused (BlueZ may
    want an agent): bluetoothctl with a NoInputNoOutput agent, stdin held open
    until BlueZ reports Paired (piped bluetoothctl exits — and abandons the
    pairing — the moment stdin closes)."""
    try:
        addr = subprocess.run(["busctl", "--system", "get-property", "org.bluez", f"/org/bluez/{adapter}",
                               "org.bluez.Adapter1", "Address"], capture_output=True, text=True,
                              timeout=5).stdout.split('"')[1]
    except Exception:
        return False
    proc = subprocess.Popen(["bluetoothctl", "--agent", "NoInputNoOutput"], stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
    try:
        proc.stdin.write(f"default-agent\nselect {addr}\npair {mac}\n")
        proc.stdin.flush()
        end = clock() + within
        while clock() < end:
            for r in read_records(bluez)[0]:
                if r.get("adapter") == adapter and r.get("mac") == mac and bonded(r):
                    return True
            sleep(1)
        return False
    finally:
        try:
            proc.stdin.write("quit\n")
            proc.stdin.close()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


def _note(base, device, **data):
    data.setdefault("at", time.time())
    write_json(slot_dir(base, device["slot"]) / ".fix.json", data)


_PAIR_JOBS = {}
_PAIR_LOCK = threading.Lock()


def pair_job(base, device, bluez_factory=open_bluez, *, clock=time.time, sleep=time.sleep,
             window=PAIR_WINDOW_SEC, configured_macs=(), pair_fallback=bluetoothctl_pair):
    """Scan the chosen adapter until the speaker shows (RSSI seen in THIS scan),
    then Pair + Trust + Connect. Bounded by `window`. Returns the result line."""
    mac = device["mac"].upper()
    bz = bluez_factory()
    adapter = None
    try:
        records, _ = read_records(bz)
        adapter = choose_pair_adapter(records, mac, set(configured_macs) | {mac})
        start = clock()
        _note(base, device, state="pairing", at=start, until=start + window, adapter=adapter)
        logev(base, device, "fix.pair_scan", adapter=adapter, window_sec=window)
        ok, err = bz.start_discovery(adapter)
        if not ok and "inprogress" not in err.lower().replace(".", ""):
            msg = f"Couldn't start a Bluetooth scan ({plain_error(err)}) — try Fix again."
            logev(base, device, "fix.pair_result", result="fail", error=plain_error(err))
            _note(base, device, state="failed", message=msg)
            return msg
        found = None
        while clock() - start < window:
            recs, _ = read_records(bz)
            for r in recs:
                if r.get("adapter") == adapter and r.get("mac") == mac and (
                        r.get("rssi") is not None or bonded(r) or r.get("connected")):
                    found = r
                    break
            if found:
                break
            sleep(2)
        bz.stop_discovery(adapter)
        if not found:
            msg = ("Didn't see the speaker in 2 minutes — hold its pairing button until it "
                   "flashes, then press Fix again.")
            logev(base, device, "fix.pair_result", result="not_seen", adapter=adapter)
            _note(base, device, state="failed", message=msg)
            return msg
        if not bonded(found):
            logev(base, device, "fix.pair_found", adapter=adapter, rssi=found.get("rssi"))
            ok, err = bz.pair(found["path"], 60)
            if not ok and "alreadyexists" not in err.lower().replace(".", ""):
                logev(base, device, "fix.pair_retry", route="bluetoothctl", error=plain_error(err))
                if pair_fallback(adapter, mac, bz, clock, sleep):
                    ok, err = True, ""
            if not ok and "alreadyexists" not in err.lower().replace(".", ""):
                msg = f"Saw the speaker but pairing failed ({plain_error(err)}) — hold its pairing button and press Fix again."
                logev(base, device, "fix.pair_result", result="fail", adapter=adapter, error=plain_error(err))
                _note(base, device, state="failed", message=msg)
                return msg
        bz.set_trusted(found["path"])
        ok, err = bz.connect(found["path"], CONNECT_TIMEOUT_SEC)
        if ok:
            msg = "Paired and connected — it will start playing in a few seconds."
            logev(base, device, "fix.pair_result", result="ok", adapter=adapter)
        else:
            msg = f"Paired, but the first connect failed ({plain_error(err)}) — the hub will keep trying."
            logev(base, device, "fix.pair_result", result="paired_not_connected", adapter=adapter,
                  error=plain_error(err))
        _note(base, device, state="done", message=msg)
        return msg
    except Exception as e:
        msg = f"Pairing hit an error ({str(e)[:60]}) — press Fix again."
        logev(base, device, "fix.pair_result", result="error", error=str(e)[:120])
        _note(base, device, state="failed", message=msg)
        return msg
    finally:
        try:
            if adapter:
                bz.stop_discovery(adapter)
        except Exception:
            pass
        bz.close()
        with _PAIR_LOCK:
            _PAIR_JOBS.pop(device["slot"], None)


def start_pair_job(base, device, configured_macs, bluez_factory=open_bluez):
    with _PAIR_LOCK:
        job = _PAIR_JOBS.get(device["slot"])
        if job and job.is_alive():
            return False
        t = threading.Thread(target=pair_job, args=(base, device, bluez_factory),
                             kwargs={"configured_macs": configured_macs}, daemon=True)
        _PAIR_JOBS[device["slot"]] = t
        t.start()
        return True


def fix_slot(base, device, bluez, player, *, clock=time.time, sleep=time.sleep,
             play_wait=FIX_PLAY_WAIT_SEC, pair_starter=None, configured_macs=()):
    """Reconnect → restart the slot's player if needed → confirm it plays.
    -> {"ok", "code", "result"}: one plain line, truthful about what happened."""
    slot = device["slot"]
    d = slot_dir(base, slot)
    try:
        (d / ".released").unlink()
    except OSError:
        pass
    # Hold the keeper off while Fix owns the link, so the two never race a
    # Connect (the loser would read InProgress as "speaker off").
    write_json(d / ".link.json", {"misses": 0, "next_at": 0, "hold_until": clock() + 90})
    logev(base, device, "fix.start")

    def done(ok, code, result):
        write_json(d / ".link.json", {"misses": 0, "next_at": 0})
        logev(base, device, "fix.result", code=code, result=result)
        _note(base, device, state="done", message=result if code != "playing" else "")
        return {"ok": ok, "code": code, "result": result}

    records, inv_ok = read_records(bluez)
    if not inv_ok:
        return done(False, "unknown", "Couldn't read Bluetooth on the hub — try again in a moment.")
    rec = slot_record(records, device["mac"])
    if not (rec and rec.get("connected")) and not bonded(rec):
        starter = pair_starter or (lambda dev: start_pair_job(base, dev, configured_macs))
        write_json(d / ".link.json", {"misses": 0, "next_at": 0})
        starter(device)
        result = ("Hold the speaker's pairing button — I'll pair it the moment it shows up "
                  f"(watching for {PAIR_WINDOW_SEC // 60} min).")
        logev(base, device, "fix.result", code="pairing", result=result)
        return {"ok": True, "code": "pairing", "result": result}

    if not rec.get("connected"):
        adapter = rec.get("adapter")
        ok, err = bluez.connect(rec["path"], FIX_CONNECT_TIMEOUT_SEC)
        if not ok and _busy_error(err):
            ok = wait_connected(bluez, rec["path"], clock, sleep)
        logev(base, device, "bt.reconnect", result="ok" if ok else "fail", attempt="fix",
              adapter=adapter, reason="fix", error=plain_error(err) if not ok else "")
        if not ok and plain_error(err) == "speaker forgot this hub":
            return done(False, "forgotten",
                        "The speaker has forgotten the hub — hold its pairing button; the hub still "
                        "holds the old bond, so it needs re-pairing from the Bluetooth tab.")
        if (not ok and plain_error(err) == "speaker didn't answer"
                and not others_connected_on(records, adapter, device["mac"])
                and not pairing_on(base, adapter, clock())):
            logev(base, device, "bt.adapter_reset", adapter=adapter, misses="fix")
            cycle_adapter(bluez, adapter, sleep)
            ok, err = bluez.connect(rec["path"], FIX_CONNECT_TIMEOUT_SEC)
            if not ok and _busy_error(err):
                ok = wait_connected(bluez, rec["path"], clock, sleep)
            logev(base, device, "bt.reconnect", result="ok" if ok else "fail", attempt="fix-after-reset",
                  adapter=adapter, reason="fix", error=plain_error(err) if not ok else "")
        if not ok:
            return done(False, "absent",
                        f"Couldn't reach the speaker ({plain_error(err)}) — switch it on and bring it "
                        "near the hub; it reconnects by itself within seconds of answering.")

    # Linked. Does this slot have anything to play?
    ctx = slot_context(base, device)
    if (device.get("class") or "private") == "public" and not armed_live(ctx["armed"], clock()):
        return done(True, "idle", "Connected — this shared speaker plays only when something is sent to it.")
    if not device.get("wind_down"):
        want, reason = wants_link(device, armed=ctx["armed"], session=None, now=clock())
        if not want:
            return done(True, "idle", "Connected — nothing is set to play on this slot.")

    linked_at = clock()
    deadline = linked_at + play_wait
    unpaused = restarted = reprofiled = False
    last_time, stalled_since = None, None
    while clock() < deadline:
        if device.get("wind_down") and clock() - linked_at >= 8:
            # The daemon's connect edge decides first whether a fresh session
            # opens; only then is "ended" the answer rather than a race.
            sess = read_json(d / "session.json") or {}
            if sess.get("phase") == "ended" and not player.alive(slot):
                return done(True, "idle", "Connected — the bedtime session already finished; switch the "
                                          "headband off and on to start a new one.")
        p = player.probe(slot)
        if p["alive"]:
            if p["sink_present"] is False and not reprofiled:
                reprofiled = True
                ok, err = bluez.connect_profile(rec["path"], A2DP_SINK_UUID)
                logev(base, device, "fix.audio_profile", result="ok" if ok else "fail",
                      error=plain_error(err) if not ok else "")
                player.restart(slot)
                logev(base, device, "fix.player_restart", why="sink_missing")
                restarted = True
                last_time, stalled_since = None, None
            elif p["paused"] and not unpaused:
                unpaused = True
                player.unpause(slot)
                logev(base, device, "fix.unpause")
            elif isinstance(p["time"], (int, float)):
                if last_time is not None and p["time"] - last_time >= 0.5 and not p["paused"]:
                    title = p.get("title") or "audio"
                    return done(True, "playing", f"Playing: {title}")
                if last_time is not None and abs(p["time"] - last_time) < 0.05 and not p["paused"]:
                    stalled_since = stalled_since or clock()
                    if clock() - stalled_since >= 10 and not restarted:
                        restarted = True
                        player.restart(slot)
                        logev(base, device, "fix.player_restart", why="stalled")
                        last_time, stalled_since = None, None
                        sleep(1.5)
                        continue
                else:
                    stalled_since = None
                last_time = p["time"]
        sleep(1.5)
    p = player.probe(slot)
    if not p["alive"]:
        return done(False, "stuck", "Connected, but the player didn't start within "
                                    f"{play_wait} s — the hub keeps retrying; press Fix again if it stays quiet.")
    return done(False, "stuck", "Connected and the player is up, but no audio progress yet — "
                                "press Fix again if it stays quiet.")


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=os.environ.get("PLAYBACK_HUB_DIR") or str(Path.home() / "playback-hub"))
    ap.add_argument("action", choices=["keep", "status"])
    args = ap.parse_args(argv)
    if args.action == "keep":
        Keeper(args.base, open_bluez(), alert=shell_alert(args.base), bluez_factory=open_bluez).run()
    else:
        bz = open_bluez()
        records, ok = read_records(bz)
        player = Player(args.base)
        for device in load_devices(args.base):
            ctx = slot_context(args.base, device)
            p = player.probe(device["slot"])
            want = wants_link(device, armed=ctx["armed"], released=ctx["released"], session=ctx["session"])
            print(device["slot"], device.get("color"), json.dumps(describe_slot(
                device, slot_record(records, device["mac"]), ok, player_alive=p["alive"],
                paused=bool(p["paused"]), title=p["title"], link=ctx["link"], note=ctx["note"], wants=want)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
