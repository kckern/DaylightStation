# playback-hub: Central Cache + Self-Heal + Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Replace the per-slot cache and racy lazy-priming with a central, self-validating cache and a tiered self-healing reconciler, and add postmortem-grade structured logging — fixing the "partial tracks looping a subset" bug at its root.

**Architecture:** A new `cache_manager.sh` (sourced by `playback-hub.sh`) is the sole owner of `~/playback-hub/cache/<plex_id>.mp3` + `<plex_id>.meta.json`. Downloads are per-file `flock`-locked, written atomically (`.partial` → `fsync` → `mv`), and validated by exact byte-match against the server's `Content-Length`. Per-slot `playlist.m3u` files become reference lists into the central cache. A single reconciler owns all freshness cadence: membership re-fetch+hash-diff (~60s), rolling `HEAD` content-change (full pass ~15min), on-download integrity, on-failure revalidation, and an hourly ref-counted orphan sweep. The warm-cache race is killed by sequencing (prime → start mpv → **wait for socket** → fork bg → **verified** append → authoritative `loadlist replace`). A structured `logev` emitter writes greppable `key=val` lines to `hub.log` and a machine-readable `slots/<N>/events.jsonl`.

**Tech Stack:** Bash (`set -euo pipefail`), `jq`, `socat`, `curl`, `flock`, mpv JSON IPC, Python 3 (web.py stdlib only). No new system dependencies (byte-match validation drops the need for `ffprobe`).

**Decisions locked in brainstorming (2026-05-29):**
- Self-heal scope: all three — playlist membership drift, file integrity (partial/corrupt), and server-side content change.
- Change signal: **HTTP headers only** (`Content-Length` + `Last-Modified`) — no DaylightStation backend change.
- Integrity check: **exact byte-match vs `Content-Length`** (user: "filesize check is fine"); fallback to `size > MIN_AUDIO_BYTES` when the endpoint omits `Content-Length` (log when this happens).
- Cadence: tiered (membership ~60s, HEAD rolling ~15min full pass, integrity on download, revalidate on playback failure).
- Eviction: ref-counted hourly sweep (live set = union of all slots' current queues; delete unreferenced + `atime > 7d`; 2 GB LRU backstop).
- Logging: structured `key=val` + per-slot `events.jsonl`; replace the lying `[bg] all tracks cached and appended` line.

**Execution constraints (from user):** no worktree — work in place on `main`; subagent-driven execution; deploy in place. **Per repo rules: do NOT commit and do NOT deploy without explicit user go-ahead at the relevant task.**

**Reference files:**
- `_extensions/playback-hub/playback-hub.sh` — main daemon (function map below)
- `_extensions/playback-hub/web.py` — `slot_status()` ~L264, status `get_property` reads ~L287-308
- `_extensions/playback-hub/README.md` — architecture + audio-flow troubleshooting (read before editing playback path)
- Memory: `feedback_playback_hub_lane_guardrail_silenced_audio.md` — **do NOT** reintroduce `--audio-fallback-to-null`, `node.dont-reconnect`, or disconnect-time `ao-mute`.

**Key existing functions (line numbers approximate, verify before editing):**
- `is_valid_audio_file()` L592, `download_media_file()` L612, `file_size_bytes()` L588, `curl_api()` L570
- `save_position()` L893, `stop_playback()` L913, `end_session()` L979
- `fetch_and_cache()` L999, `reload_mpv_playlist()` L1155, `start_playback()` L1184
- `refresh_loop()` L1331, `mpv_watchdog()` L1376, `monitor()` L1440
- Config block L4-23 (`BASE_DIR`, `API_BASE`, `REFRESH_INTERVAL=300`, `LAZY_PRIME_COUNT=5`, `MIN_AUDIO_BYTES=2048`)
- `log()` L67, `slot_dir()` L69

---

## Phase 0 — Test scaffolding

### Task 1: Make `playback-hub.sh` sourceable + create a bash test harness

**Files:**
- Modify: `_extensions/playback-hub/playback-hub.sh` (bottom-of-file command dispatch)
- Create: `_extensions/playback-hub/tests/helpers.sh`
- Create: `_extensions/playback-hub/tests/run_tests.sh`
- Create: `_extensions/playback-hub/tests/test_smoke.sh`

**Step 1: Guard the command dispatch so sourcing doesn't launch the daemon.**
Find the bottom dispatch (`case "${1:-}" in … monitor) monitor ;; … esac`). Wrap it:
```bash
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # ... existing case dispatch unchanged ...
fi
```
Also guard against `set -euo pipefail` breaking sourced tests: tests will `set +e` around assertions.

**Step 2: Write `tests/helpers.sh`:**
```bash
#!/usr/bin/env bash
# Minimal bash test helpers. No external deps.
TESTS_RUN=0; TESTS_FAILED=0
_t_tmproot=""
setup_tmp() { _t_tmproot=$(mktemp -d); echo "$_t_tmproot"; }
teardown_tmp() { [[ -n "$_t_tmproot" && -d "$_t_tmproot" ]] && rm -rf "$_t_tmproot"; }
assert_eq() { # expected actual [msg]
  TESTS_RUN=$((TESTS_RUN+1))
  if [[ "$1" != "$2" ]]; then
    TESTS_FAILED=$((TESTS_FAILED+1))
    echo "  FAIL: ${3:-assert_eq}: expected [$1] got [$2]"; return 1
  fi
}
assert_true() { TESTS_RUN=$((TESTS_RUN+1)); if ! eval "$1"; then TESTS_FAILED=$((TESTS_FAILED+1)); echo "  FAIL: ${2:-assert_true}: [$1]"; return 1; fi; }
assert_false(){ TESTS_RUN=$((TESTS_RUN+1)); if eval "$1"; then TESTS_FAILED=$((TESTS_FAILED+1)); echo "  FAIL: ${2:-assert_false}: [$1]"; return 1; fi; }
finish() { echo "Ran $TESTS_RUN, failed $TESTS_FAILED"; [[ $TESTS_FAILED -eq 0 ]]; }
```

**Step 3: Write `tests/run_tests.sh`:**
```bash
#!/usr/bin/env bash
cd "$(dirname "$0")"
fail=0
for t in test_*.sh; do
  echo "== $t =="
  bash "$t" || fail=1
done
exit $fail
```

**Step 4: Write `tests/test_smoke.sh`** that sources the script in test mode and asserts a pure helper works:
```bash
#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"   # must NOT launch daemon
assert_eq "$HOME/playback-hub/slots/3" "$(slot_dir 3)" "slot_dir builds path"
teardown_tmp; finish
```

**Step 5: Run** `bash tests/run_tests.sh` — Expected: PASS, "failed 0". (If sourcing launches the daemon, the guard in Step 1 is wrong — fix before continuing.)

**Step 6: Commit** (await user go per repo rules): `git add _extensions/playback-hub/tests _extensions/playback-hub/playback-hub.sh && git commit -m "test(playback-hub): sourceable script + bash test harness"`

---

## Phase 1 — Central cache manager

### Task 2: `cache_manager.sh` skeleton + path helpers

**Files:**
- Create: `_extensions/playback-hub/cache_manager.sh`
- Modify: `_extensions/playback-hub/playback-hub.sh` (config block + source line)
- Create: `_extensions/playback-hub/tests/test_cache_paths.sh`

**Step 1 (failing test) `tests/test_cache_paths.sh`:**
```bash
#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
assert_eq "$HOME/playback-hub/cache/565437.mp3"       "$(cache_path 565437)" "cache_path"
assert_eq "$HOME/playback-hub/cache/565437.meta.json" "$(meta_path 565437)"  "meta_path"
teardown_tmp; finish
```
Run: `bash tests/test_cache_paths.sh` → FAIL (`cache_path: command not found`).

**Step 2: Add config to `playback-hub.sh` config block (after L23):**
```bash
CACHE_DIR="$BASE_DIR/cache"
CACHE_MAX_BYTES=$((2*1024*1024*1024))  # 2 GB orphan-sweep backstop
ORPHAN_TTL_DAYS=7                      # unreferenced files older than this are sweepable
MEMBERSHIP_INTERVAL=60                 # seconds between per-slot queue re-fetch + hash-diff
HEAD_FULL_PASS=900                     # target seconds for a full content-change HEAD pass
SWEEP_INTERVAL=3600                    # seconds between orphan sweeps
```

**Step 3: Add source line in `playback-hub.sh`** immediately after the config block (before `refresh_config_cache`), so functions are available and overridable in tests:
```bash
# shellcheck source=cache_manager.sh
source "$BASE_DIR/cache_manager.sh"
```
> Note: in tests `BASE_DIR` resolves under the temp `HOME`; copy `cache_manager.sh` is found relative to the real script dir. Use this resilient form instead:
```bash
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_SCRIPT_DIR/cache_manager.sh"
```

**Step 4: Create `cache_manager.sh` with path helpers:**
```bash
#!/usr/bin/env bash
# Central cache manager — the ONLY writer of $CACHE_DIR. Sourced by playback-hub.sh.
# Relies on these from the parent: CACHE_DIR, MIN_AUDIO_BYTES, log(), logev() (Phase 5),
# curl_api(), API_BASE.

cache_path() { echo "$CACHE_DIR/$1.mp3"; }
meta_path()  { echo "$CACHE_DIR/$1.meta.json"; }
cache_lock() { echo "$CACHE_DIR/$1.lock"; }
```

**Step 5: Run** `bash tests/test_cache_paths.sh` → PASS.

**Step 6: Commit** (await go): `feat(playback-hub): cache_manager skeleton + central cache config`

### Task 3: Meta sidecar read/write

**Files:** Modify `cache_manager.sh`; Create `tests/test_cache_meta.sh`

**Step 1 (failing test):**
```bash
#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
mkdir -p "$CACHE_DIR"
cache_meta_write 565437 8423901 "Wed, 28 May 2026 10:00:00 GMT" "/api/v1/proxy/plex/stream/565437"
assert_eq "8423901" "$(cache_meta_get 565437 content_length)" "meta content_length"
assert_eq "Wed, 28 May 2026 10:00:00 GMT" "$(cache_meta_get 565437 last_modified)" "meta last_modified"
teardown_tmp; finish
```

**Step 2: Implement in `cache_manager.sh`:**
```bash
cache_meta_write() { # plex_id content_length last_modified source_url
    local id="$1" clen="${2:-}" lastmod="${3:-}" src="${4:-}"
    local size; size=$(file_size_bytes "$(cache_path "$id")")
    jq -n --arg clen "$clen" --arg lm "$lastmod" --arg src "$src" \
          --argjson size "${size:-0}" \
        '{content_length:($clen|select(.!="")|tonumber? // null),
          last_modified:($lm|select(.!="")// null),
          source_url:$src, size:$size}' \
        > "$(meta_path "$id").tmp" && mv "$(meta_path "$id").tmp" "$(meta_path "$id")"
}
cache_meta_get() { # plex_id field  -> value or empty
    local id="$1" field="$2" mp; mp="$(meta_path "$id")"
    [[ -f "$mp" ]] || return 0
    jq -r --arg f "$field" '.[$f] // empty' "$mp" 2>/dev/null
}
```

**Step 3: Run** → PASS. **Step 4: Commit** (await go): `feat(playback-hub): cache meta sidecar read/write`

### Task 4: `validate_cached` — byte-match integrity

**Files:** Modify `cache_manager.sh`; Create `tests/test_validate_cached.sh`

**Step 1 (failing test):**
```bash
#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
mkdir -p "$CACHE_DIR"
# full file: size matches content_length -> valid
head -c 5000 /dev/urandom > "$(cache_path 111)"
cache_meta_write 111 5000 "" "u"
assert_true  "validate_cached 111" "full file valid"
# truncated: size < content_length -> invalid
head -c 1200 /dev/urandom > "$(cache_path 222)"
cache_meta_write 222 9999 "" "u"
assert_false "validate_cached 222" "truncated invalid"
# no content_length: fall back to size>MIN_AUDIO_BYTES
head -c 5000 /dev/urandom > "$(cache_path 333)"
cache_meta_write 333 "" "" "u"
assert_true  "validate_cached 333" "no clen falls back to size floor"
# missing file -> invalid
assert_false "validate_cached 444" "missing file invalid"
teardown_tmp; finish
```

**Step 2: Implement:**
```bash
validate_cached() { # plex_id -> 0 valid / 1 invalid
    local id="$1" f; f="$(cache_path "$id")"
    [[ -f "$f" ]] || return 1
    local size clen; size=$(file_size_bytes "$f"); clen=$(cache_meta_get "$id" content_length)
    if [[ -n "$clen" && "$clen" != "null" && "$clen" -gt 0 ]]; then
        [[ "$size" -eq "$clen" ]] && return 0 || return 1
    fi
    # No Content-Length known: best-effort floor.
    (( size >= MIN_AUDIO_BYTES )) && return 0 || return 1
}
```

**Step 3: Run** → PASS. **Step 4: Commit** (await go): `feat(playback-hub): byte-match cache validation`

### Task 5: `cache_download` — locked, atomic, Content-Length capture + verify

**Files:** Modify `cache_manager.sh`; Create `tests/test_cache_download.sh`

**Step 1 (failing test)** — uses a stubbed `curl_api_with_headers` so no network:
```bash
#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
mkdir -p "$CACHE_DIR"
# Stub the header-capturing fetch: writes body + sets _DL_CLEN/_DL_LASTMOD
curl_fetch_to() { local url="$1" dest="$2"; head -c 4096 /dev/urandom > "$dest"; _DL_CLEN=4096; _DL_LASTMOD="Wed, 28 May 2026 10:00:00 GMT"; return 0; }
assert_true "cache_download 777 'http://x/777' red" "download ok"
assert_true "validate_cached 777" "downloaded file validates"
assert_eq "4096" "$(cache_meta_get 777 content_length)" "meta captured clen"
# truncated server response (body shorter than advertised) -> reject
curl_fetch_to() { local url="$1" dest="$2"; head -c 100 /dev/urandom > "$dest"; _DL_CLEN=9999; _DL_LASTMOD=""; return 0; }
assert_false "cache_download 888 'http://x/888' red" "short body rejected"
assert_false "test -f '$(cache_path 888)'" "no partial left behind"
teardown_tmp; finish
```

**Step 2: Implement `curl_fetch_to` (real) + `cache_download` in `cache_manager.sh`:**
```bash
# Fetch URL to dest, capturing Content-Length + Last-Modified into globals.
# Real implementation; tests override this stub.
curl_fetch_to() { # url dest -> sets _DL_CLEN _DL_LASTMOD ; 0 on transport success
    local url="$1" dest="$2" hdr; hdr="$(mktemp)"
    _DL_CLEN=""; _DL_LASTMOD=""
    if ! curl_api_dump "$url" "$dest" "$hdr"; then rm -f "$hdr"; return 1; fi
    _DL_CLEN=$(awk 'tolower($1)=="content-length:"{gsub("\r","",$2);print $2}' "$hdr" | tail -1)
    _DL_LASTMOD=$(awk 'tolower($1)=="last-modified:"{$1="";sub(/^ /,"");gsub("\r","",$0);print}' "$hdr" | tail -1)
    rm -f "$hdr"; return 0
}

cache_download() { # plex_id url name -> 0 valid file in place / 1 fail
    local id="$1" url="$2" name="$3"
    mkdir -p "$CACHE_DIR"
    exec 8>"$(cache_lock "$id")"
    flock 8                                  # serialize concurrent fetchers of same id
    if validate_cached "$id"; then exec 8>&-; return 0; fi   # someone else finished
    local dest part; dest="$(cache_path "$id")"; part="${dest}.partial"
    rm -f "$part"
    if ! curl_fetch_to "$url" "$part"; then
        logev "$name" cache.download_fail plex_id="$id" reason=transport
        rm -f "$part"; exec 8>&-; return 1
    fi
    sync "$part" 2>/dev/null || true
    local got="$(file_size_bytes "$part")"
    if [[ -n "${_DL_CLEN:-}" && "$_DL_CLEN" -gt 0 ]]; then
        if [[ "$got" -ne "$_DL_CLEN" ]]; then
            logev "$name" cache.integrity_fail plex_id="$id" reason=short got="$got" want="$_DL_CLEN" action=reject
            rm -f "$part"; exec 8>&-; return 1
        fi
    else
        if (( got < MIN_AUDIO_BYTES )); then
            logev "$name" cache.integrity_fail plex_id="$id" reason=tiny got="$got" action=reject
            rm -f "$part"; exec 8>&-; return 1
        fi
        logev "$name" cache.no_content_length plex_id="$id" got="$got" note=size_floor_only
    fi
    mv "$part" "$dest"
    cache_meta_write "$id" "${_DL_CLEN:-}" "${_DL_LASTMOD:-}" "$url"
    logev "$name" cache.download plex_id="$id" bytes="$got" expected="${_DL_CLEN:-unknown}" ok=true
    exec 8>&-; return 0
}
```

**Step 3: Add `curl_api_dump`** near `curl_api()` (L570) in `playback-hub.sh` — writes body to a file and headers to a second file, honoring the existing API fallback:
```bash
# Like curl_api but streams body to $2 and dumps response headers to $3.
curl_api_dump() { # url body_dest header_dest
    local url="$1" body="$2" hdrs="$3"
    if curl -fsSL --max-time 60 -D "$hdrs" -o "$body" "$url"; then return 0; fi
    local fb="${url/$API_BASE/$API_FALLBACK_BASE}"
    [[ "$fb" != "$url" ]] && curl -fsSL --max-time 60 -D "$hdrs" -o "$body" "$fb"
}
```

**Step 4: Run** → PASS. **Step 5: Commit** (await go): `feat(playback-hub): locked atomic cache_download with Content-Length verify`

### Task 6: `get_cached_path` — single entry point

**Files:** Modify `cache_manager.sh`; Create `tests/test_get_cached_path.sh`

**Step 1 (failing test):**
```bash
# valid existing file -> returns path, no download
# invalid/missing -> triggers cache_download, returns path on success, empty+fail on download fail
```
(Full test mirrors Task 5 stub style: stub `cache_download` to track calls.)

**Step 2: Implement:**
```bash
get_cached_path() { # plex_id url name -> prints path, returns 0; on failure returns 1, prints nothing
    local id="$1" url="$2" name="$3"
    if validate_cached "$id"; then echo "$(cache_path "$id")"; return 0; fi
    logev "$name" cache.repair plex_id="$id" reason=invalid_or_missing
    if cache_download "$id" "$url" "$name"; then echo "$(cache_path "$id")"; return 0; fi
    return 1
}
```

**Step 3: Run** → PASS. **Step 4: Commit** (await go): `feat(playback-hub): get_cached_path entry point`

---

## Phase 2 — Migration

### Task 7: Hard-link existing per-slot caches into central + backfill meta

**Files:** Modify `cache_manager.sh` (`migrate_per_slot_caches`); Modify `playback-hub.sh` `monitor()` (call once at startup); Create `tests/test_migrate.sh`

**Step 1 (failing test):** create `slots/1/cache/565437.mp3` + `slots/2/cache/565437.mp3` (same id), run `migrate_per_slot_caches`, assert `cache/565437.mp3` exists and is hard-linked (same inode as one source), and a `.meta.json` exists (with `content_length` null when offline — stub the HEAD).

**Step 2: Implement:**
```bash
migrate_per_slot_caches() {
    mkdir -p "$CACHE_DIR"
    local moved=0 src id central
    shopt -s nullglob
    for src in "$BASE_DIR"/slots/*/cache/*.mp3; do
        id="$(basename "$src" .mp3)"; central="$(cache_path "$id")"
        if [[ ! -e "$central" ]]; then
            ln "$src" "$central" 2>/dev/null || cp "$src" "$central"
            [[ -f "$(meta_path "$id")" ]] || cache_meta_backfill "$id"
            moved=$((moved+1))
        fi
    done
    shopt -u nullglob
    [[ $moved -gt 0 ]] && logev migrate cache.migrated count="$moved" || true
}
cache_meta_backfill() { # plex_id — HEAD the source_url if resolvable, else size-only meta
    local id="$1" url="${API_BASE}/api/v1/proxy/plex/stream/${id}" clen lm
    read -r clen lm < <(head_fetch "$url" 2>/dev/null || echo " ")
    cache_meta_write "$id" "$clen" "$lm" "$url"
}
```
(`head_fetch` is defined in Task 16; if migration runs before that task lands, gate the backfill behind `command -v head_fetch`.)

**Step 3: Call in `monitor()`** (L1440) after `refresh_config_cache`, before the BT watch loop starts:
```bash
migrate_per_slot_caches || true
```

**Step 4: Run** → PASS. **Step 5: Commit** (await go): `feat(playback-hub): migrate per-slot caches into central (hard-link)`

---

## Phase 3 — Race fix + central cache in the playback path

### Task 8: `wait_for_mpv_socket` readiness poll

**Files:** Modify `playback-hub.sh` (near `start_playback`); Create `tests/test_wait_socket.sh`

**Step 1 (failing test):** assert it returns 1 quickly for a missing socket with a short timeout, and 0 when a socket file appears mid-wait (create one with `python3 -c` UNIX socket or just `nc -lU` in background; simplest: touch a file and have the function accept `-S` OR a test hook). Keep the real check `[[ -S ]]`.

**Step 2: Implement:**
```bash
wait_for_mpv_socket() { # dir timeout_sec -> 0 when socket is live
    local socket="$1/mpv-socket" timeout="${2:-5}" waited=0
    while (( waited * 10 < timeout * 10 )); do
        [[ -S "$socket" ]] && return 0
        sleep 0.2; waited=$((waited+1)); (( waited >= timeout*5 )) && break
    done
    [[ -S "$socket" ]]
}
```

**Step 3: Run** → PASS. **Step 4: Commit** (await go): `feat(playback-hub): wait_for_mpv_socket readiness poll`

### Task 9: mpv IPC helpers — verified command + playlist-count readback

**Files:** Modify `playback-hub.sh`; integration-tested in Task 12/23.

**Step 1: Implement** (place near `reload_mpv_playlist` L1155):
```bash
mpv_ipc() { # socket json -> prints raw response, returns 0 if "error":"success"
    local socket="$1" json="$2" resp
    [[ -S "$socket" ]] || return 1
    resp=$(echo "$json" | socat - "$socket" 2>/dev/null) || return 1
    echo "$resp"
    echo "$resp" | grep -q '"error":"success"'
}
mpv_playlist_count() { # socket -> integer (0 if unavailable)
    local socket="$1" r
    r=$(echo '{"command":["get_property","playlist-count"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // 0') || r=0
    echo "${r:-0}"
}
mpv_current_plexid() { # socket -> plex_id of current entry (basename minus .mp3), or empty
    local socket="$1" path
    path=$(echo '{"command":["get_property","path"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // empty')
    [[ -n "$path" ]] && basename "$path" .mp3 || true
}
```

**Step 2: Commit** (await go): `feat(playback-hub): verified mpv IPC + playlist-count readback`

### Task 10: `loadlist_replace_preserving_pos`

**Files:** Modify `playback-hub.sh` (replaces ad-hoc `loadlist` in `reload_mpv_playlist` L1155 + web.py path); integration-tested in Task 24.

**Step 1: Implement:**
```bash
loadlist_replace_preserving_pos() { # slot name -> reload playlist.m3u, keep current track if it survives
    local slot="$1" name="$2" dir; dir="$(slot_dir "$slot")"
    local socket="$dir/mpv-socket"
    [[ -S "$socket" ]] || { logev "$name" reconcile.skip slot="$slot" reason=no_socket; return 1; }
    local cur_id before; cur_id="$(mpv_current_plexid "$socket")"; before="$(mpv_playlist_count "$socket")"
    mpv_ipc "$socket" "{\"command\":[\"loadlist\",\"$dir/playlist.m3u\",\"replace\"]}" >/dev/null || {
        logev "$name" reconcile.fail slot="$slot" reason=loadlist; return 1; }
    # Seek back onto the surviving track by index, if present.
    local idx=-1 i=0 line
    if [[ -n "$cur_id" ]]; then
        while IFS= read -r line; do
            [[ "$line" == \#* || -z "$line" ]] && continue
            [[ "$(basename "$line" .mp3)" == "$cur_id" ]] && { idx=$i; break; }
            i=$((i+1))
        done < "$dir/playlist.m3u"
    fi
    if (( idx >= 0 )); then
        mpv_ipc "$socket" "{\"command\":[\"set_property\",\"playlist-pos\",$idx]}" >/dev/null || true
    fi
    local after; after="$(mpv_playlist_count "$socket")"
    logev "$name" reconcile.loadlist slot="$slot" mpv_count="${before}→${after}" cur_track_survived="$([[ $idx -ge 0 ]] && echo true || echo false)"
}
```

**Step 2: Commit** (await go): `feat(playback-hub): position-preserving loadlist replace`

### Task 11: Refactor `fetch_and_cache` onto the central cache

**Files:** Modify `playback-hub.sh` `fetch_and_cache()` L999-1153

**Step 1:** Split the existing function. Keep the queue fetch + `is_valid_queue_json` + shuffle/order build (L1023-1071) but:
- Replace per-slot `cached_file="$dir/cache/${plex_id}.mp3"` with the central path via `get_cached_path`.
- The synchronous prime loop (L1079-1097) calls `get_cached_path "$plex_id" "$url" "$name"` and writes the returned **central** path into `playlist_tmp`.
- The bg downloader (L1118-1152) **stays forked here but the append-into-mpv is removed** — see Task 12; the bg now only ensures central-cache files exist and appends central paths to `playlist.m3u`. (mpv reconciliation moves to Task 12's verified path.)
- Write a `membership_hash` for the slot at the end (Task 13's `queue_membership_hash`) into `slots/<N>/.membership` so the reconciler has a baseline.

**Step 2:** New prime loop body:
```bash
    local primed=0 target_prime=$((LAZY_PRIME_COUNT < total ? LAZY_PRIME_COUNT : total))
    for ((i=0; i<total && primed<target_prime; i++)); do
        local cpath
        if cpath=$(get_cached_path "${track_ids[$i]}" "${track_urls[$i]}" "$name"); then
            printf '#EXTINF:-1,%s\n%s\n' "${track_titles[$i]}" "$cpath" >> "$playlist_tmp"
            primed=$((primed+1))
        else
            logev "$name" prime.skip plex_id="${track_ids[$i]}" reason=cache_fail
        fi
    done
    first_pending_idx=$i
```

**Step 3:** New bg body (no IPC — file only; mpv sync handled in Task 12):
```bash
        ( exec 9>&-; set +e
          local plex_id url cpath title
          while IFS=$'\t' read -r plex_id url cfile title; do
              if cpath=$(get_cached_path "$plex_id" "$url" "$name"); then
                  printf '#EXTINF:-1,%s\n%s\n' "$title" "$cpath" >> "$dir/playlist.m3u"
              else
                  logev "$name" bg.skip plex_id="$plex_id" reason=cache_fail
              fi
          done < "$bg_state"
          rm -f "$bg_state" "$dir/downloader.pid"
          touch "$dir/.bg_done"          # signal for Task 12 reconcile
          logev "$name" bg.complete file_count="$(grep -c '^/' "$dir/playlist.m3u" 2>/dev/null || echo 0)"
        ) &
```
(`cfile` from `.bg_remaining` is now ignored — central path is derived; keep the field for format stability or regenerate `.bg_remaining` without it.)

**Step 4:** No standalone test (covered by Task 23 integration). **Commit** (await go): `refactor(playback-hub): fetch_and_cache uses central cache, bg writes file only`

### Task 12: Rewire `start_playback` — sequence the race away + verified mpv reconcile

**Files:** Modify `playback-hub.sh` `start_playback()` L1184-1308

**Step 1:** Move the bg-downloader fork **out of `fetch_and_cache`** and have `start_playback` orchestrate the order. The new sequence inside `start_playback`, replacing the current `fetch_and_cache … && mpv …` flow:
1. `prime_playlist "$slot" "$name" "$queue" "$shuffle"` — synchronous prime only (the Task 11 prime loop, **without** forking bg). Writes `playlist.m3u` (5 entries) + `.bg_remaining`.
2. resolve audio device, resume vars, launch mpv (unchanged L1272-1284).
3. **`wait_for_mpv_socket "$dir" 8`** — if it fails, log `mpv.socket_timeout` and continue (mpv may still load file).
4. **Now** fork the bg downloader (Task 11 Step 3 body).
5. After fork, spawn a one-shot reconcile waiter that, when `.bg_done` appears, runs `loadlist_replace_preserving_pos` and logs the authoritative count:
```bash
    ( for _ in $(seq 1 120); do [[ -f "$dir/.bg_done" ]] && break; sleep 1; done
      rm -f "$dir/.bg_done"
      loadlist_replace_preserving_pos "$slot" "$name"
      logev "$name" playback.reconciled slot="$slot" \
            mpv_count="$(mpv_playlist_count "$dir/mpv-socket")" \
            file_count="$(grep -c '^/' "$dir/playlist.m3u" 2>/dev/null || echo 0)" ) &
```

**Step 2:** Delete the old `[bg] all tracks cached and appended` log line (now `bg.complete` + `playback.reconciled` replace it). Verify no remaining `loadfile … append` IPC calls exist in `fetch_and_cache`/bg.

**Step 3:** Integration only (Task 23). **Commit** (await go): `fix(playback-hub): sequence prime→mpv→socket→bg→verified reconcile (kills subset-loop race)`

---

## Phase 4 — Reconciler (self-heal cadence)

### Task 13: `queue_membership_hash`

**Files:** Modify `cache_manager.sh`; Create `tests/test_membership_hash.sh`

**Step 1 (failing test):** same ordered items → same hash; reordered → different; added/removed → different.

**Step 2: Implement:**
```bash
queue_membership_hash() { # queue_json -> short hash of ordered contentIds
    echo "$1" | jq -r '.items[].contentId' 2>/dev/null | sha1sum | cut -c1-12
}
queue_membership_diff() { # old_ids_file new_ids_file -> prints "added\tN removed\tM" sets via comm
    : # helper used by Task 14; sets computed inline there
}
```

**Step 3: Run** → PASS. **Commit** (await go): `feat(playback-hub): queue membership hash`

### Task 14: `reconcile_slot_membership`

**Files:** Modify `cache_manager.sh` / `playback-hub.sh`; Create `tests/test_reconcile_membership.sh` (diff-set logic with stubbed fetch + stubbed loadlist).

**Step 1 (failing test):** given stored `.membership` hash + a new queue JSON with one added + one removed contentId, assert: new tracks routed through `get_cached_path`, `playlist.m3u` rewritten to the new ordered set, `loadlist_replace_preserving_pos` invoked, and a `playlist.reconciled` event emitted with correct `added=`/`removed=` counts. Stub `get_cached_path` and `loadlist_replace_preserving_pos`.

**Step 2: Implement:**
```bash
reconcile_slot_membership() { # slot name queue_url shuffle
    local slot="$1" name="$2" queue_url="$3" shuffle="$4" dir; dir="$(slot_dir "$slot")"
    local qjson; qjson=$(curl_api "$queue_url") || { logev "$name" reconcile.skip slot="$slot" reason=api_down; return 0; }
    is_valid_queue_json "$qjson" || { logev "$name" reconcile.skip slot="$slot" reason=bad_json; return 0; }
    local newhash oldhash; newhash=$(queue_membership_hash "$qjson")
    oldhash=$(cat "$dir/.membership" 2>/dev/null || echo "")
    [[ "$newhash" == "$oldhash" ]] && return 0    # no drift, cheap exit
    # Drift: rebuild playlist.m3u from the new queue (ordered/shuffled), via central cache.
    local added=0 removed=0
    # ... build ordered arrays (reuse Task 11 order logic), count added vs old playlist ...
    rebuild_playlist_from_queue "$slot" "$name" "$qjson" "$shuffle"   # writes playlist.m3u + counts
    echo "$newhash" > "$dir/.membership"
    loadlist_replace_preserving_pos "$slot" "$name"
    logev "$name" playlist.reconciled slot="$slot" membership_hash="${oldhash:-none}→${newhash}" \
          file_count="$(grep -c '^/' "$dir/playlist.m3u" 2>/dev/null || echo 0)"
}
```
(`rebuild_playlist_from_queue` is the Task 11 ordering+prime logic generalized to "ensure all cached, write full list" — extract it so prime and reconcile share one code path. DRY.)

**Step 3: Run** → PASS. **Commit** (await go): `feat(playback-hub): per-slot membership reconcile`

### Task 15: Wire membership reconcile into the refresh loop at ~60s

**Files:** Modify `playback-hub.sh` `refresh_loop()` L1331

**Step 1:** Add a dedicated `membership_loop` (don't overload the 300s config refresh):
```bash
membership_loop() {
    while true; do
        sleep "$MEMBERSHIP_INTERVAL"
        local slot name mac queue shuffle
        # iterate connected slots from $CONFIG_FILE; for each connected+playing slot:
        #   resolve_queue_url + selected_shuffle, then reconcile_slot_membership
    done
}
```
Start it in `monitor()` alongside `refresh_loop &` (L1498): `membership_loop &`.

**Step 2:** Integration (Task 24). **Commit** (await go): `feat(playback-hub): 60s membership reconcile loop`

### Task 16: Rolling `HEAD` content-change check

**Files:** Modify `cache_manager.sh` (`head_fetch`, `head_check`, rolling scheduler); Create `tests/test_head_check.sh`

**Step 1 (failing test):** stub `head_fetch` to return changed `content_length` vs stored meta → assert `head_check` triggers `cache_download` and emits `cache.content_changed`; unchanged → no download.

**Step 2: Implement:**
```bash
head_fetch() { # url -> prints "<content_length> <last_modified>"
    local url="$1" out; out=$(curl -fsSI --max-time 15 "$url" 2>/dev/null) || \
        out=$(curl -fsSI --max-time 15 "${url/$API_BASE/$API_FALLBACK_BASE}" 2>/dev/null) || return 1
    local clen lm
    clen=$(awk 'tolower($1)=="content-length:"{gsub("\r","",$2);print $2}' <<<"$out" | tail -1)
    lm=$(awk 'tolower($1)=="last-modified:"{$1="";sub(/^ /,"");gsub("\r","",$0);print}' <<<"$out" | tail -1)
    echo "${clen:-} ${lm:-}"
}
head_check() { # plex_id url name -> redownload if server signal changed
    local id="$1" url="$2" name="$3" clen lm
    read -r clen lm < <(head_fetch "$url" || echo " ")
    [[ -z "$clen" ]] && return 0   # no signal, skip
    local oclen; oclen=$(cache_meta_get "$id" content_length)
    if [[ -n "$oclen" && "$clen" != "$oclen" ]]; then
        logev "$name" cache.content_changed plex_id="$id" content_length="${oclen}→${clen}" action=redownload
        rm -f "$(cache_path "$id")"; cache_download "$id" "$url" "$name"
    fi
}
```

**Step 3:** Rolling scheduler — in `membership_loop` (or a sibling), HEAD-check `ceil(total_live / (HEAD_FULL_PASS/MEMBERSHIP_INTERVAL))` files per tick, round-robin via a persisted cursor `$BASE_DIR/.head_cursor`. **Run test** → PASS. **Commit** (await go): `feat(playback-hub): rolling HEAD content-change self-heal`

### Task 17: Revalidate on playback failure

**Files:** Modify `playback-hub.sh` `mpv_watchdog()` L1376

**Step 1:** When the watchdog observes mpv alive but `time-pos` not advancing across two ticks, or mpv logged a demuxer error for the current `path`, call `get_cached_path` (force revalidate) on the current `plex_id` and `loadlist_replace_preserving_pos`. Emit `track.stall`/`cache.revalidate`.

**Step 2:** Integration only. **Commit** (await go): `feat(playback-hub): revalidate current track on playback stall`

### Task 18: Ref-counted orphan sweep

**Files:** Modify `cache_manager.sh` (`cache_orphan_sweep`); Modify `playback-hub.sh` (`sweep_loop`, start in `monitor`); Create `tests/test_orphan_sweep.sh`

**Step 1 (failing test):** create live + orphan cache files; build a fake live set; set one orphan's atime to >7d (`touch -a -d`); run sweep; assert orphan>7d deleted, live kept, recent orphan kept. Then exceed `CACHE_MAX_BYTES` with orphans and assert LRU backstop evicts oldest first.

**Step 2: Implement:**
```bash
cache_live_set() { # prints plex_ids referenced by any slot's current playlist.m3u
    grep -rhoE '/cache/[0-9]+\.mp3' "$BASE_DIR"/slots/*/playlist.m3u 2>/dev/null \
        | sed -E 's#.*/([0-9]+)\.mp3#\1#' | sort -u
}
cache_orphan_sweep() {
    local live; live=$(cache_live_set)
    local now; now=$(date +%s) deleted=0 freed=0 f id at age
    shopt -s nullglob
    for f in "$CACHE_DIR"/*.mp3; do
        id="$(basename "$f" .mp3)"
        grep -qx "$id" <<<"$live" && continue            # referenced -> keep
        at=$(stat -c %X "$f" 2>/dev/null || echo "$now"); age=$(( (now-at)/86400 ))
        if (( age >= ORPHAN_TTL_DAYS )); then
            freed=$((freed+$(file_size_bytes "$f"))); rm -f "$f" "$(meta_path "$id")"; deleted=$((deleted+1))
        fi
    done
    shopt -u nullglob
    # LRU backstop if still over cap (oldest atime orphans first)
    cache_enforce_size_cap live="$live"
    logev sweep cache.sweep deleted="$deleted" freed_bytes="$freed" live="$(wc -l <<<"$live")"
}
```
(`cache_enforce_size_cap`: if `du -sb "$CACHE_DIR"` > `CACHE_MAX_BYTES`, delete non-live files sorted by atime asc until under cap.)

**Step 3:** `sweep_loop` sleeps `SWEEP_INTERVAL` then `cache_orphan_sweep`; start in `monitor`. **Run test** → PASS. **Commit** (await go): `feat(playback-hub): ref-counted orphan sweep + size cap`

---

## Phase 5 — Postmortem-grade logging

### Task 19: `logev` structured emitter + per-slot `events.jsonl`

**Files:** Modify `playback-hub.sh` (add `logev` near `log()` L67); Create `tests/test_logev.sh`

**Step 1 (failing test):** `logev red foo.bar a=1 b="two words"` → stdout line contains `evt=foo.bar a=1`, and `slots/<slot>/events.jsonl` (when slot resolvable) gains one JSON object with `evt:"foo.bar"`. For non-slot tags (e.g. `sweep`, `migrate`) only the human line is emitted.

**Step 2: Implement:**
```bash
# Structured event: logev <tag/color> <evt> [k=v ...]
# Human line to stdout (hub.log) + JSON to slots/<N>/events.jsonl when tag maps to a slot.
logev() {
    local tag="$1" evt="$2"; shift 2
    local kv="$*"
    echo "[$(date '+%H:%M:%S')] [$tag] evt=$evt $kv"
    # Map tag(color or slot) -> slot dir; append JSON ledger, size-capped.
    local slot; slot=$(slot_for_tag "$tag" 2>/dev/null || echo "")
    [[ -z "$slot" ]] && return 0
    local dir; dir="$(slot_dir "$slot")"; mkdir -p "$dir"
    local jl="$dir/events.jsonl"
    # rotate at ~5MB
    [[ -f "$jl" && $(file_size_bytes "$jl") -gt $((5*1024*1024)) ]] && mv "$jl" "$jl.1"
    # build JSON from k=v pairs
    local json; json=$(kv_to_json "$kv")
    echo "{\"ts\":\"$(date -Is)\",\"evt\":\"$evt\",\"slot\":$slot,$json}" >> "$jl"
}
kv_to_json() { # "a=1 b=two words"-ish -> JSON fields; values are strings (safe default)
    local out="" tok k v
    for tok in $1; do
        [[ "$tok" != *=* ]] && continue
        k="${tok%%=*}"; v="${tok#*=}"
        out+="\"$k\":\"${v//\"/\\\"}\","
    done
    echo "${out%,}"
}
slot_for_tag() { # color or numeric slot -> slot number
    local t="$1"
    [[ "$t" =~ ^[0-9]+$ ]] && { echo "$t"; return 0; }
    jq -r --arg c "$t" '.devices[] | select(.color==$c) | .slot' "$CONFIG_FILE" 2>/dev/null | head -1
}
```
> NOTE: `logev` is referenced by Phase 1-4 functions. Implement this task FIRST in execution order if doing subagent-driven (it's a dependency). If executing strictly top-to-bottom, guard early callers with `command -v logev >/dev/null && logev …` OR pull Task 19 forward. **Recommended: execute Task 19 immediately after Task 1.**

**Step 3: Run** → PASS. **Commit** (await go): `feat(playback-hub): structured logev + per-slot events.jsonl`

### Task 20: Instrument the playback path

**Files:** Modify `playback-hub.sh` across `start_playback`, `stop_playback`, `mpv_watchdog`, connect/disconnect handlers

**Step 1:** Add events at transitions (no behavior change): `bt.connect`/`bt.disconnect`, `mpv.start pid= count=`, `mpv.exit_immediate`, `track.start plex_id= idx=`, `track.eof played= expected=` (derive from watchdog `time-pos`/`duration`), `resume track= pos=`. Reuse existing `log` lines' data; convert the highest-value ones to `logev`.

**Step 2:** Integration smoke (Task 25). **Commit** (await go): `feat(playback-hub): instrument playback transitions`

### Task 21: Make `mpv.log` useful (msg-level + rotate, no truncate)

**Files:** Modify `playback-hub.sh` mpv launch (L1272-1281)

**Step 1:** Change `2>"$dir/mpv.log"` to rotate-then-append and raise log level:
```bash
    [[ -f "$dir/mpv.log" ]] && mv "$dir/mpv.log" "$dir/mpv.log.1"
    ( exec 9>&-; exec mpv --no-video --no-terminal \
        --msg-level=all=info,demuxer=warn,stream=warn,ao=warn,ffmpeg=warn \
        --input-ipc-server="$dir/mpv-socket" \
        --playlist="$dir/playlist.m3u" --playlist-start="$start_track" \
        --start="+${start_pos}" --loop-playlist=inf --pause=no \
        --volume="$vol_default" --load-scripts="$load_scripts" \
        --audio-device="$audio_device" 2>"$dir/mpv.log" ) &
```
> Do NOT add `--audio-fallback-to-null` (see memory feedback note). Keep audio flags exactly as today otherwise.

**Step 2:** Manual verify a demuxer warning survives a restart. **Commit** (await go): `feat(playback-hub): mpv.log msg-level + rotate`

### Task 22: web.py status — surface the blind-spot fields

**Files:** Modify `web.py` `slot_status()` ~L264-356

**Step 1:** Add `file_playlist_count` (count `^/` lines in `slots/<N>/playlist.m3u`), `last_reconcile` (read newest `playlist.reconciled`/`playback.reconciled` ts from `events.jsonl`), `integrity_failures` (count `cache.integrity_fail` in `events.jsonl` in the last hour). Keep existing `playlist_count` (mpv in-memory) — now the discrepancy `playlist_count` vs `file_playlist_count` is visible at a glance.

**Step 2:** Verify `/api/status` returns the new fields. **Commit** (await go): `feat(playback-hub): expose mpv-vs-file count + reconcile/integrity status`

---

## Phase 6 — Regression tests & deploy

### Task 23: Warm-cache regression test (the bug we're fixing)

**Files:** Create `_extensions/playback-hub/tests/test_warmcache_race.sh` (integration; runs locally with stubs OR documented as a hub-side harness)

**Step 1:** Pre-populate the central cache for a known queue (stub `curl_api` to return a fixed N-item queue JSON; stub `curl_fetch_to` to produce valid files matching `Content-Length`). Drive `prime_playlist` + the Task 12 reconcile path against a **fake mpv** (a `socat UNIX-LISTEN` responder that records `loadlist`/`playlist-count`). Assert final `mpv_playlist_count == N`, not `LAZY_PRIME_COUNT`.

**Step 2: Run** → PASS. This test MUST stay green — it is the standing guard against the subset-loop regression. **Commit** (await go): `test(playback-hub): warm-cache loads full playlist (subset-loop regression)`

### Task 24: Reconcile-while-playing test

**Files:** Create `tests/test_reconcile_live.sh`

**Step 1:** Start the fake-mpv responder positioned on track K. Change the served queue (remove a track before K, add one after). Run `reconcile_slot_membership`. Assert `loadlist replace` fired and `playlist-pos` was set back onto the surviving current track's new index. **Run** → PASS. **Commit** (await go): `test(playback-hub): position-preserving reconcile`

### Task 25: Deploy in place + live smoke

> **STOP — requires explicit user go-ahead. Do not run without it.** Per CLAUDE.md, deploys are manual.

**Files:** none (operational)

**Step 1: Pre-deploy backup on the box:**
```bash
ssh kckern-playback-hub 'cd ~/playback-hub && cp playback-hub.sh playback-hub.sh.bak.$(date +%Y%m%d-%H%M%S)'
```

**Step 2: rsync the changed files** (script + new cache_manager + tests):
```bash
rsync -av _extensions/playback-hub/playback-hub.sh _extensions/playback-hub/cache_manager.sh \
  _extensions/playback-hub/web.py _extensions/playback-hub/tests/ \
  kckern@10.0.0.109:/home/kckern/playback-hub/
```

**Step 3: Run the test suite on the box** before restarting:
```bash
ssh kckern-playback-hub 'cd ~/playback-hub && bash tests/run_tests.sh'
```
Expected: all PASS.

**Step 4: Restart daemon + web.py** (manual restart pattern from README §Deployment):
```bash
ssh kckern-playback-hub 'pkill -f "playback-hub.sh monitor"; sleep 1; \
  cd ~/playback-hub && nohup setsid bash playback-hub.sh monitor > ~/hub.log 2>&1 < /dev/null & disown'
# restart web.py similarly if changed
```

**Step 5: Live smoke** — reconnect red and confirm the fix in telemetry:
```bash
ssh kckern-playback-hub 'tail -f ~/playback-hub/slots/1/events.jsonl'
# expect: bt.connect → mpv.start → playback.reconciled with mpv_count==file_count==30
curl -s localhost:8080/api/status | jq '.[0] | {playlist_count, file_playlist_count, last_reconcile, integrity_failures}'
# expect: playlist_count == file_playlist_count (no subset), integrity_failures: 0
```
Watch one full loop: track progression advances through the full set (no 5-track loop), no partial/early-EOF `track.eof played<<expected` events.

**Step 6:** Update `_extensions/playback-hub/README.md` (cache + reconciler + logging sections) and `docs/_wip/plans/` status. Move this plan to done/archive per repo docs rules. **Commit** (await go): `docs(playback-hub): central cache + self-heal + observability`

---

## Execution order note (subagent-driven)

Dependency-correct order: **Task 1 → Task 19 (logev, pulled forward) → Tasks 2-6 → 7 → 8-12 → 13-18 → 20-22 → 23-25.** `logev` is a dependency of nearly everything; implement it right after the harness. Each task is independently committable; run `bash tests/run_tests.sh` green before moving on.

## Risk register
- **Audio regression** (highest): any change to the mpv launch line or disconnect path can silence headsets. Tasks 12 & 21 touch this — verify with the live smoke (TX bytes climbing + audible) before committing the deploy. Re-read `feedback_playback_hub_lane_guardrail_silenced_audio.md`.
- **HEAD load**: rolling scheduler must cap files-per-tick; verify no >~10 HEADs/tick in `events.jsonl`.
- **Migration double-count**: hard-link must be idempotent (`[[ -e ]]` guard) — re-running `migrate_per_slot_caches` must be a no-op.
- **Fake-mpv test fidelity**: the socat responder must mimic mpv's `{"error":"success"}` envelope or verified-IPC tasks give false greens.
