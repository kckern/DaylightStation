#!/usr/bin/env bash
# Central cache manager — the ONLY writer of $CACHE_DIR. Sourced by playback-hub.sh.
# Depends on parent: CACHE_DIR, MIN_AUDIO_BYTES, file_size_bytes(), curl_api(), logev(), API_BASE, API_FALLBACK_BASE.

# Short, stable hash of a queue's ORDERED contentId membership. Two queues
# with the same ids in the same order hash equal; reorder/add/remove differs.
# Empty or invalid JSON yields a stable (non-crashing) hash of the empty stream.
# Portable: GNU coreutils ships `sha1sum`; macOS ships `shasum`. Try sha1sum
# first, fall back to shasum.
queue_membership_hash() { # queue_json -> 12-char hash of ordered contentIds
    echo "$1" | jq -r '.items[].contentId' 2>/dev/null \
        | { sha1sum 2>/dev/null || shasum; } | cut -c1-12
}

cache_path() { echo "$CACHE_DIR/$1.mp3"; }
meta_path()  { echo "$CACHE_DIR/$1.meta.json"; }
cache_lock() { echo "$CACHE_DIR/$1.lock"; }

cache_meta_write() { # plex_id content_length last_modified source_url
    local id="$1" clen="${2:-}" lastmod="${3:-}" src="${4:-}"
    local size; size=$(file_size_bytes "$(cache_path "$id")")
    # `|` binds tighter than `//`, so the content_length/last_modified clauses
    # MUST keep their `(select|tonumber?)` pipeline parenthesised before `// null`.
    # Without the parens an EMPTY $clen makes `select` emit nothing, which empties
    # the entire object stream and writes a 0-byte meta (breaks size-only backfill).
    jq -n --arg clen "$clen" --arg lm "$lastmod" --arg src "$src" \
          --argjson size "${size:-0}" \
        '{content_length:(($clen|select(.!="")|tonumber?) // null),
          last_modified:(($lm|select(.!="")) // null),
          source_url:$src, size:$size}' \
        > "$(meta_path "$id").tmp" && mv "$(meta_path "$id").tmp" "$(meta_path "$id")"
}

cache_meta_get() { # plex_id field -> value or empty
    local id="$1" field="$2" mp; mp="$(meta_path "$id")"
    [[ -f "$mp" ]] || return 0
    jq -r --arg f "$field" '.[$f] // empty' "$mp" 2>/dev/null
}

# Cheap HEAD against the source URL. Prints "<content_length> <last_modified>"
# (either token may be empty). Falls back to the API_FALLBACK_BASE host on the
# first transport failure, mirroring curl_fetch_to's dual-host behavior. Returns
# 1 only when BOTH hosts fail to respond. Used by head_check (content-change
# self-heal) and cache_meta_backfill (size-only meta enrichment on migration).
head_fetch() { # url -> prints "<content_length> <last_modified>" (either may be empty)
    local url="$1" out
    out=$(curl -fsSI --max-time 15 "$url" 2>/dev/null) || \
        out=$(curl -fsSI --max-time 15 "${url/$API_BASE/$API_FALLBACK_BASE}" 2>/dev/null) || return 1
    local clen lm
    clen=$(awk 'tolower($1)=="content-length:"{gsub("\r","",$2);print $2}' <<<"$out" | tail -1)
    lm=$(awk 'tolower($1)=="last-modified:"{$1="";sub(/^ /,"");gsub("\r","",$0);print}' <<<"$out" | tail -1)
    echo "${clen:-} ${lm:-}"
}

# Rolling content-change detector. Compares the server's current Content-Length
# against the stored meta content_length. On change, evicts the stale file +
# meta and re-fetches via cache_download (which rewrites meta). On no change,
# missing server signal (empty clen), or no stored baseline (can't compare) it
# is a silent no-op. NOT a validator — validate_cached already guards integrity
# at read time; this catches an in-place server-side content swap under a stable
# plex_id, which validate_cached cannot see (size still matches the OLD meta).
head_check() { # plex_id url name
    local id="$1" url="$2" name="$3" clen lm
    read -r clen lm < <(head_fetch "$url" || echo " ")
    [[ -z "$clen" ]] && return 0                       # no server signal — skip
    local oclen; oclen=$(cache_meta_get "$id" content_length)
    if [[ -n "$oclen" && "$oclen" != "null" && "$clen" != "$oclen" ]]; then
        logev "$name" cache.content_changed plex_id="$id" content_length="${oclen}-${clen}" action=redownload
        rm -f "$(cache_path "$id")"
        cache_download "$id" "$url" "$name"
    fi
}

validate_cached() { # plex_id -> 0 valid / 1 invalid
    local id="$1" f; f="$(cache_path "$id")"
    [[ -f "$f" ]] || return 1
    local size clen; size=$(file_size_bytes "$f"); clen=$(cache_meta_get "$id" content_length)
    if [[ -n "$clen" && "$clen" != "null" && "$clen" -gt 0 ]]; then
        [[ "$size" -eq "$clen" ]] && return 0 || return 1
    fi
    (( size >= MIN_AUDIO_BYTES )) && return 0 || return 1
}

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
    # flock is best-effort: present on the Ubuntu target, absent on stock macOS
    # dev. When absent the lock degrades to a no-op so the function stays portable.
    command -v flock >/dev/null && flock 8 || true
    if validate_cached "$id"; then exec 8>&-; return 0; fi
    local dest part; dest="$(cache_path "$id")"; part="${dest}.partial"
    rm -f "$part"
    if ! curl_fetch_to "$url" "$part"; then
        logev "$name" cache.download_fail plex_id="$id" reason=transport 1>&2
        rm -f "$part"; exec 8>&-; return 1
    fi
    sync "$part" 2>/dev/null || true
    local got="$(file_size_bytes "$part")"
    # Numeric-guard the advertised Content-Length: a malformed (non-numeric)
    # header would otherwise abort the arithmetic test under `set -u`, leaking
    # fd 8 + the .partial. A bad/absent CL falls through to the size floor.
    if [[ "${_DL_CLEN:-}" =~ ^[0-9]+$ && "$_DL_CLEN" -gt 0 ]]; then
        if [[ "$got" -ne "$_DL_CLEN" ]]; then
            logev "$name" cache.integrity_fail plex_id="$id" reason=short got="$got" want="$_DL_CLEN" action=reject 1>&2
            rm -f "$part"; exec 8>&-; return 1
        fi
    else
        if (( got < MIN_AUDIO_BYTES )); then
            logev "$name" cache.integrity_fail plex_id="$id" reason=tiny got="$got" action=reject 1>&2
            rm -f "$part"; exec 8>&-; return 1
        fi
        logev "$name" cache.no_content_length plex_id="$id" got="$got" note=size_floor_only 1>&2
    fi
    mv "$part" "$dest"
    cache_meta_write "$id" "${_DL_CLEN:-}" "${_DL_LASTMOD:-}" "$url"
    logev "$name" cache.download plex_id="$id" bytes="$got" expected="${_DL_CLEN:-unknown}" ok=true 1>&2
    exec 8>&-; return 0
}

get_cached_path() { # plex_id url name -> prints path & returns 0; on fail prints nothing, returns 1
    local id="$1" url="$2" name="$3"
    if validate_cached "$id"; then echo "$(cache_path "$id")"; return 0; fi
    logev "$name" cache.repair plex_id="$id" reason=invalid_or_missing 1>&2
    if cache_download "$id" "$url" "$name"; then echo "$(cache_path "$id")"; return 0; fi
    return 1
}

# === Ref-counted orphan sweep (Unit F Part 3) =========================
# A cache file is "live" iff some slot's CURRENT playlist.m3u references it.
# Anything not live is an orphan: deletable once it ages out (ORPHAN_TTL_DAYS)
# or when total cache size breaches CACHE_MAX_BYTES (LRU eviction). The
# `grep -qx` live guard on every delete path is the single safety invariant:
# a file referenced by any playlist is NEVER removed, regardless of age/size.

# plex_ids referenced by any slot's current playlist.m3u (deduped, one per line).
cache_live_set() {
    grep -rhoE '/cache/[0-9]+\.mp3' "$BASE_DIR"/slots/*/playlist.m3u 2>/dev/null \
        | sed -E 's#.*/([0-9]+)\.mp3#\1#' | sort -u
}

# Last-access time in epoch seconds. GNU `stat -c %X`; BSD/macOS `stat -f %a`.
cache_atime() { stat -c %X "$1" 2>/dev/null || stat -f %a "$1" 2>/dev/null || echo 0; }

# Total bytes under $CACHE_DIR (du -sk is portable; *1024 -> bytes).
cache_size_total() { du -sk "$CACHE_DIR" 2>/dev/null | awk '{print $1*1024}'; }

cache_orphan_sweep() {
    local live; live=$(cache_live_set)
    local now deleted=0 freed=0 f id at age
    now=$(date +%s)
    shopt -s nullglob
    for f in "$CACHE_DIR"/*.mp3; do
        id="$(basename "$f" .mp3)"
        grep -qx "$id" <<<"$live" && continue          # live — never delete
        at=$(cache_atime "$f"); age=$(( (now-at)/86400 ))
        if (( age >= ORPHAN_TTL_DAYS )); then
            freed=$((freed+$(file_size_bytes "$f"))); rm -f "$f" "$(meta_path "$id")"; deleted=$((deleted+1))
        fi
    done
    shopt -u nullglob
    cache_enforce_size_cap "$live"
    logev sweep cache.sweep deleted="$deleted" freed_bytes="$freed" live="$(echo "$live" | grep -c . || true)"
}

# If over CACHE_MAX_BYTES, evict NON-LIVE files oldest-atime-first until under.
# Read candidates into an array (no piped while) so deletions + the under-cap
# break run in THIS shell, not a subshell — guarantees the loop actually stops
# and frees space deterministically.
cache_enforce_size_cap() { # live_set
    local live="$1" total; total=$(cache_size_total)
    [[ -z "$total" || "$total" -le "$CACHE_MAX_BYTES" ]] && return 0
    # Defer when the live set is empty: we can't distinguish a genuinely idle
    # cache from a transient pre-prime startup window (playlists not written
    # yet), so atime-eviction here could churn fresh files about to be primed.
    # TTL sweep still reclaims truly-stale files; the cap re-checks next tick
    # once something is live. Slot dirs always exist, so the marker is "live empty".
    [[ -z "$live" ]] && { logev sweep cache.size_cap_deferred reason=live_set_empty total="$total"; return 0; }
    local f id at line
    local -a cands=()
    shopt -s nullglob
    for f in "$CACHE_DIR"/*.mp3; do
        id="$(basename "$f" .mp3)"; grep -qx "$id" <<<"$live" && continue
        at=$(cache_atime "$f"); cands+=("$at"$'\t'"$f")
    done
    shopt -u nullglob
    # Sort ascending by atime (oldest first), evict until under cap.
    while IFS=$'\t' read -r at f; do
        [[ -z "$f" ]] && continue
        total=$(cache_size_total); (( total <= CACHE_MAX_BYTES )) && break
        id="$(basename "$f" .mp3)"; rm -f "$f" "$(meta_path "$id")"
        logev sweep cache.evict plex_id="$id" reason=size_cap
    done < <(printf '%s\n' "${cands[@]}" | sort -n)
}

# One-time startup migration: fold legacy per-slot caches
# ($BASE_DIR/slots/<N>/cache/<plex_id>.mp3) into the central $CACHE_DIR.
# Hard-links when possible (shared inode = free dedup), copies on cross-device.
# Idempotent: the [[ ! -e ]] guard skips ids already in the central cache, so
# reruns are no-ops and a duplicate id across slots is migrated only once.
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

# Build a .meta.json for a migrated file. HEADs the source_url when head_fetch
# exists (a later unit); otherwise writes a size-only meta (null content_length,
# which validate_cached tolerates via the MIN_AUDIO_BYTES floor).
cache_meta_backfill() { # plex_id
    # NOTE: `id` must be assigned in its own `local` before `url` references it.
    # A single `local id=.. url=..${id}..` resolves ${id} against the *outer*
    # (unset) name, which trips `set -u` with "id: unbound variable".
    local id="$1"
    local url="${API_BASE}/api/v1/proxy/plex/stream/${id}" clen="" lm=""
    if command -v head_fetch >/dev/null; then
        read -r clen lm < <(head_fetch "$url" 2>/dev/null || echo " ")
    fi
    cache_meta_write "$id" "$clen" "$lm" "$url"
}

# Membership self-heal (Unit E): detect when a slot's server-side queue
# (playlist membership/order) has drifted from what we primed, and reconcile
# the running mpv to match. Cheap no-op when nothing changed (hash compare).
#
# Reconcile ordering decision: there is NO .bg_done waiter here (unlike
# start_playback / refresh_loop). After rebuild reprimes the first N tracks +
# writes .bg_remaining, we (1) fork spawn_bg_downloader to cache+append the
# remainder, then (2) immediately loadlist-replace the freshly primed set into
# the live mpv (position-preserving). The full set then arrives via
# spawn_bg_downloader's incremental `loadfile append` to live mpv. We do NOT
# add a second .bg_done reconcile-waiter because the immediate loadlist plus the
# bg's live appends already keep mpv in sync with the new membership — a waiter
# would only matter if mpv could not be appended to live, which is not the case
# once the socket exists. rebuild already rewrote .membership (baseline), so the
# next tick is a no-op.
#   args: slot name queue_url shuffle
reconcile_slot_membership() {
    local slot="$1" name="$2" queue_url="$3" shuffle="$4" dir; dir="$(slot_dir "$slot")"
    local qjson; qjson=$(curl_api "$queue_url") || { logev "$name" reconcile.skip slot="$slot" reason=api_down; return 0; }
    is_valid_queue_json "$qjson" || { logev "$name" reconcile.skip slot="$slot" reason=bad_json; return 0; }
    local newhash oldhash; newhash=$(queue_membership_hash "$qjson")
    oldhash=$(cat "$dir/.membership" 2>/dev/null || echo "")
    if [[ -z "$oldhash" ]]; then
        # No baseline yet (e.g. mpv started before this code shipped): establish
        # the baseline without reconciling, so we don't churn a live playlist on
        # first sight.
        echo "$newhash" > "$dir/.membership"
        return 0
    fi
    [[ "$newhash" == "$oldhash" ]] && return 0      # no drift — cheap exit

    logev "$name" playlist.drift slot="$slot" membership_hash="${oldhash}-${newhash}"
    # Serialize the drift mutation with start_playback / refresh_loop on the SAME
    # per-slot FD-9 playback lock. Without this, two concurrent writers both
    # rebuild playlist.m3u + fork spawn_bg_downloader, clobbering .bg_remaining
    # and leaving orphan downloaders. Non-blocking: skip on contention.
    #
    # CRITICAL: reconcile runs in membership_tick's MAIN process, iterating slots
    # in a loop. fd 9 MUST be closed (exec 9>&-) before returning on EVERY path
    # that opened it, or the lock leaks into the next slot's iteration.
    # spawn_bg_downloader's subshell does `exec 9>&-` first, so the fork drops
    # the inherited lock and won't hold it for the whole download.
    exec 9>"$dir/playback.lock"
    if ! flock -n 9; then
        logev "$name" reconcile.skip slot="$slot" reason=lock_busy
        exec 9>&-; return 0
    fi
    if ! rebuild_playlist_from_queue "$slot" "$name" "$qjson" "$shuffle"; then
        logev "$name" reconcile.fail slot="$slot" reason=rebuild
        exec 9>&-; return 1
    fi
    # rebuild_playlist_from_queue rewrote playlist.m3u + .membership + .bg_remaining.
    spawn_bg_downloader "$slot" "$name"
    loadlist_replace_preserving_pos "$slot" "$name"
    logev "$name" playlist.reconciled slot="$slot" \
          file_count="$(grep -c '^/' "$dir/playlist.m3u" 2>/dev/null || echo 0)"
    exec 9>&-
}
