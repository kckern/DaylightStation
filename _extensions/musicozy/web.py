#!/usr/bin/env python3
"""MusiCozy Web Interface — lightweight stdlib HTTP server for managing
Bluetooth auto-play on a Raspberry Pi."""

import http.server
import json
import os
import random
import re
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = 8080
BASE = Path("/home/kckern/musicozy")
DEVICES_FILE = BASE / "devices.json"
SLOTS_DIR = BASE / "slots"
TIME_RE = re.compile(r"^(?:[01]?\d|2[0-3]):[0-5]\d$")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "off", ""}
    return bool(value)

def normalize_schedule_entry(entry):
    item = dict(entry or {})
    return {
        "queue": str(item.get("queue", "") or "").strip(),
        "shuffle": normalize_bool(item.get("shuffle"), False),
        "start": str(item.get("start", "") or "").strip(),
        "end": str(item.get("end", "") or "").strip(),
    }

def normalize_device(device):
    item = dict(device)
    item["queue"] = str(item.get("queue", "") or "").strip()
    item["shuffle"] = normalize_bool(item.get("shuffle"), False)
    item["schedules"] = [
        normalize_schedule_entry(entry)
        for entry in (item.get("schedules") or [])
        if isinstance(entry, dict)
    ]
    item["alternate_queue"] = str(item.get("alternate_queue", "") or "").strip()
    item["alternate_shuffle"] = normalize_bool(item.get("alternate_shuffle"), False)
    item["alternate_start"] = str(item.get("alternate_start", "") or "").strip()
    item["alternate_end"] = str(item.get("alternate_end", "") or "").strip()
    item["resume_queue"] = normalize_bool(item.get("resume_queue"), True)
    item["resume_track"] = normalize_bool(item.get("resume_track"), True)
    return item

def read_devices():
    if not DEVICES_FILE.exists():
        return []
    with open(DEVICES_FILE) as f:
        return [normalize_device(d) for d in json.load(f)]

def write_devices(devices):
    with open(DEVICES_FILE, "w") as f:
        json.dump(devices, f, indent=2)

def next_slot(devices):
    used = {d["slot"] for d in devices}
    n = 1
    while n in used:
        n += 1
    return n

def is_connected(mac):
    try:
        out = subprocess.check_output(
            ["bluetoothctl", "info", mac],
            stderr=subprocess.DEVNULL, timeout=5
        ).decode()
        return "Connected: yes" in out
    except Exception:
        return False

def pid_alive(pid_file):
    try:
        pid = int(Path(pid_file).read_text().strip())
        os.kill(pid, 0)
        return True
    except Exception:
        return False

def mpv_command(sock_path, cmd):
    """Send a JSON command to mpv's IPC socket and return parsed response."""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect(str(sock_path))
        payload = json.dumps({"command": cmd}) + "\n"
        s.sendall(payload.encode())
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
            if b"\n" in data:
                break
        s.close()
        line = data.split(b"\n")[0]
        return json.loads(line)
    except Exception:
        return None

def time_to_minutes(value):
    if not isinstance(value, str) or not TIME_RE.match(value):
        return None
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)

def in_time_window(start, end):
    start_minutes = time_to_minutes(start)
    end_minutes = time_to_minutes(end)
    now_minutes = time_to_minutes(time.strftime("%H:%M"))
    if start_minutes is None or end_minutes is None or now_minutes is None:
        return False
    if start_minutes == end_minutes:
        return True
    if start_minutes < end_minutes:
        return start_minutes <= now_minutes < end_minutes
    return now_minutes >= start_minutes or now_minutes < end_minutes

def selected_queue(device):
    for entry in device.get("schedules", []):
        start = entry.get("start", "")
        end = entry.get("end", "")
        if not start and not end:
            return entry.get("queue", "")
        if start and end and in_time_window(start, end):
            return entry.get("queue", "")

    alternate_queue = device.get("alternate_queue", "")
    alternate_start = device.get("alternate_start", "")
    alternate_end = device.get("alternate_end", "")
    if alternate_queue and alternate_start and alternate_end and in_time_window(alternate_start, alternate_end):
        return alternate_queue
    return device.get("queue", "")

def selected_shuffle(device):
    for entry in device.get("schedules", []):
        start = entry.get("start", "")
        end = entry.get("end", "")
        if not start and not end:
            return normalize_bool(entry.get("shuffle"), False)
        if start and end and in_time_window(start, end):
            return normalize_bool(entry.get("shuffle"), False)

    alternate_queue = device.get("alternate_queue", "")
    alternate_start = device.get("alternate_start", "")
    alternate_end = device.get("alternate_end", "")
    if alternate_queue and alternate_start and alternate_end and in_time_window(alternate_start, alternate_end):
        return normalize_bool(device.get("alternate_shuffle"), False)
    return normalize_bool(device.get("shuffle"), False)

def validate_device_settings(device):
    schedules = device.get("schedules", [])
    if schedules:
        for idx, entry in enumerate(schedules, start=1):
            if not entry.get("queue"):
                return f"schedules[{idx}] requires queue"
            start = entry.get("start", "")
            end = entry.get("end", "")
            if bool(start) != bool(end):
                return f"schedules[{idx}] must set both start and end or neither"
            if start and (not TIME_RE.match(start) or not TIME_RE.match(end)):
                return f"schedules[{idx}] start/end must use HH:MM (24-hour) format"
        return None

    if not device.get("alternate_queue"):
        device["alternate_start"] = ""
        device["alternate_end"] = ""
        device["alternate_shuffle"] = False
        return None
    if not device.get("alternate_start") or not device.get("alternate_end"):
        return "alternate_start and alternate_end are required when alternate_queue is set"
    if not TIME_RE.match(device["alternate_start"]) or not TIME_RE.match(device["alternate_end"]):
        return "alternate_start and alternate_end must use HH:MM (24-hour) format"
    return None

def expected_audio_devices(mac):
    normalized = str(mac or "").replace(":", "_")
    if not normalized:
        return []
    return [
        f"pipewire/bluez_output.{normalized}.1",
        f"pulse/bluez_output.{normalized}.1",
    ]

def slot_status(device):
    slot = device["slot"]
    slot_dir = SLOTS_DIR / str(slot)
    sock_path = slot_dir / "mpv-socket"
    pid_file = slot_dir / "mpv.pid"

    connected = is_connected(device["mac"])
    playing = pid_alive(pid_file)

    title = None
    position = None
    duration = None
    playlist_pos = None
    audio_device = None

    if playing and sock_path.exists():
        r = mpv_command(sock_path, ["get_property", "media-title"])
        if r and "data" in r:
            title = r["data"]
        r = mpv_command(sock_path, ["get_property", "playback-time"])
        if r and "data" in r:
            position = r["data"]
        r = mpv_command(sock_path, ["get_property", "duration"])
        if r and "data" in r:
            duration = r["data"]
        r = mpv_command(sock_path, ["get_property", "playlist-pos"])
        if r and "data" in r:
            playlist_pos = r["data"]
        r = mpv_command(sock_path, ["get_property", "audio-device"])
        if r and "data" in r:
            audio_device = r["data"]

    return {
        "slot": slot,
        "name": device.get("name", ""),
        "mac": device.get("mac", ""),
        "connected": connected,
        "playing": playing,
        "title": title,
        "position": position,
        "duration": duration,
        "playlist_pos": playlist_pos,
        "audio_device": audio_device,
        "expected_audio_devices": expected_audio_devices(device.get("mac", "")),
    }

API_BASE = "https://daylightlocal.kckern.net"
API_FALLBACK_BASE = "http://10.0.0.10:3111"
MIN_AUDIO_BYTES = 2048

def with_api_fallback(url):
    return url.replace(API_BASE, API_FALLBACK_BASE, 1)

def api_open(url, timeout=5):
    try:
        req = urllib.request.Request(url)
        return urllib.request.urlopen(req, timeout=timeout)
    except Exception:
        fallback_url = with_api_fallback(url)
        if fallback_url == url:
            raise
        req = urllib.request.Request(fallback_url)
        return urllib.request.urlopen(req, timeout=timeout)

def api_download(url, dest_path, timeout=5):
    try:
        with api_open(url, timeout=timeout) as resp:
            Path(dest_path).write_bytes(resp.read())
        return is_valid_audio_file(dest_path)
    except Exception:
        Path(dest_path).unlink(missing_ok=True)
        return False

def file_size_bytes(path):
    try:
        return Path(path).stat().st_size
    except FileNotFoundError:
        return 0

def is_valid_audio_file(path):
    file_path = Path(path)
    size = file_size_bytes(file_path)
    if size < MIN_AUDIO_BYTES:
        file_path.unlink(missing_ok=True)
        return False

    try:
        mime = subprocess.check_output(
            ["file", "--brief", "--mime-type", str(file_path)],
            stderr=subprocess.DEVNULL,
            timeout=3,
            text=True,
        ).strip()
    except Exception:
        return True

    if mime.startswith("audio/") or mime == "application/octet-stream":
        return True

    file_path.unlink(missing_ok=True)
    return False

def is_valid_queue_payload(data):
    return isinstance(data, dict) and isinstance(data.get("items"), list)

def refresh_queue(slot, queue_url, shuffle=False):
    """Re-fetch queue from API, update cache and playlist.m3u. Returns True on success."""
    if not queue_url:
        return False
    slot_dir = SLOTS_DIR / str(slot)
    cache_dir = slot_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    playlist_file = slot_dir / "playlist.m3u"

    try:
        with api_open(queue_url, timeout=5) as resp:
            queue_data = json.loads(resp.read())
    except Exception:
        return False

    if not is_valid_queue_payload(queue_data):
        return False

    items = queue_data.get("items", [])
    if not items:
        return False

    lines = []
    for item in items:
        content_id = item.get("contentId", "")
        plex_id = re.sub(r"^plex:", "", content_id)
        media_path = item.get("mediaUrl", "")
        cached_file = cache_dir / f"{plex_id}.mp3"

        if cached_file.exists() and not is_valid_audio_file(cached_file):
            cached_file.unlink(missing_ok=True)

        if not cached_file.exists() and media_path:
            url = f"{API_BASE}{media_path}"
            if not api_download(url, cached_file, timeout=10):
                continue

        if cached_file.exists():
            lines.append(str(cached_file))

    if lines:
        if shuffle:
            random.shuffle(lines)
        playlist_file.write_text("\n".join(lines) + "\n")
        return True
    return False

# ---------------------------------------------------------------------------
# HTML frontend (inlined)
# ---------------------------------------------------------------------------

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MusiCozy</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1321;--surface:#16213e;--surface-2:#1b2a49;--border:#294466;
  --text:#eef4ff;--muted:#9eb1c9;
  --green:#27d07d;--red:#ff5f6d;--accent:#67d5ff;--accent-2:#8cf0c6;
  --radius:14px;
}
body{
  font-family:"Avenir Next","Segoe UI",sans-serif;
  background:
    radial-gradient(circle at top left, rgba(103,213,255,.16), transparent 28%),
    radial-gradient(circle at top right, rgba(140,240,198,.12), transparent 24%),
    linear-gradient(180deg, #0a1220 0%, #0d1321 100%);
  color:var(--text);
  min-height:100vh;display:flex;flex-direction:column;align-items:center;
}
/* Tabs */
.tabs{
  position:sticky;top:0;z-index:10;
  width:100%;max-width:600px;display:flex;
  background:rgba(22,33,62,.9);backdrop-filter:blur(18px);
  border-bottom:1px solid rgba(103,213,255,.15);
}
.tabs button{
  flex:1;padding:14px 0;border:none;background:transparent;
  color:var(--muted);font-size:15px;font-weight:700;cursor:pointer;
  transition:color .2s,border-bottom .2s;border-bottom:3px solid transparent;
}
.tabs button.active{color:var(--accent);border-bottom-color:var(--accent)}
.container{width:100%;max-width:720px;padding:16px}
.section{display:none}
.section.active{display:block}
/* Cards */
.card{
  background:linear-gradient(180deg, rgba(27,42,73,.96), rgba(17,29,53,.96));
  border:1px solid rgba(103,213,255,.16);
  box-shadow:0 16px 36px rgba(0,0,0,.22);
  border-radius:var(--radius);padding:18px;margin-bottom:14px;
}
.card-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.dot.on{background:var(--green)}.dot.off{background:var(--red)}
.card-title{font-size:16px;font-weight:600}
.card-slot{color:var(--muted);font-size:13px;margin-left:auto}
.now-playing{color:var(--muted);font-size:14px;margin-bottom:10px;min-height:20px}
.controls{display:flex;justify-content:center;gap:16px}
.ctrl-btn{
  width:56px;height:56px;border-radius:50%;border:none;
  background:var(--border);color:var(--text);font-size:22px;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:background .15s;
}
.ctrl-btn:active{background:var(--accent)}
/* Device list */
.dev-row{
  display:flex;align-items:center;gap:10px;padding:10px 0;
  border-bottom:1px solid rgba(103,213,255,.1);flex-wrap:wrap;
}
.dev-row:last-child{border-bottom:none}
.dev-info{flex:1;min-width:0}
.dev-name{font-weight:600;font-size:15px}
.dev-mac{font-size:12px;color:var(--muted);word-break:break-all}
.dev-queue{font-size:12px;color:var(--muted);word-break:break-all}
.device-shell{display:flex;flex-direction:column;gap:16px}
.device-section{
  border:1px solid rgba(103,213,255,.12);
  background:rgba(9,18,34,.34);
  border-radius:12px;padding:14px;
}
.section-title{
  font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--accent);margin-bottom:10px;
}
.device-grid{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;
}
.active-summary{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:10px 12px;border-radius:10px;background:rgba(103,213,255,.08);
  border:1px solid rgba(103,213,255,.12);font-size:13px;color:var(--muted);
}
.pill{
  display:inline-flex;align-items:center;gap:6px;border-radius:999px;
  padding:5px 10px;font-size:12px;font-weight:700;
  border:1px solid rgba(255,255,255,.12);color:var(--text);
  background:rgba(255,255,255,.05);
}
.pill.active{background:rgba(39,208,125,.16);border-color:rgba(39,208,125,.35);color:#d8ffea}
.pill.subtle{color:var(--muted)}
.del-btn,.pair-btn,.unpair-btn,.add-link{
  min-width:44px;min-height:44px;border:none;border-radius:8px;
  padding:8px 14px;cursor:pointer;font-size:14px;font-weight:600;
}
.del-btn{background:var(--red);color:#fff}
.pair-btn{background:var(--green);color:#fff}
.unpair-btn{background:var(--red);color:#fff}
.add-link{background:var(--accent);color:#000}
/* Forms */
.form-group{margin-bottom:12px}
.form-group label{display:block;margin-bottom:4px;font-size:14px;color:var(--muted)}
.form-group input{
  width:100%;padding:11px 12px;border-radius:10px;border:1px solid rgba(103,213,255,.14);
  background:rgba(8,15,29,.8);color:var(--text);font-size:15px;
}
.form-group textarea{
  width:100%;min-height:140px;padding:10px;border-radius:8px;border:1px solid var(--border);
  background:var(--bg);color:var(--text);font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
}
.schedule-list{display:flex;flex-direction:column;gap:12px;margin-bottom:12px}
.schedule-row{
  border:1px solid rgba(140,240,198,.16);border-radius:12px;padding:12px;
  background:linear-gradient(180deg, rgba(10,18,32,.72), rgba(12,24,43,.58));
  position:relative;
}
.schedule-grid{
  display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;
}
.schedule-head{
  display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;
}
.schedule-name{font-size:14px;font-weight:700}
.schedule-actions{
  display:flex;justify-content:space-between;align-items:center;gap:10px;
}
.schedule-btn{
  width:100%;padding:11px;border:none;border-radius:10px;
  background:linear-gradient(90deg, rgba(103,213,255,.18), rgba(140,240,198,.18));
  color:var(--text);font-size:14px;font-weight:700;cursor:pointer;
  border:1px solid rgba(103,213,255,.16);
}
.schedule-remove{
  border:none;border-radius:8px;background:rgba(255,95,109,.18);color:#ffd9dd;
  padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;
}
.schedule-meta{font-size:12px;color:var(--muted);margin-top:8px}
.checkbox-row{
  display:flex;align-items:center;gap:10px;padding:10px 0;
}
.checkbox-row input{
  width:auto;transform:scale(1.2);
}
.toggle-grid{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;
}
.toggle-card{
  border:1px solid rgba(103,213,255,.12);border-radius:12px;padding:12px;
  background:rgba(8,15,29,.55);
}
.toggle-label{font-size:14px;font-weight:700;margin-bottom:4px}
.toggle-help{font-size:12px;color:var(--muted)}
.submit-btn{
  width:100%;padding:14px;border:none;border-radius:8px;
  background:var(--accent);color:#000;font-size:16px;font-weight:600;
  cursor:pointer;
}
.scan-btn{
  width:100%;padding:14px;border:none;border-radius:8px;
  background:var(--accent);color:#000;font-size:16px;font-weight:600;
  cursor:pointer;margin-bottom:16px;
}
.spinner{display:none;text-align:center;padding:20px;color:var(--muted)}
.spinner.show{display:block}
h3{font-size:17px;margin:18px 0 10px;color:var(--accent)}
.msg{padding:10px;border-radius:8px;margin-bottom:12px;font-size:14px;display:none}
.msg.ok{display:block;background:#1b5e20;color:#c8e6c9}
.msg.err{display:block;background:#b71c1c;color:#ffcdd2}
@media (max-width:640px){
  .device-grid,.toggle-grid,.schedule-grid{grid-template-columns:1fr}
  .schedule-actions,.active-summary{flex-direction:column;align-items:flex-start}
}
</style>
</head>
<body>

<div class="tabs">
  <button class="active" onclick="switchTab('dashboard')">Dashboard</button>
  <button onclick="switchTab('devices')">Devices</button>
  <button onclick="switchTab('bluetooth')">Bluetooth</button>
</div>

<div class="container">

<!-- Dashboard -->
<div id="tab-dashboard" class="section active">
  <div id="dash-cards"></div>
  <p id="dash-empty" style="text-align:center;color:var(--muted);padding:40px 0">No devices configured.</p>
</div>

<!-- Devices -->
<div id="tab-devices" class="section">
  <div id="dev-msg" class="msg"></div>
  <h3>Configured Devices</h3>
  <div id="dev-list"></div>
  <p id="dev-empty" style="color:var(--muted);text-align:center;padding:20px">No devices configured. Pair a headset in the Bluetooth tab first.</p>
</div>

<!-- Bluetooth -->
<div id="tab-bluetooth" class="section">
  <button class="scan-btn" onclick="btScan()">Scan for Devices</button>
  <div id="bt-spinner" class="spinner">Scanning&hellip; (up to 10s)</div>
  <div id="bt-msg" class="msg"></div>
  <h3>Paired Devices</h3>
  <div id="bt-paired" class="card"><p style="color:var(--muted)">Press Scan to refresh.</p></div>
  <h3>Nearby (Unpaired)</h3>
  <div id="bt-discovered" class="card" style="display:none"></div>
</div>

</div><!-- /container -->

<script>
function switchTab(name){
  document.querySelectorAll('.tabs button').forEach((b,i)=>{
    b.classList.toggle('active',['dashboard','devices','bluetooth'][i]===name);
  });
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  if(name==='dashboard') refreshDashboard();
  if(name==='devices') refreshDevices();
}

function fmt(sec){
  if(sec==null) return '--:--';
  let m=Math.floor(sec/60), s=Math.floor(sec%60);
  return m+':'+(s<10?'0':'')+s;
}

async function refreshDashboard(){
  try{
    let r=await fetch('/api/status');let data=await r.json();
    let el=document.getElementById('dash-cards');
    let empty=document.getElementById('dash-empty');
    if(!data.length){el.innerHTML='';empty.style.display='';return}
    empty.style.display='none';
    el.innerHTML=data.map(d=>`
      <div class="card">
        <div class="card-header">
          <span class="dot ${d.connected?'on':'off'}"></span>
          <span class="card-title">${esc(d.name)}</span>
          <span class="card-slot">Slot ${d.slot}</span>
        </div>
        <div class="now-playing">${d.title?esc(d.title)+' &mdash; '+fmt(d.position)+' / '+fmt(d.duration):'Not playing'}</div>
        <div class="controls">
          <button class="ctrl-btn" onclick="pbctl(${d.slot},'prev')">&#9198;</button>
          <button class="ctrl-btn" onclick="pbctl(${d.slot},'toggle')">${d.playing?'&#9646;&#9646;':'&#9654;'}</button>
          <button class="ctrl-btn" onclick="pbctl(${d.slot},'next')">&#9197;</button>
        </div>
      </div>`).join('');
  }catch(e){console.error(e)}
}

async function pbctl(slot,action){
  await fetch('/api/playback/'+slot+'/'+action,{method:'POST'});
  setTimeout(refreshDashboard,300);
}

async function refreshDevices(){
  let r=await fetch('/api/devices');let data=await r.json();
  let el=document.getElementById('dev-list');
  let empty=document.getElementById('dev-empty');
  if(!data.length){el.innerHTML='';empty.style.display='';return}
  empty.style.display='none';
  el.innerHTML=data.map(d=>`
    <div class="card" style="margin-bottom:10px">
      <div class="card-header">
        <span class="card-title">${esc(d.name)}</span>
        <span class="card-slot">Slot ${d.slot}</span>
      </div>
      <div class="device-shell">
        <div class="active-summary">
          <div>
            <div class="dev-mac">${esc(d.mac)}</div>
            <div class="dev-queue">Active queue: ${esc(d.active_queue||d.queue||'None')}</div>
          </div>
          <span class="pill ${d.active_queue?'active':'subtle'}">${d.active_shuffle?'Shuffled':'In order'}</span>
        </div>
        <div class="device-section">
          <div class="section-title">Fallback Queue</div>
          <div class="device-grid">
            <div class="form-group" style="margin-bottom:0">
              <label>Queue URL</label>
              <input id="queue-${d.slot}" value="${esc(d.queue||'')}" placeholder="Used when no schedule matches">
            </div>
            <div class="toggle-card">
              <label class="checkbox-row" style="padding:0">
                <input id="shuffle-${d.slot}" type="checkbox" ${d.shuffle===true?'checked':''}>
                <span class="toggle-label">Shuffle fallback queue</span>
              </label>
              <div class="toggle-help">If no schedule matches, this queue becomes the playlist source.</div>
            </div>
          </div>
        </div>
        <div class="device-section">
          <div class="section-title">Scheduled Queues</div>
          <div id="schedules-${d.slot}" class="schedule-list"></div>
          <div class="dev-queue" style="margin-bottom:8px">
            First matching schedule wins. Overnight windows like 19:00 to 07:00 work.
          </div>
          <button class="schedule-btn" type="button" onclick="addScheduleRow(${d.slot})">Add Schedule</button>
        </div>
        <div class="device-section">
          <div class="section-title">Resume Behavior</div>
          <div class="toggle-grid">
            <div class="toggle-card">
              <label class="checkbox-row" style="padding:0">
                <input id="resume-queue-${d.slot}" type="checkbox" ${d.resume_queue!==false?'checked':''}>
                <span class="toggle-label">Resume queue position</span>
              </label>
              <div class="toggle-help">If off, playback restarts from the first item in the active queue.</div>
            </div>
            <div class="toggle-card">
              <label class="checkbox-row" style="padding:0">
                <input id="resume-track-${d.slot}" type="checkbox" ${d.resume_track!==false?'checked':''}>
                <span class="toggle-label">Resume track position</span>
              </label>
              <div class="toggle-help">If off, the current track restarts from the beginning on reconnect.</div>
            </div>
          </div>
        </div>
        <div class="device-grid">
          <button class="pair-btn" style="width:100%;margin:0" onclick="saveDevice(${d.slot})">Save Settings</button>
          <button class="del-btn" style="width:100%" onclick="delDevice(${d.slot})">Remove Device</button>
        </div>
      </div>
    </div>`).join('');
  data.forEach(d=>hydrateSchedules(d.slot,d));
}

async function saveDevice(slot){
  let queue=document.getElementById('queue-'+slot).value.trim();
  let shuffle=document.getElementById('shuffle-'+slot).checked;
  let resume_queue=document.getElementById('resume-queue-'+slot).checked;
  let resume_track=document.getElementById('resume-track-'+slot).checked;
  let msg=document.getElementById('dev-msg');
  let schedules=collectSchedules(slot);
  if(schedules==null) return;
  let body={
    queue,shuffle,schedules,resume_queue,resume_track,
    alternate_queue:'',alternate_shuffle:false,alternate_start:'',alternate_end:''
  };
  let r=await fetch('/api/devices/'+slot,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let j=await r.json();
  if(j.ok){msg.className='msg ok';msg.textContent='Settings saved. Restarting...';await fetch('/api/service/restart',{method:'POST'});setTimeout(()=>{msg.className='msg'},2000)}
  else{msg.className='msg err';msg.textContent=j.error||'Failed'}
}

async function addDevice(mac,name){
  let msg=document.getElementById('bt-msg');
  let r=await fetch('/api/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mac,queue:'',shuffle:false,schedules:[],resume_queue:true,resume_track:true})});
  let j=await r.json();
  if(j.ok){
    msg.className='msg ok';msg.textContent='Added '+name+' as slot '+j.slot+'. Configure it on the Devices tab.';
    await fetch('/api/service/restart',{method:'POST'});
    refreshPaired();
    switchTab('devices');
  } else {msg.className='msg err';msg.textContent=j.error||'Failed'}
}

async function delDevice(slot){
  if(!confirm('Remove this device?')) return;
  await fetch('/api/devices/'+slot,{method:'DELETE'});
  await fetch('/api/service/restart',{method:'POST'});
  refreshDevices();
}

async function btScan(){
  document.getElementById('bt-spinner').classList.add('show');
  document.getElementById('bt-discovered').style.display='none';
  document.getElementById('bt-msg').className='msg';
  try{
    let r=await fetch('/api/bt/scan');let data=await r.json();
    document.getElementById('bt-spinner').classList.remove('show');
    // Separate paired vs unpaired
    let paired=data.filter(d=>d.paired);
    let unpaired=data.filter(d=>!d.paired);
    refreshPairedList(paired);
    let el=document.getElementById('bt-discovered');
    if(!unpaired.length){el.style.display='block';el.innerHTML='<p style="color:var(--muted)">No new devices found. Make sure your headset is in pairing mode.</p>';return}
    el.style.display='block';
    el.innerHTML=unpaired.map(d=>`
      <div class="dev-row">
        <div class="dev-info">
          <div class="dev-name">${esc(d.name)}</div>
          <div class="dev-mac">${esc(d.mac)}</div>
        </div>
        <button class="pair-btn" onclick="btPair('${esc(d.mac)}','${esc(d.name)}')">Pair</button>
      </div>`).join('');
  }catch(e){
    document.getElementById('bt-spinner').classList.remove('show');
    document.getElementById('bt-msg').className='msg err';
    document.getElementById('bt-msg').textContent='Scan failed: '+e;
  }
}

function refreshPairedList(paired){
  let el=document.getElementById('bt-paired');
  if(!paired||!paired.length){el.innerHTML='<p style="color:var(--muted)">No paired devices.</p>';return}
  el.innerHTML=paired.map(d=>`
    <div class="dev-row">
      <div class="dev-info">
        <div class="dev-name">${esc(d.name)}</div>
        <div class="dev-mac">${esc(d.mac)}</div>
      </div>
      ${d.configured?'<span style="color:var(--muted);font-size:13px">Slot '+d.configured_slot+'</span>':'<button class="add-link" onclick="addDevice(\''+esc(d.mac)+'\',\''+esc(d.name)+'\')">Add</button>'}
      <button class="unpair-btn" onclick="btUnpair('${esc(d.mac)}')">Unpair</button>
    </div>`).join('');
}

async function refreshPaired(){
  try{
    let r=await fetch('/api/bt/paired');let data=await r.json();
    refreshPairedList(data);
  }catch(e){}
}

async function btPair(mac,name){
  let msg=document.getElementById('bt-msg');
  msg.className='msg ok';msg.textContent='Pairing '+mac+'...';
  let r=await fetch('/api/bt/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mac})});
  let j=await r.json();
  if(j.ok){
    msg.className='msg ok';msg.textContent='Paired! Now add it as a device.';
    btScan();
  } else {msg.className='msg err';msg.textContent='Pair failed: '+(j.error||'')}
}

async function btUnpair(mac){
  if(!confirm('Unpair '+mac+'?')) return;
  let msg=document.getElementById('bt-msg');
  let r=await fetch('/api/bt/unpair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mac})});
  let j=await r.json();
  if(j.ok){msg.className='msg ok';msg.textContent='Unpaired.';await fetch('/api/service/restart',{method:'POST'})}
  else{msg.className='msg err';msg.textContent='Failed: '+(j.error||'')}
  btScan();
}

function esc(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function scheduleHtml(slot,index,schedule={}){
  let title=schedule.start&&schedule.end?`${schedule.start} - ${schedule.end}`:`Schedule ${index+1}`;
  let activeClass=schedule.isActive?'active':'subtle';
  let activeText=schedule.isActive?'Active now':'Scheduled';
  return `
    <div class="schedule-row" data-index="${index}">
      <div class="schedule-head">
        <div class="schedule-name">${esc(title)}</div>
        <span class="pill ${activeClass}">${activeText}</span>
      </div>
      <div class="schedule-grid">
        <div class="form-group" style="margin-bottom:0">
          <label>From</label>
          <input data-field="start" placeholder="07:00" value="${esc(schedule.start||'')}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>To</label>
          <input data-field="end" placeholder="19:00" value="${esc(schedule.end||'')}">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:8px">
        <label>Queue URL</label>
        <input data-field="queue" value="${esc(schedule.queue||'')}">
      </div>
      <div class="schedule-actions">
        <label class="checkbox-row" style="padding:0">
          <input data-field="shuffle" type="checkbox" ${schedule.shuffle===true?'checked':''}>
          <span>Shuffle this schedule</span>
        </label>
        <button class="schedule-remove" type="button" onclick="removeScheduleRow(this)">Remove</button>
      </div>
      <div class="schedule-meta">Use both times. Overnight windows like 19:00 to 07:00 work.</div>
    </div>`;
}

function legacySchedules(device){
  if(device.alternate_queue){
    return [{
      start:device.alternate_start||'',
      end:device.alternate_end||'',
      queue:device.alternate_queue||'',
      shuffle:device.alternate_shuffle===true
    }];
  }
  return [];
}

function hydrateSchedules(slot,device){
  let container=document.getElementById('schedules-'+slot);
  if(!container) return;
  let schedules=(Array.isArray(device.schedules)&&device.schedules.length)?device.schedules:legacySchedules(device);
  container.innerHTML='';
  schedules.forEach((schedule,index)=>{
    let enriched={...schedule,isActive:(schedule.queue||'')===(device.active_queue||'')};
    container.insertAdjacentHTML('beforeend',scheduleHtml(slot,index,enriched));
  });
}

function addScheduleRow(slot){
  let container=document.getElementById('schedules-'+slot);
  if(!container) return;
  let index=container.querySelectorAll('.schedule-row').length;
  container.insertAdjacentHTML('beforeend',scheduleHtml(slot,index,{}));
}

function removeScheduleRow(button){
  let row=button.closest('.schedule-row');
  if(row) row.remove();
}

function collectSchedules(slot){
  let rows=[...document.querySelectorAll('#schedules-'+slot+' .schedule-row')];
  let msg=document.getElementById('dev-msg');
  let schedules=[];
  for(let i=0;i<rows.length;i++){
    let row=rows[i];
    let start=row.querySelector('[data-field="start"]').value.trim();
    let end=row.querySelector('[data-field="end"]').value.trim();
    let queue=row.querySelector('[data-field="queue"]').value.trim();
    let shuffle=row.querySelector('[data-field="shuffle"]').checked;
    if(!start && !end && !queue){
      continue;
    }
    if(!queue){
      msg.className='msg err';
      msg.textContent='Each schedule needs a queue URL.';
      return null;
    }
    if((!start && end) || (start && !end)){
      msg.className='msg err';
      msg.textContent='Each schedule needs both start and end times.';
      return null;
    }
    schedules.push({start,end,queue,shuffle});
  }
  return schedules;
}

// Auto-refresh dashboard
setInterval(()=>{
  if(document.getElementById('tab-dashboard').classList.contains('active')) refreshDashboard();
},2000);
refreshDashboard();
</script>
</body>
</html>"""

# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet logs

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, html):
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    # ---- routing ----

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            return self._html(HTML_PAGE)
        if path == "/api/status":
            return self._get_status()
        if path == "/api/devices":
            return self._get_devices()
        if path == "/api/bt/scan":
            return self._bt_scan()
        if path == "/api/bt/paired":
            return self._bt_paired()
        self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/devices":
            return self._add_device()
        if path.startswith("/api/playback/"):
            parts = path.split("/")  # ['','api','playback','<slot>','<action>']
            if len(parts) == 5:
                return self._playback(int(parts[3]), parts[4])
        if path == "/api/bt/pair":
            return self._bt_pair()
        if path == "/api/bt/unpair":
            return self._bt_unpair()
        if path == "/api/service/restart":
            return self._service_restart()
        self.send_error(404)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path.startswith("/api/devices/"):
            slot = int(path.split("/")[-1])
            return self._update_device(slot)
        self.send_error(404)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/devices/"):
            slot = int(path.split("/")[-1])
            return self._del_device(slot)
        self.send_error(404)

    # ---- handlers ----

    def _get_status(self):
        devices = read_devices()
        results = []
        for d in devices:
            results.append(slot_status(d))
        self._json(results)

    def _get_devices(self):
        devices = []
        for device in read_devices():
            item = dict(device)
            item["active_queue"] = selected_queue(device)
            item["active_shuffle"] = selected_shuffle(device)
            devices.append(item)
        self._json(devices)

    def _add_device(self):
        body = self._read_body()
        name = body.get("name", "")
        mac = body.get("mac", "")
        if not name or not mac:
            return self._json({"ok": False, "error": "name and mac required"}, 400)
        devices = read_devices()
        slot = next_slot(devices)
        device = normalize_device({
            "slot": slot,
            "mac": mac,
            "name": name,
            "queue": body.get("queue", ""),
            "shuffle": body.get("shuffle", False),
            "schedules": body.get("schedules", []),
            "alternate_queue": body.get("alternate_queue", ""),
            "alternate_shuffle": body.get("alternate_shuffle", False),
            "alternate_start": body.get("alternate_start", ""),
            "alternate_end": body.get("alternate_end", ""),
            "resume_queue": body.get("resume_queue", True),
            "resume_track": body.get("resume_track", True),
        })
        error = validate_device_settings(device)
        if error:
            return self._json({"ok": False, "error": error}, 400)
        devices.append(device)
        write_devices(devices)
        slot_dir = SLOTS_DIR / str(slot)
        slot_dir.mkdir(parents=True, exist_ok=True)
        (slot_dir / "cache").mkdir(exist_ok=True)
        self._json({"ok": True, "slot": slot})

    def _del_device(self, slot):
        devices = read_devices()
        devices = [d for d in devices if d["slot"] != slot]
        write_devices(devices)
        self._json({"ok": True})

    def _update_device(self, slot):
        body = self._read_body()
        devices = read_devices()
        for d in devices:
            if d["slot"] == slot:
                if "queue" in body:
                    d["queue"] = body["queue"]
                if "shuffle" in body:
                    d["shuffle"] = normalize_bool(body["shuffle"], False)
                if "schedules" in body:
                    d["schedules"] = [
                        normalize_schedule_entry(entry)
                        for entry in body["schedules"]
                        if isinstance(entry, dict)
                    ]
                    d["alternate_queue"] = ""
                    d["alternate_shuffle"] = False
                    d["alternate_start"] = ""
                    d["alternate_end"] = ""
                if "name" in body:
                    d["name"] = body["name"]
                if "alternate_queue" in body:
                    d["alternate_queue"] = body["alternate_queue"]
                if "alternate_shuffle" in body:
                    d["alternate_shuffle"] = normalize_bool(body["alternate_shuffle"], False)
                if "alternate_start" in body:
                    d["alternate_start"] = body["alternate_start"]
                if "alternate_end" in body:
                    d["alternate_end"] = body["alternate_end"]
                if "resume_queue" in body:
                    d["resume_queue"] = normalize_bool(body["resume_queue"], True)
                if "resume_track" in body:
                    d["resume_track"] = normalize_bool(body["resume_track"], True)
                normalized = normalize_device(d)
                d.clear()
                d.update(normalized)
                error = validate_device_settings(d)
                if error:
                    return self._json({"ok": False, "error": error}, 400)
                break
        else:
            return self._json({"ok": False, "error": "slot not found"}, 404)
        write_devices(devices)
        self._json({"ok": True})

    def _playback(self, slot, action):
        sock_path = SLOTS_DIR / str(slot) / "mpv-socket"
        cmd_map = {
            "toggle": ["cycle", "pause"],
            "play":   ["set_property", "pause", False],
            "pause":  ["set_property", "pause", True],
            "next":   ["playlist-next"],
            "prev":   ["playlist-prev"],
        }
        cmd = cmd_map.get(action)
        if not cmd:
            return self._json({"ok": False, "error": "unknown action"}, 400)

        # On next/prev, refresh the queue first in case items were added
        if action in ("next", "prev"):
            devices = read_devices()
            device = next((d for d in devices if d["slot"] == slot), None)
            queue_url = selected_queue(device) if device else ""
            shuffle = selected_shuffle(device) if device else False
            if queue_url:
                if refresh_queue(slot, queue_url, shuffle=shuffle):
                    # Reload playlist in mpv, keeping current position
                    playlist_file = str(SLOTS_DIR / str(slot) / "playlist.m3u")
                    mpv_command(sock_path, ["loadlist", playlist_file])

        r = mpv_command(sock_path, cmd)
        self._json({"ok": r is not None, "response": r})

    def _bt_scan(self):
        # Run scan then list all devices with paired status
        try:
            subprocess.run(
                ["bluetoothctl", "--timeout", "10", "scan", "on"],
                capture_output=True, timeout=15
            )
        except Exception:
            pass
        # Get all discovered devices
        try:
            out = subprocess.check_output(
                ["bluetoothctl", "devices"],
                stderr=subprocess.DEVNULL, timeout=5
            ).decode()
        except Exception:
            return self._json([])
        devices = read_devices()
        configured = {d["mac"].upper(): d for d in devices}
        results = []
        for line in out.strip().splitlines():
            parts = line.split(None, 2)
            if len(parts) >= 3 and parts[0] == "Device":
                mac = parts[1]
                name = parts[2]
                # Check if paired
                paired = False
                try:
                    info = subprocess.check_output(
                        ["bluetoothctl", "info", mac],
                        stderr=subprocess.DEVNULL, timeout=3
                    ).decode()
                    paired = "Paired: yes" in info
                except Exception:
                    pass
                entry = {"mac": mac, "name": name, "paired": paired}
                cfg = configured.get(mac.upper())
                if cfg:
                    entry["configured"] = True
                    entry["configured_slot"] = cfg["slot"]
                else:
                    entry["configured"] = False
                results.append(entry)
        self._json(results)

    def _bt_paired(self):
        # Return only paired devices with their configured status
        try:
            out = subprocess.check_output(
                ["bluetoothctl", "devices", "Paired"],
                stderr=subprocess.DEVNULL, timeout=5
            ).decode()
        except Exception:
            # Fallback: list all and filter
            try:
                out = subprocess.check_output(
                    ["bluetoothctl", "devices"],
                    stderr=subprocess.DEVNULL, timeout=5
                ).decode()
            except Exception:
                return self._json([])
        devices = read_devices()
        configured = {d["mac"].upper(): d for d in devices}
        results = []
        for line in out.strip().splitlines():
            parts = line.split(None, 2)
            if len(parts) >= 3 and parts[0] == "Device":
                mac = parts[1]
                name = parts[2]
                # Verify paired
                try:
                    info = subprocess.check_output(
                        ["bluetoothctl", "info", mac],
                        stderr=subprocess.DEVNULL, timeout=3
                    ).decode()
                    if "Paired: yes" not in info:
                        continue
                except Exception:
                    continue
                entry = {"mac": mac, "name": name, "paired": True}
                cfg = configured.get(mac.upper())
                if cfg:
                    entry["configured"] = True
                    entry["configured_slot"] = cfg["slot"]
                else:
                    entry["configured"] = False
                results.append(entry)
        self._json(results)

    def _bt_pair(self):
        body = self._read_body()
        mac = body.get("mac", "")
        if not mac:
            return self._json({"ok": False, "error": "mac required"}, 400)
        try:
            subprocess.run(
                f"bluetoothctl pair {mac} && bluetoothctl trust {mac}",
                shell=True, capture_output=True, timeout=30
            )
            self._json({"ok": True})
        except Exception as e:
            self._json({"ok": False, "error": str(e)})

    def _bt_unpair(self):
        body = self._read_body()
        mac = body.get("mac", "")
        if not mac:
            return self._json({"ok": False, "error": "mac required"}, 400)
        try:
            subprocess.run(
                f"bluetoothctl untrust {mac} && bluetoothctl remove {mac}",
                shell=True, capture_output=True, timeout=15
            )
            self._json({"ok": True})
        except Exception as e:
            self._json({"ok": False, "error": str(e)})

    def _service_restart(self):
        try:
            subprocess.run(
                ["systemctl", "--user", "restart", "musicozy.service"],
                capture_output=True, timeout=15
            )
            self._json({"ok": True})
        except Exception as e:
            self._json({"ok": False, "error": str(e)})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"MusiCozy web UI running on http://0.0.0.0:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
