#!/usr/bin/env python3
"""Tiny fake mpv JSON-IPC server over a UNIX socket.

Shared test infrastructure for playback-hub helper tests (Unit D1) and the
later reconcile-live regression test (Unit H). It mimics just enough of mpv's
JSON IPC protocol to exercise the bash mpv_* helpers without a real mpv.

Protocol: clients connect to the UNIX socket and send newline-delimited JSON
commands. Each command gets a newline-delimited JSON response. socat opens a
fresh connection per invocation (`echo ... | socat - UNIX socket`), so we must
handle short-lived connections that send one command then close.

Supported commands:
  get_property playlist-count  -> {"data":<len>,"error":"success"}
  get_property playlist-pos    -> {"data":<pos>,"error":"success"}
  get_property path            -> {"data":"<current file>","error":"success"}
  loadlist <m3u> replace       -> replace in-memory playlist from m3u, pos=0
  loadfile <path> append       -> append to playlist
  set_property playlist-pos N  -> set pos
  (anything else)              -> {"error":"success"}  (lenient, never crash)

State (playlist + pos) is shared across connections via module globals, so a
test can query state through one socat call after mutating it through another.

Exits cleanly on SIGTERM/SIGINT and removes its socket. Also self-terminates
if the socket file disappears underneath it.
"""
import argparse
import json
import os
import signal
import socket
import sys
import threading

# Shared mutable state across connections.
_lock = threading.Lock()
PLAYLIST = []   # list of file paths
POS = 0         # current playlist position
MEDIA_TITLE = ""          # mpv `media-title`
AUDIO_DEVICE = ""         # mpv `audio-device` (configured output sink)
AUDIO_DEVICE_LIST = []    # mpv `audio-device-list` device names
META = {}                 # mpv `metadata` / `metadata/by-key/<k>` (lowercase keys)


def _read_m3u(path):
    """Return non-comment, non-blank lines from an m3u file."""
    entries = []
    try:
        with open(path, "r") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                entries.append(line)
    except OSError:
        pass
    return entries


def handle_command(cmd):
    """Process one parsed command dict, return a response dict."""
    global PLAYLIST, POS
    args = cmd.get("command", [])
    if not isinstance(args, list) or not args:
        return {"error": "success"}

    op = args[0]

    with _lock:
        if op == "get_property" and len(args) >= 2:
            prop = args[1]
            if prop == "playlist-count":
                return {"data": len(PLAYLIST), "error": "success"}
            if prop == "playlist-pos":
                return {"data": POS, "error": "success"}
            if prop == "path":
                if 0 <= POS < len(PLAYLIST):
                    return {"data": PLAYLIST[POS], "error": "success"}
                # mpv returns an error when no file is loaded.
                return {"error": "property unavailable"}
            if prop == "media-title":
                return {"data": MEDIA_TITLE, "error": "success"}
            if prop == "audio-device":
                return {"data": AUDIO_DEVICE, "error": "success"}
            if prop == "audio-device-list":
                return {"data": [{"name": n, "description": n}
                                 for n in AUDIO_DEVICE_LIST], "error": "success"}
            if prop == "metadata":
                return {"data": dict(META), "error": "success"}
            if prop.startswith("metadata/by-key/"):
                key = prop.split("/", 2)[2].lower()
                if key in META:
                    return {"data": META[key], "error": "success"}
                # mpv reports an error for an absent tag key.
                return {"error": "property unavailable"}
            return {"data": None, "error": "success"}

        if op == "loadlist" and len(args) >= 2:
            entries = _read_m3u(args[1])
            PLAYLIST = entries
            POS = 0
            return {"error": "success"}

        if op == "loadfile" and len(args) >= 2:
            PLAYLIST.append(args[1])
            return {"error": "success"}

        if op == "set_property" and len(args) >= 3 and args[1] == "playlist-pos":
            try:
                POS = int(args[2])
            except (TypeError, ValueError):
                pass
            return {"error": "success"}

    # Lenient default — unknown commands succeed but do nothing.
    return {"error": "success"}


def serve(sock_path):
    if os.path.exists(sock_path):
        os.unlink(sock_path)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(sock_path)
    server.listen(16)
    server.settimeout(0.5)  # so we can periodically check for socket removal

    def shutdown(*_a):
        try:
            server.close()
        finally:
            if os.path.exists(sock_path):
                try:
                    os.unlink(sock_path)
                except OSError:
                    pass
            sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    while True:
        # If the socket file was removed externally, exit cleanly.
        if not os.path.exists(sock_path):
            shutdown()
        try:
            conn, _ = server.accept()
        except socket.timeout:
            continue
        except OSError:
            break
        threading.Thread(target=_serve_conn, args=(conn,), daemon=True).start()


def _serve_conn(conn):
    """Handle newline-delimited commands on a single connection."""
    conn.settimeout(2.0)
    buf = b""
    try:
        while True:
            try:
                chunk = conn.recv(4096)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    cmd = json.loads(line.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    resp = {"error": "invalid"}
                else:
                    resp = handle_command(cmd)
                # Compact separators to match real mpv's framing
                # (`{"error":"success"}` with no spaces), which the bash
                # helpers grep for literally.
                payload = json.dumps(resp, separators=(",", ":"))
                conn.sendall((payload + "\n").encode("utf-8"))
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("socket", help="UNIX socket path to listen on")
    ap.add_argument("--playlist", default="",
                    help="comma-separated initial playlist entries")
    ap.add_argument("--pos", type=int, default=0,
                    help="initial playlist position")
    ap.add_argument("--media-title", default="",
                    help="value for mpv `media-title`")
    ap.add_argument("--audio-device", default="",
                    help="value for mpv `audio-device` (configured sink)")
    ap.add_argument("--audio-device-list", default="",
                    help="comma-separated device names for `audio-device-list`")
    ap.add_argument("--meta", default="",
                    help="comma-separated key=value embedded tags "
                         "(e.g. artist=Foo,album=Bar)")
    args = ap.parse_args()

    global PLAYLIST, POS, MEDIA_TITLE, AUDIO_DEVICE, AUDIO_DEVICE_LIST, META
    if args.playlist:
        PLAYLIST = [p for p in args.playlist.split(",") if p]
    POS = args.pos
    MEDIA_TITLE = args.media_title
    AUDIO_DEVICE = args.audio_device
    if args.audio_device_list:
        AUDIO_DEVICE_LIST = [d for d in args.audio_device_list.split(",") if d]
    if args.meta:
        for pair in args.meta.split(","):
            if "=" in pair:
                k, v = pair.split("=", 1)
                META[k.strip().lower()] = v

    serve(args.socket)


if __name__ == "__main__":
    main()
