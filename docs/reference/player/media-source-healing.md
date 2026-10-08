# Media source healing

What happens when the media server **refuses to read a file**: the Player waits
instead of giving up, the backend tries to repair the file, and an adult gets a
push if the file stays broken.

## Why it exists

On 2026-09-28 the NAS that holds the media library zeroed the permission bits
(mode `0000`) on thousands of Fitness files in a burst that undid itself about
twenty minutes later. The files never changed; the NAS just reported them as
unreadable. Plex answered every direct-play request for them with **404**, and
its own log said `Error opening file … Permission denied (13)`.

The Player took that 404 as "file gone". Chromium raises it as `MediaError` code
4 (`404: Not Found`), which the recovery ladder ignores by design, so nothing
reacted until the 15-second startup deadline. After that, the ladder spent its
five attempts reloading a URL that could not work, then parked on **Tap to
Retry** in the middle of a workout.

A refused source is not a stall. Reloading can't fix it; only the file becoming
readable again can. So the right move is to wait, and meanwhile try to repair it.

The NAS behaviour itself was also seen on 2026-09-25 (1,320 files zeroed). Its
cause is on the NAS, and nothing here can see into it.

## The three layers

```
<video src=/api/v1/proxy/plex/library/parts/…/file.mp4>
        │ 404 from Plex
        ▼
Plex proxy ── retries 3× (500ms) ── still 404 ──► 503 {reason: source-unreadable}
        │
        ▼ MediaError 4 "503: Service Unavailable" / "404: Not Found"
Player (useSourceAvailability) ── POST /api/v1/media-source/check {contentId}
        │                                  │
        │ wait (no reload, no ledger)      ▼
        │ poll 2s, 4s, 8s, 15s…    MediaSourceHealer
        │                            1. Plex checkFiles=1  (readable? stop)
        │                            2. host heal over SSH (chmod 0000 → 0777,
        │                               plus zeroed siblings in the folder)
        │                            3. Plex re-check
        │                            4. push after 2 min unreadable (once)
        ▼
readable ──► one remount at the saved position (fresh ledger)
```

### 1. Proxy — `PlexProxyAdapter`

For a direct-play media file (`/library/parts/{id}/{ts}/file.{ext}`) only:

- `shouldRetry(404, attempt, path)` retries up to 3 times, so the briefest
  refusals never reach the Player.
- `getErrorReplacement(path, 404)` answers **503** with a `retry-after: 5`
  header and body `{ error, reason: 'source-unreadable' }` when the refusal
  persists.

Every other 404 passes through unchanged. `ProxyService` gained the generic
`getErrorReplacement` hook for this, and passes `path` to `shouldRetry` (see
`IProxyAdapter.mjs`).

A genuinely deleted file now also answers 503. Telling the two apart is the
check endpoint's job, and it answers `missing`.

### 2. Backend — `POST /api/v1/media-source/check`

| Piece | File |
|---|---|
| Rules: rating-key parsing, part classification, push text | `backend/src/2_domains/media/sourceHealth.mjs` |
| Repair ladder, per-file episodes, alert | `backend/src/3_applications/media/MediaSourceHealer.mjs` |
| Plex `checkFiles=1` probe, then a one-byte request of the part itself: `checkFiles` only stats the file, and Plex can say `accessible` while serving the part 404 (mid scan). A 403 or 404 on the part is `unreadable` with `reason: part-refused`; an error on that request never escalates. | `backend/src/1_adapters/content/media/plex/PlexSourceProbe.mjs`, `PlexClient.partStatus` |
| Host SSH heal | `backend/src/1_adapters/media/SshMediaHostHealer.mjs` |
| Router | `backend/src/4_api/v1/routers/mediaSource.mjs` |
| Host script (forced command) | `scripts/media-source-heal.sh` |

Request: `{ contentId: 'plex:696316', deviceId?, origin? }` (`origin: 'proxy'` = the proxy refused the file: refresh it on the host even if Plex says readable).
Response: `{ state, contentId, unreadableSince?, unreadableMs?, steps[] }`, where
`state` is one of:

| state | Meaning | Player does |
|---|---|---|
| `readable` | Plex reports every part accessible | reload (resume after a wait) |
| `unreadable` | the file exists but Plex cannot open it | wait and poll |
| `missing` | Plex reports the file does not exist | ordinary recovery ladder |
| `unknown` | not a Plex item, a container (`reason: 'not-a-leaf'`), or Plex itself did not answer | ladder, or keep waiting if already waiting (a screen also keeps waiting on a confirmed refusal) |

**Episodes.** The first `unreadable` answer opens an episode for that file. The
host rung runs at most once every `hostHealCooldownMs` (20s) per file. The push
goes out once per episode, after `alertAfterMs` (2 min). An episode closes on
`readable` or `missing`, or is abandoned after 10 minutes with no checks.
Concurrent checks for the same file share one run.

**Host heal.** The app container cannot see the NAS share; only the Plex
container mounts it. The backend SSHes to the host with a key that
`authorized_keys` restricts to one forced command, `media-source-heal.sh`.

- The path travels base64-encoded as the only argument, so there is no shell
  quoting.
- The script refuses anything outside the media root, and any path containing
  `..`.
- It reports mode, existence and a test read.
- On mode `0000` it restores `0777` (every healthy file in the library is 777),
  plus any zeroed files in the same folder.
- It cannot remount, which needs root. Remounting stays with the root-owned
  `nfs-watchdog.sh`.

### 3. Player — `useSourceAvailability` inside `useMediaResilience`

| Piece | File |
|---|---|
| Rules: refusal detection, backoff, decision, notice text | `frontend/src/modules/Player/lib/sourceAvailability.js` |
| Hook: check, poll, settle | `frontend/src/modules/Player/hooks/useSourceAvailability.js` |
| Integration | `frontend/src/modules/Player/hooks/useMediaResilience.js` |
| Notice under the spinner | `PlayerOverlayLoading.jsx` (`sourceNotice`), `.loading-notice` in `Player.scss` |

**Triggers**

- A media error with code 2 or 4 whose message starts with `403`, `404` or
  `503`. `usePlaybackHealth` now latches `errorMessage` next to `errorCode` for
  this.
- The startup deadline, for Plex items: the Player checks first, and only an
  answer that says nothing about the file (`normal`) runs the ladder.
- An **HLS refusal** (2026-10-07): hls.js network errors never become a
  MediaError, so `VideoPlayer` raises `daylight:hls-refusal` (see "Refusal
  recovery gaps closed"). It is a suspected refusal; a confirmed status
  (403/404/503) lets a screen keep waiting when the backend cannot judge.
- A **suspected** refusal: a code 2 or 4 error with no status in the message.
  Mid-playback, Chromium reports a refused part as `MEDIA_ELEMENT_ERROR: Format
  error` (after a URL refresh) or `PIPELINE_ERROR_READ` (after a remount), so
  the rule above never matched it. The Player asks once. `unreadable` starts the
  wait. `readable` returns `normal`, never the extra `retry` reload, because a
  readable file with a failing stream belongs to the stall ladder.
- **Before the stall ladder gives up.** On a queue, exhaustion skips the item,
  so for Plex items the jolt ladder asks first. `wait` holds instead of
  skipping (`exhausted-skip-deferred`); anything else is exhausted as before.
  When that wait ends with `resume`, the ladder restarts from rung zero, so the
  restored file gets a fresh ladder rather than an instant skip.

2026-09-29: Plex refused a Bluey part at 6:17 of 7:00 while its library scan
ran. The stall ladder ran both rungs and skipped the episode; the file was
readable again a minute later. Both of the last two triggers, together with
the part probe below, exist for that case.

**While waiting**

- Status is held at `recovering`, with no startup deadline armed.
- `triggerRecovery` defers every call, and jolt rungs are held.
- A user pause is not inferred from the pause the error caused.
- The overlay reads `Fixing this video… · m:ss` (audio: `Fixing this audio…`). Before 2026-10-07 it read `Video file unavailable — retrying`.
- Tapping the spinner checks again at once.
- Checks back off: 2s, 4s, 8s, then every 15s.
- A failed check, such as the backend restarting mid-outage, keeps waiting.

**Settling**

| Decision | What happens |
|---|---|
| `resume` | Resets the recovery ledger, then one `source-restored` recovery with `refreshUrl` and `forceRemount`. It seeks to the last position that played, and works even from `exhausted`. It carries `resumePlayback` (the rebuilt element autoplays) unless the viewer had paused before the error: the refused load pauses the element itself, and before 2026-09-30 that pause was carried as the viewer's, so the restored video sat loaded and frozen until the 15s startup deadline remounted it again. |
| `retry` | The refusal cleared before any wait: one `source-refusal-cleared` recovery. |
| `normal` | Nothing extra; the ordinary ladder runs — except for a `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4) element the backend calls readable (see below). |
| `gave-up` | After the maximum wait (default 30 minutes, an owner option) the Player falls back to `exhausted` (Tap to Retry) and calls `onExhausted` with reason `source-unavailable-gave-up`. |

**The maximum wait is an owner option.** `monitor.sourceUnavailableMaxMs` in the
Player's resilience config (`mediaResilienceConfig`) sets it; the default stays
`SOURCE_UNAVAILABLE_MAX_MS` (30 min). The final poll is scheduled to land on the
limit itself, not on the next 15 s step after it.

**Owners hear the wait.** An owner that passes the opt-in `onResilienceEvent`
prop (only Media's `PlayerBridge`; `onError` owners see nothing new) receives
`{ kind: 'source-wait', waiting: true, since, contentId }` when a wait opens and
`{ kind: 'source-wait-ended', waiting: false, decision }` when it ends
(`resume`, `retry`, `normal`, `gave-up`, or `abandoned` when the item changes).
`gave-up → exhausted → onExhausted` remains the only skip path.

**Media's policy (`/media`, RELY.5a, 2026-10-03).** Media's `PlayerBridge` sets
`sourceUnavailableMaxMs: 60000`. A wait longer than 3 s shows "Waiting for
<title> — the file is being repaired" with Skip now and Retry, and the mini
player's problem sign; both clear (and recovery is logged) when the file comes
back. At 60 s the item is skipped: "<title> skipped — file unavailable. Now
playing <next>", with Retry (which plays the item again, re-asking the check).
Storm guard: if the item after such a skip also enters a wait within 60 s, Media
stops auto-skipping and holds on it with one "Library unavailable" notice.
Fitness and the kiosks pass no option and no `onResilienceEvent`: they keep the
30-minute wait and the existing overlay.

**Readable but unplayable.** A code-4 element ("Format error") whose file the
backend calls readable used to arm nothing: code 4 is outside the stall ladder,
`normal` added nothing, and the pause that follows a failed load was read as the
viewer's, which disarmed the startup deadline — the item sat on "Recovering…"
forever and its owner never heard it failed (2026-10-03, found by the RELY.5a
journey trace; not the healing wait). Now a pause that lands on a dead pipeline
(an element error that arrived while it was playing) is not a viewer pause —
a real viewer pause always stands and also clears any armed startup deadline —
and an element whose LIVE error is code 4 (never the latched signal, which
survives an in-place reset) gets one fresh-URL remount
(`media-error-unplayable`); the same failure again — a new error, or the
startup-deadline re-check answering readable while the live element still
reports code 4 — exhausts with reason `media-error-unplayable` (`attempts: 2`).

## Configuration

`data/system/config/media-source-heal.yml` (read with
`configService.getAppConfig('media-source-heal')`). It is **not** in
`media.yml`: that file is on the loader's infrastructure list and
`getAppConfig('media')` returns nothing. The first deploy put the section there
and booted with `hostHealer: false`.

```yaml
host:
  host: <docker bridge gateway>
  user: <host user that owns the forced-command key>
  privateKey: data/system/ssh/media-heal_ed25519
  knownHostsPath: data/system/ssh/known_hosts
  pathMap:                       # Plex container path -> host path
    - from: /data/media/video/fitness
      to: <media root>/Fitness
timing:
  hostHealCooldownMs: 20000
  alertAfterMs: 120000
```

**Server-side trigger.** Only the video Player asks `/media-source/check`.
Audio paths (garage menu music, playlists) just skip a refused track, so on
2026-10-01 a ghosted Children's Music file stayed unreadable for 4h+ with no
heal attempt. The proxy now reports every part 404 it turns into 503
`source-unreadable` (`ProxyService.onErrorReplaced`);
`3_applications/media/proxyRefusalTrigger.mjs` maps the path back to its rating
key (`PlexAdapter.resolveRatingKeyForPath`) and runs the same
`mediaSourceHealer.check`, marked `origin: 'proxy'`. It **awaits** the
resolution before it gives up, so `media.source.heal.proxy-unmapped` now means
"Plex itself could not say which item owns this part".

**The part index (corrected 2026-10-07).** This section used to say the index
held "every part URL the adapter has minted since startup". It did not: only
`loadMediaUrl` indexed, so the direct-play URLs built by `getItem` /
`_toPlayableItem` (and every queue/list builder, which all funnel through it)
were never mapped, and the index was empty after every restart. Now:

- `_toPlayableItem` indexes every `Media[].Part[].key` it can hand out;
  `loadMediaUrl` still indexes the URL it mints. Bounded (5000, oldest falls off).
- A part that is still unknown is resolved through Plex:
  `GET /library/all?type=4&media.part.id=<id>`, then `type=1` (movie), then
  `type=10` (track). The filter is `media.part.id` — a bare `part.id=` is
  silently ignored and returns the whole library. A hit is cached in the index
  and logs `media.source.heal.part-resolved {partId, ratingKey, via}`; a miss is
  remembered for 30 s so one stuck file does not become three library queries
  per proxy refusal.
- Transcode segments (`/video/:/transcode/universal/session/<uuid>/...`) carry
  **Plex's** session uuid, not the `X-Plex-Session-Identifier` we mint, so
  nothing can be indexed at mint time. On a segment refusal the adapter asks
  `GET /status/sessions` (read-only) and matches `Metadata[].TranscodeSession.key`
  (the uuid) to `Metadata[].ratingKey` (`resolveRatingKeyForSession`). Hits are
  cached (logs `media.source.heal.session-resolved`); an unmatched uuid is
  remembered for 30 s. A session that already ended is not in the list and
  stays unmapped (`proxy-unmapped`).
- The proxy trigger is throttled: one resolve per refused file per 30 s (a
  transcode's segments share one key) and one check per item per 30 s. Only
  segment **files** (`.ts`, `.m4s`, `header`) become 503 `source-unreadable`;
  a playlist 404 passes through.
- `POST /check` honours `origin: 'proxy'` for at most 10 claims a minute
  across the server (a claim can trigger a host chmod); past that the check
  runs without it. Only the first check of a wait carries the claim; polls do
  not. The healer's per-file refresh cooldowns are never evicted by a flood:
  a full map refuses new refreshes instead.

`drop_caches` (the watchdog) does not clear a ghost on an inode the kernel
still holds; a ctime bump (below) or a directory listing of the folder does.

When the host sees mode `000` the script restores `0777` (and zeroed
siblings). When it does **not** — Plex refused with `Permission denied` while
the mode reads 777 — it re-applies the file's current mode (`cacheRefreshed`).
Both bump the file's ctime on the NAS, which is the only thing that makes this
host's NFSv3 cache re-trust the file's attributes and access rights (the
"ghost 000" cache poisoning, see `nfs-watchdog.sh`). That is a per-file cache
reset that needs no root; the system-wide `drop_caches` stays with the
watchdog.

**What the ghosts look like on this host (observed 2026-10-02, no packet
capture yet).**

- **They are made by directory walks on a cold cache.** Right after a
  `drop_caches`, a `find -maxdepth 3 -perm 000` over the share produced fresh
  `000` entries; the same walk on a warm cache produced none. A full-depth
  `find -perm 000` listed 37,610 paths (mostly `#recycle/`, `Speech/_Inbox`,
  `Archives/`), and a 400-path sample was 100% readable minutes later with
  ctime unchanged. That points at attributes delivered with directory listings
  (NFSv3 READDIRPLUS), not at any real `chmod`.
- **Some files read `000` from the NAS itself.** A handful (macOS `.DS_Store` /
  `._*`, 104 files in `SFX/Bonus`) still read `000` after the attribute cache
  expired, with a ctime weeks old: the server reported mode 0 without the mode
  ever having changed. A `chmod 0777` (ctime bump) fixes each one.
- **The watchdog sustains its own loop.** `nfs-watchdog.sh` drops caches when
  its depth-3 scan sees a ghost; its next scan runs on the now-cold cache and
  finds new ones. On 2026-10-02 it dropped caches every 2–5 minutes all
  morning (`/tmp/nfs-watchdog-dropcaches-last` mtime, readable without root).
- **Plex hits them during its scheduled analysis.** `Permission denied` lines
  clustered at 05:00 on 2026-10-01 and 2026-10-02; the files were readable
  later with ctime untouched.

Still open: whether the NAS sends mode 0 in READDIRPLUS replies (server bug)
or the client mis-merges them. A two-way capture (calls and replies,
`tcpdump -Z root … "host <nas> and port 2049 and less 1000"`) answers it; the
2026-10-02 run was never started. Mounting with `nordirplus` is the cheap
test of the READDIRPLUS theory. Both need root, as does any change to the
watchdog's cooldown or scan.

Relative `privateKey` / `knownHostsPath` are resolved against the app root
(the data dir's parent) in `app.mjs`. The backend runs with cwd `backend/`, so
before 2026-09-30 ssh resolved them there and every host heal failed with
`Identity file ... not accessible` — the ladder still recovered via Plex
re-checks, which hid it.

Take `pathMap` from `docker inspect plex` mounts, and update it when those
mounts change. An unmapped path makes the host rung return `unmapped-path`, and
the ladder carries on without it. With no `host` section the host rung is
skipped entirely: Plex re-checks and the push still happen, and the Player still
waits. The boot log line `media.source.heal.configured {plex, hostHealer}` says
which rungs are live.

### Host setup (once per host)

1. Copy `scripts/media-source-heal.sh` to `~/bin/` for the host user. Re-copy it
   after changing it: the forced command runs the installed copy, not the repo.
2. Generate an ed25519 key. Put the private half at the data-volume path above
   (mode 600), with the `ssh/` folder and both files **owned by the container's
   `node` user (uid 1000)**. The backend runs as `node`, not root; a root-owned key
   (what `docker exec … cat >` leaves) is unreadable to it, and the host rung
   fails with `ssh-failed`.
3. Append the public half to that user's `~/.ssh/authorized_keys`:
   `restrict,from="172.16.0.0/12",command="/home/<user>/bin/media-source-heal.sh" ssh-ed25519 AAAA… daylight-media-heal`
4. Verify as the backend's user:
   `docker exec daylight-station su node -s /bin/sh -c 'cd /usr/src/app && ssh -i <key> -o UserKnownHostsFile=<known_hosts> <user>@<gateway> <base64 path>'`
   prints one JSON line, and any other command prints `{"ok":false,…}`.

## Refusal recovery gaps closed (2026-10-07)

On 2026-10-07 the living-room Shield burned ~6 Bluey episodes in a row: Plex
refused each (an NFS per-user ghost, `Permission denied`), each stalled, recovery
exhausted and the queue auto-skipped. The ghost lasted 25+ minutes; the host
heal clears it in under a second. Recovery existed and never ran. Design:
`docs/superpowers/specs/2026-10-07-media-refusal-recovery-design.md`.

| Gap | Fix |
|---|---|
| **A. Wrong item asked.** The Player sent `meta.contentId || plexId`; `/play` carries `id`/`assetId`, and a Player's `plexId` is the queue ROOT, so the healer was asked about the show and said `unknown`. | `resolveSourceContentId(meta, plexId)`: `contentId`, then `assetId`, then `id`; `plexId` only as a last resort. The backend rejects a container (show/season/artist/album/collection/playlist, or an item with no `Media`) with `reason: 'not-a-leaf'` and logs `media.source.heal.not-a-leaf` — never a silent `unknown`. |
| **B. Part not mappable.** | The part index above. |
| **C. "Readable" skipped the host rung.** A per-user ghost refuses Plex's streamer while its stat passes. | A proxy-observed refusal (`origin: 'proxy'`, sent by the proxy trigger and by the Player for a confirmed 403/404/503) runs the host ctime refresh even when Plex says readable, then re-checks. Per-file cooldown `proxyRefreshCooldownMs` (60 s). Logged as `media.source.heal.proxy-refresh`. |
| **D. HLS refusals invisible.** The manifest answers 200; the refusal is a transcode segment 404 and hls.js reports a `networkError` with no MediaError. | Proxy: a persistent transcode **segment** 404 becomes the same 503 `source-unreadable` (retried 3x first), so the backend trigger fires. Player: `lib/hlsRefusal.js` classifies hls.js errors (403/404/5xx on a manifest/level/fragment; the 2nd of a session, or any fatal one) and `VideoPlayer` raises `daylight:hls-refusal` on the element; `useSourceAvailability` asks the backend as a *suspected* refusal (readable -> the stall ladder, as before). Logged as `playback.refusal-hls {status, details, urlKind, decision}`. |

**Screens hold (owner ruling, screens only).** A refusal NEVER auto-skips a
*screen's* queue. "Screen" means a TV/kiosk screen rendered by the
screen-framework (living-room, office, Portal screen pages): the screen
framework opts in with `holdOnRefusal` (`ScreenPlayer`, `MenuStack`). **Fitness,
piano and school-lesson Players do not opt in** and keep their previous
behaviour exactly: wait up to 30 minutes, then the previous cap action
(close / ladder / skip), no Skip keys.

- A confirmed refusal (the element named 403/404/503; other 5xx on HLS is only
  *suspected*) the backend cannot judge (`unknown`, or the check failed) keeps
  a screen waiting. Four consecutive `unknown` *answers* (a failed request does
  not count) are treated as missing, so a deleted item does not hold for 30
  minutes. A `missing` file, an unlabelled error, and a file the backend calls
  readable go to the ordinary ladder. A held screen publishes a `waiting`
  problem record in its session snapshot, so a phone steering it sees it is
  parked.
- The wait is the existing one (poll 2/4/8/15 s, resume at the saved spot,
  30-minute cap), with the quiet `Fixing this video…` note.
- At the cap the Player does **not** advance (`resilience-exhausted-hold`); it
  stays on Tap to Retry.
- **Skip** on a screen: OK (Enter / NumpadEnter) or the media-next key, or a tap
  on the `Skip · OK` pill, which shows during the wait AND in the held state
  (`lib/Player/useSourceWaitSkipKeys.js`; Back is unreliable on the Shield, so
  nothing depends on it). D-pad and Tab are never used. The listener only acts
  when focus is on the page body or inside that Player, the pill is actually
  visible (not blacked out), and the Player is not auxiliary; it swallows a key
  (`stopImmediatePropagation`) only when a skip really happened, absorbs the
  repeat within 1 s, and otherwise leaves every key to the listeners beneath it.
  `playback.source-wait-skip` records it.
- **Media on phones is unchanged**: it passes `onResilienceEvent`, keeps its 60 s
  cap, its own Skip now / Retry and the storm guard, and gets none of the above.

## Observability

| Event | Where | Meaning |
|---|---|---|
| `proxy.error-replaced` | backend | a media-file 404 became 503 after retries |
| `media.source.heal.not-a-leaf` | backend | the healer was asked about a container (show/season/...): the caller sent the wrong id |
| `media.source.heal.part-resolved` | backend | an unindexed part was resolved through Plex (`via` = the library type that matched) |
| `media.source.heal.proxy-refresh` | backend | the host refresh ran for a proxy-observed refusal although Plex said readable |
| `media.source.heal.proxy-unmapped` / `.proxy-failed` | backend | Plex could not say which item owns the refused path / the trigger failed |
| `playback.refusal-hls` | frontend | an hls.js network refusal reached the resilience hook (`status`, `details`, `urlKind`, `decision`) |
| `playback.source-wait-skip` / `playback.resilience-exhausted-hold` | frontend | a screen's wait was skipped by hand / a screen held after the cap instead of advancing |
| `media.source.heal.opened` / `.step` / `.resolved` / `.abandoned` / `.alerted` | backend | the ladder, per file; `resolved.resolvedBy` says which rung fixed it (`plex-check`, `plex-recheck`, `host-chmod`) |
| `playback.source-unavailable-entered` / `-poll` / `-resolved` / `-gave-up` | frontend | the Player's wait |
| `playback.source-refusal-cleared` | frontend | refusal gone by the first check |
| `playback.source-refusal-suspected` | frontend | an unlabelled code 2/4 error was checked; `decision` says what followed |
| `playback.exhausted-skip-deferred` | frontend | the stall ladder ran out on a refused file and waited instead of skipping |
| `playback.resilience-recovery-deferred` | frontend (debug) | a recovery held back during a wait |

To find out which rung actually fixes these incidents:

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:"media.source.heal.resolved" AND _time:30d | stats by ("data.resolvedBy") count()'
```

## Known limits

- Only Plex items are healed. Other sources go straight to the ordinary ladder.
- DASH/transcode sessions reach the file through Plex's transcoder, which fails
  differently. The startup-deadline check still asks the backend, so a refused
  file behind a transcode is still waited out. HLS segment refusals are now seen
  (see above); a DASH segment refusal still relies on the proxy's 503 and the
  startup/stall checks, since dash.js does not raise the HLS refusal event.
- The host rung can chmod, but it cannot remount, clear the NFS client's caches,
  or see why the NAS zeroed the modes.
