# JamCorder MIDI Harvest — Design

> A daily harvester that enumerates, downloads, renames, and archives MIDI
> recordings from a JamCorder device (a networked piano "jam recorder") into
> `household/history/piano/jamcorder/` (household-generic, non-user-scoped —
> alongside the per-user `history/piano/{userId}/` dirs). Date: 2026-07-12.

## Problem

The JamCorder at `10.0.0.244` ("Living Room Baby Grand") records piano
performances as `.mid` files on an SD card, exposed over HTTP. We want those
recordings pulled into the DaylightStation data volume automatically — enumerated,
downloaded, renamed to a local-time layout, and de-duplicated — on a daily
schedule.

## Device Findings (verified against the live device)

- **List API:** `POST http://<host>/api/files/list/detailed` with body
  `{"filepath":"/JAMC/2026/<uuid>"}` → JSON
  `{ "dir": "...", "files": [{ "filename", "isDirectory", "sizeBytes", "modifiedLocalTime" }] }`.
  Responses are gzip-encoded (Node `fetch` auto-decompresses).
- **Structure:** `/JAMC` → year dirs (`2025/`, `2026/`) + `other/` → session-UUID
  dirs → `.mid` files (e.g. `Jmx-A00005-Jan-02-2026.mid`).
- **`modifiedLocalTime`** is a device-relative day counter — NOT a usable
  timestamp. Ignore it.
- **Download:** `GET http://<host>/sdcard/JAMC/2026/<uuid>/<file>.mid` → 200, raw
  MIDI bytes (`MThd…`). Note the list path (`/JAMC/…`) and download path
  (`/sdcard/JAMC/…`) differ by the `/sdcard` prefix.
- **Embedded metadata (the timestamp source):** every `.mid` begins with a
  sequencer-specific MIDI meta event (`0xFF 0x7F`) carrying a JSON header,
  `jmxStoneHdr{…}`, with a real SNTP-synced time and rich metadata:
  ```json
  "time": { "timeSource": "sntp", "unixtime": 1767406660, "localOffset": -480 },
  "asset": { "assetIdx": 5, "assetUuid": "aa7eef01-…", "midiPath": "…" },
  "identities": { "jamcorderName": "Living Room Baby Grand", "performerName": "Kern Family", … }
  ```
  `unixtime` + `localOffset` (minutes) give the exact local recording time.
  Verified: `1767406660` + `-480` → `2026-01-02 18:17:40` local, matching the
  filename's `Jan-02-2026`.

## Requirements

| Item | Decision |
|---|---|
| **Archive layout** | `household/history/piano/jamcorder/YYYY/YYYY-MM/YYYY-MM-DD HH.MM.SS.mid` (household-generic, non-user-scoped) |
| **Time source** | Each file's embedded `unixtime` + `localOffset` (per-recording local time, DST-correct) |
| **Scope** | Recursive — all sessions across all years and `other/` |
| **Dedup** | By device path (pre-download); skip already-archived recordings |
| **Cadence** | Daily (`0 4 * * *`) |
| **Saved artifact** | The renamed `.mid` only (metadata is embedded in it) |
| **Device offline** | Log and skip; no partial writes; retry next day |

## Architecture

Integrates with the existing **harvester framework** (a job whose `id` matches a
harvester `serviceId` is auto-routed by the scheduler → harvester executor,
driven by `system/config/jobs.yml`). Unlike the existing harvesters (which
orchestrate inside the adapter), this keeps orchestration and parsing out of the
adapter, per `docs/reference/core/layers-of-abstraction/`.

```
2_domains/jamcorder/                         ── pure, no I/O, no clock
  JamCorderStone.mjs                          VO: .fromMidiBuffer(buf) parses the jmxStoneHdr meta
                                              event; exposes unixtime, localOffsetMin, jamcorderName,
                                              performerName, assetUuid; .recordedLocal() → parts;
                                              .archiveRelPath() → "2026/2026-01/2026-01-02 18.17.40.mid"

3_applications/jamcorder/                    ── orchestration + ports (Decision D3)
  ports/IJamCorderSource.mjs                  listRecordings() → [{listPath, downloadPath}]; download(ref) → Buffer
  ports/IJamCorderArchive.mjs                 has(ref) → bool; save(relPath, buffer) → void; markProcessed(ref, relPath) → void
  HarvestJamCorderRecordings.mjs              use case: enumerate → filter-new → download → JamCorderStone →
                                              save → markProcessed → { count, status }

1_adapters/jamcorder/                        ── external I/O, extends its app-layer port
  HttpJamCorderSource.mjs                     extends IJamCorderSource; injected HttpClient; recursive POST list;
                                              GET /sdcard/… → downloadBuffer
  FsJamCorderArchive.mjs                      extends IJamCorderArchive; FileIO.writeBinary +
                                              configService.getHouseholdPath('history/piano/jamcorder'); YAML index

1_adapters/harvester/other/JamCorderHarvester.mjs   extends IHarvester (serviceId 'jamcorder', category OTHER);
                                              harvest() delegates to HarvestJamCorderRecordings

5_composition/bootstrap.mjs                  wire adapters + use case + harvester; registerHarvester('jamcorder', …)
system/config/jobs.yml                       + { id: jamcorder, name: "JamCorder MIDI Harvest", schedule: '0 4 * * *', module: <placeholder>, enabled: true }
household/config/jamcorder.yml               { host: 10.0.0.244 }
```

**Layer adherence:** the domain VO has zero I/O; the use case depends only on the
two ports (no adapter imports, no `fs`/`path` for data ops); adapters `extends`
their ports (Decision D7) and receive resolved config (`host`, `HttpClient`,
`configService`) from bootstrap — never a config singleton.

## Data Flow

1. Scheduler (daily) → harvester executor routes `jamcorder` →
   `JamCorderHarvester.harvest()` → `HarvestJamCorderRecordings.execute()`.
2. `source.listRecordings()` recursively walks `/JAMC` (year + `other` dirs →
   session dirs → `.mid` files) → refs `{ listPath: '/JAMC/…', downloadPath: '/sdcard/JAMC/…' }`.
3. Drop refs where `archive.has(ref)` (pre-download dedup).
4. For each new ref: `buf = source.download(ref)` → `stone = JamCorderStone.fromMidiBuffer(buf)`
   → `archive.save(stone.archiveRelPath(), buf)` → `archive.markProcessed(ref, relPath)`.
5. Return `{ count: saved, status: 'success' | 'skipped' | 'error' }`.

## Dedup

- YAML index `household/history/piano/jamcorder/_index.yml`, mapping device `listPath →
  archive relPath`, keyed by the stable device path (session UUID + filename),
  checked **before** download so already-archived files are never re-fetched.
- Secondary idempotency: `save` skips the write when the target already exists.
- If the index is lost, the run re-downloads once (acceptable, no corruption).

## Error Handling

- **List/connectivity failure:** `HttpClient` returns non-2xx without throwing;
  the source surfaces the failure, the use case returns `{ count: 0, status: 'error' }`,
  logs, writes nothing.
- **Per-file failure** (download error, or a `.mid` whose `jmxStoneHdr` is
  missing/unparseable): log a warning, skip that file, continue. One bad file
  never fails the run; only successful saves are counted.
- **Recursion safety:** capped depth + `.mid`-only file filter.
- **Writes:** `FileIO.writeBinary` (ensure-dir + write); index updated after a
  successful save. A crash between save and index-update is covered by the
  target-exists guard on the next run.

## Configuration

- `household/config/jamcorder.yml`: `{ host: 10.0.0.244 }` (device IP out of
  code; bootstrap injects it). No auth (open on the LAN).
- `system/config/jobs.yml`: add
  `{ id: jamcorder, name: "JamCorder MIDI Harvest", schedule: '0 4 * * *', module: "<placeholder>", enabled: true }`.
  (`module` is required by `Job.validate()` but unused for harvester dispatch —
  routing is by `id` == `serviceId`.)

## Testing (TDD, layer-aligned)

- **Domain (pure):** commit a small real `.mid` fixture (from the live device);
  assert `JamCorderStone.fromMidiBuffer` extracts `unixtime`/`localOffsetMin`/
  metadata, and `.archiveRelPath()` → `2026/2026-01/2026-01-02 18.17.40.mid`; a
  header-less buffer throws a domain error.
- **Application:** `HarvestJamCorderRecordings` with a fake `IJamCorderSource`
  (fixture refs + buffers) and a fake in-memory `IJamCorderArchive` — asserts
  dedup (only new downloaded), correct rel-paths/count/status, per-file parse
  error skipped-not-fatal, and source error → `status: 'error'`.
- **Adapters:** `HttpJamCorderSource` with a fake `HttpClient` (fixture list JSON
  + `.mid` buffers) → recursive enumeration + `/JAMC`↔`/sdcard` path mapping;
  `FsJamCorderArchive` against a temp dir → `writeBinary` + index round-trip +
  `has()` dedup. Optional env-gated live test against `10.0.0.244` (mirrors the
  existing harvester live tests).

## Non-Goals

- No transcoding/analysis of the MIDI (archive-only; embedded metadata is
  preserved inside each `.mid`).
- No multi-device / multi-performer fan-out (one configured `host`); the design
  leaves room but doesn't build it.
- No deletion from the device (read-only harvest).
- No sidecar metadata files or index of performers/jamcorders (the data lives in
  each `.mid`; can be added later if a consumer needs it).
