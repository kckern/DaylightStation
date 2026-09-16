# Plex device table growth and the statistics lock

**Symptom:** content takes 15–26 seconds to start, intermittently, on every
surface that plays Plex media — while the *same item* minutes earlier started
instantly. Worst on short items (a 3-minute story), least visible on long ones
(a 20-minute lesson), because each play rolls the dice once.

## Confirm it in one command

```bash
grep "Held transaction for too long" "<plex-logs>/Plex Media Server.log" | tail -5
```

Healthy: nothing. Unhealthy: a line roughly every ~56 seconds, each reporting
~26 seconds held. Plex also names the victim per request:

```
[Req#xxxx] Took too long (24.72 seconds) to start a transaction on Statistics/Device.cpp:46
```

Corroborate: Plex CPU sits near 100% for half of every minute with **no active
streams** (`docker stats --no-stream plex`).

## Cause

Plex records one `devices` row per distinct `X-Plex-Client-Identifier` and never
prunes them. Its periodic **per-device** statistics pass holds a database write
transaction while it grinds that table. Every request that opens a streaming
session — a direct-play file fetch, a transcode decision, `/:/timeline`,
`/playQueues` — needs that same transaction and blocks behind it.

A **new** identifier forces a device-row write and therefore waits for the lock;
an **existing** one is only a read and sails past. That is why minting a fresh
identifier per playback was so expensive.

## Fix (already applied)

`PlexAdapter._generateSessionIds` sends one stable identity
(`API_CLIENT_IDENTIFIER`) for backend-initiated requests instead of
`api-${random}` per call. Stream isolation is unaffected: `sessionIdentifier`
remains unique per request, which is what Plex uses to separate concurrent
streams, and frontend-supplied sessions are untouched.

## Clear the backlog

```bash
sudo ./scripts/plex-prune-api-devices.sh
```

Plex must be **running** when it starts (it reads safety counts through
`docker exec`, then stops Plex itself). The script does the whole job: preflight,
refusal if any `api-*` device carries watch history, stop, back up db+wal+shm,
prune, vacuum, integrity check, auto-restore on failure, restart, and a
three-minute watch confirming the lock stopped. Downtime ~50 seconds.

**It must use Plex's own SQLite, never the host's** — the schema has a
`naturalsort` collation the host binary lacks, and `VACUUM` rewrites every index.
See the script's header comment for why that means a throwaway container.

## Verify

```bash
# should return in milliseconds, not tens of seconds
curl -s -o /dev/null -w '%{time_total}\n' \
  "<app>/api/v1/proxy/plex/library/parts/<part>/file.mp3?X-Plex-Client-Identifier=probe&X-Plex-Session-Identifier=probe-1"
```

Measured 2026-09-16, before → after: session-creating request 22.1–24.2s →
0.023–0.073s; held-transaction warnings every ~56s → none; Plex CPU ~105% half
the time → 0.31%; devices 81,010 → 7,015.

## If the lock survives a prune

Then device count was not the driver. Next suspect is the Plex build itself
(this was 1.43.4.10903); compare against the container's previous image.
