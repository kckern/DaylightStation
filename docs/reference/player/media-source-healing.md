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
| Plex `checkFiles=1` probe | `backend/src/1_adapters/content/media/plex/PlexSourceProbe.mjs` |
| Host SSH heal | `backend/src/1_adapters/media/SshMediaHostHealer.mjs` |
| Router | `backend/src/4_api/v1/routers/mediaSource.mjs` |
| Host script (forced command) | `scripts/media-source-heal.sh` |

Request: `{ contentId: 'plex:696316', deviceId? }`.
Response: `{ state, contentId, unreadableSince?, unreadableMs?, steps[] }`, where
`state` is one of:

| state | Meaning | Player does |
|---|---|---|
| `readable` | Plex reports every part accessible | reload (resume after a wait) |
| `unreadable` | the file exists but Plex cannot open it | wait and poll |
| `missing` | Plex reports the file does not exist | ordinary recovery ladder |
| `unknown` | not a Plex item, or Plex itself did not answer | ladder, or keep waiting if already waiting |

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

**While waiting**

- Status is held at `recovering`, with no startup deadline armed.
- `triggerRecovery` defers every call, and jolt rungs are held.
- A user pause is not inferred from the pause the error caused.
- The overlay reads `Video file unavailable — retrying · m:ss`.
- Tapping the spinner checks again at once.
- Checks back off: 2s, 4s, 8s, then every 15s.
- A failed check, such as the backend restarting mid-outage, keeps waiting.

**Settling**

| Decision | What happens |
|---|---|
| `resume` | Resets the recovery ledger, then one `source-restored` recovery with `refreshUrl` and `forceRemount`. It seeks to the last position that played, and works even from `exhausted`. |
| `retry` | The refusal cleared before any wait: one `source-refusal-cleared` recovery. |
| `normal` | Nothing extra; the ordinary ladder runs. |
| `gave-up` | After 30 minutes the Player falls back to `exhausted` (Tap to Retry) and calls `onExhausted`. |

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

## Observability

| Event | Where | Meaning |
|---|---|---|
| `proxy.error-replaced` | backend | a media-file 404 became 503 after retries |
| `media.source.heal.opened` / `.step` / `.resolved` / `.abandoned` / `.alerted` | backend | the ladder, per file; `resolved.resolvedBy` says which rung fixed it (`plex-check`, `plex-recheck`, `host-chmod`) |
| `playback.source-unavailable-entered` / `-poll` / `-resolved` / `-gave-up` | frontend | the Player's wait |
| `playback.source-refusal-cleared` | frontend | refusal gone by the first check |
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
  file behind a transcode is still waited out.
- The host rung can chmod, but it cannot remount, clear the NFS client's caches,
  or see why the NAS zeroed the modes.
