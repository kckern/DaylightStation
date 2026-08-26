# School — logs and tracing

How to find School's logs, what correlates a learner's story across events,
and what a **healthy** run of each pipeline looks like in the log store —
so a broken one is a diff, not a guess.

## 1. The one gotcha that wastes the most time

**`context.app:school` returns zero rows.** School's code paths tag
`context.app:api`, and split by subsystem in **`context.module`**:
`school-lifecycle`, `school-materials`, `school-api`, `school-print-scan`,
`school-generated-banks`. Every event name is still `school.*` (plus a few
adjacent ones: `laser-printer.*`, `piano.school-access.*`).

Two queries that actually work, against the household's log store
(see the root `CLAUDE.md` "Reading Logs" section for the base URL and the
`| stats by (...)` / quoted-dotted-field LogsQL syntax traps):

```bash
# By module (recommended — module names token-match "school-")
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.module:school AND _time:24h' -d 'limit=200'

# By message prefix (catches everything regardless of module tagging)
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:school AND _time:24h' -d 'limit=200'

# What's actually firing, ranked (do this first on any unfamiliar day)
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:school AND _time:24h | stats by ("_msg") count() as n | sort by (n desc)'
```

## 2. Retention: the log store is not the only place School's history lives

The indexed log store keeps **7 days**. Two things extend the horizon:

- **`media/logs/school/YYYY-MM-DD.jsonl`** — a dated, file-backed transport
  added specifically for School (the lifecycle telemetry audit's Gap D fix,
  `createSchoolLedgerTransport`), pruned at 400 days. This is the place to
  look for anything older than a week, or to grep locally on the host without
  round-tripping through the log store's query API. It degrades to a no-op
  with a one-line warning if the media volume is unwritable at boot — it will
  never take the subsystem down to observe it.
- **Per-learner evidence never expires**: `data/users/{id}/apps/school/attempts/{date}.yml`
  (append-only) and the print-document allocation/worksheet-instance records
  under `data/content/school/print-documents/` and
  `data/household/school/records/` are the durable record regardless of what
  the log store retained. If the logs are gone, the evidence usually is not.

**Timestamp convention footnote.** Backend event timestamps were local
wall-clock with the `Z` suffix stripped until 2026-08-22, which VictoriaLogs
parsed as UTC — every backend event before that fix is filed **7 hours early**.
A narrow `_time` window over old logs can read as "nothing happened" when the
real events are just outside it. Widen the window before concluding a gap is
real. (One incident investigation independently re-verified this on
2026-08-25 and found the store's `_time` field itself was already genuine
UTC by then — if you're ever unsure which convention a given day's data uses,
compare the newest row's `_time` against `date -u`.)

## 3. Correlation keys

**Use `learnerId`.** It was inconsistent before the telemetry audit (some
events carried `userId` for the same concept, 15-odd events carried a bare
`{error}` with no subject at all); the audit's fix standardized the field
(18 → 30 events carrying it) but **older or unaudited call sites may still
differ**. If a query by `learnerId` comes up short, retry with `userId`
before concluding the event never fired.

Other keys worth joining on: `sessionId` (work-session lifecycle),
`testId`/`cardId` (a physical answer sheet), `uid` (an NFC tag). A `learnerId`
plus a rough time window is usually enough to reconstruct one child's morning.

## 4. Sequence traces — what healthy looks like

### 4a. Self-service card tap or panel code → agenda/worksheet on the laser printer

```
omr.ingest.nfc  (or barcode-relay ingest)     — the physical tap/scan lands
  → ResolveScanAction / ResolvePersonalCard.execute
school.card.agenda-printed { created: N }     — success, N sheets queued
  or
school.card.agenda-suppressed                 — cooldown active, no new print
  or
school.print.denied / school.print.approval-required   — quota policy (laser worksheets)
laser-printer.job-sent → (no further event = printed)
```

**What a broken run looks like:** `school.card.agenda-printed { created: 0, offers: 0 }`
means the learner has no plan file at all (an onboarding gap, not a printer
fault — see `known-issues.md`). Multiple `agenda-printed`/`token minted`
events for the same `learnerId`+subject within milliseconds of each other is
the 2026-08-25 bouncing-reader signature (§5). A `school.print.printable-excluded`
warn means the picker silently hid an item — check the paper surface
profile's declared `capabilities:` against the bank's item types.

### 4b. OMR sheet scan → grade → thermal receipt → HA sound cue

```
omr.ingest.nfc / quiz.decode.sheet            — the physical sheet feeds through
  → ResolveCardScan.execute
school.print.scan-resolved                    — a live/satisfied allocation record matched
  or one of: scan-unresolved / scan-unknown-card / scan-dead-card / scan-no-allocation
             (each names *why* nothing graded — see hardware-troubleshooting.md)
school.print.scan-awaiting-review             — machine can't honestly grade everything; parked
  or
[grading completes] → session outcome recorded
school.grading_hook.fired { script, result }  — the repo told Home Assistant
  or .skipped (not_configured|backoff) / .failed / .circuit_open
[thermal receipt printed — see hardware-troubleshooting.md for its own event set]
```

**What a broken run looks like:** a `quiz.decode.sheet` event with **no
successor event of any kind** for that `testId`/`learnerId` is the exact
2026-08-26 "silent scan" signature — the fix (F-1–F-4, shipped) hoisted the
diagnostic and guaranteed every terminal outcome broadcasts, but if you are
reading pre-fix logs, absence of a successor event IS the finding, not a gap
in your query. `school.print.scan-live-record-unmarked` / the newer
`scan-rows-unmarked` means the card's *new* rows are blank — almost always a
reused/cumulative card whose owner hasn't bubbled today's worksheet yet, not
a hardware fault. A `thermalPrinter.timeout` followed, seconds later, by a
`job.complete` for a job whose implied start matches an *already-refused* job
is a zombie print (2026-08-25 RC-4) — blank paper was cut even though the
caller was told "refused."

### 4c. Living-room reading session (new, unverified on hardware)

```
session-open      — card resolved to a learner; mode derived (assignment|browsing)
book-selected     — a book tag confirmed the countdown
POST /playing     — the backend learns the story actually started
POST /read        — the story finished; RecordStoryRead writes evidence
session-close     — teardown (ceremony done, or idle timeout)
```

Every state and every failure path for this loop is enumerated exhaustively
in [`reading-sessions.md`](../../reference/school/reading-sessions.md) §7–9 —
that document, not this one, is authoritative for what each event means. Two
gaps are explicitly known and open: a story abandoned mid-playback never
tells the backend (session sits at `reading` until something else moves it),
and teardown after a completed ceremony rides the ~2-minute idle timeout
rather than firing immediately.

## 5. Reading the OMR relay's own health signals

The reader announces its health on every reconnect, riding the bus message
itself (not just its HTTP status) because a faulting reader's HTTP server is
usually the first thing to go quiet:

| On `omr.reader_liveness.reconnect_burst` | Verdict |
|---|---|
| `lastReset: "BROWNOUT"` | Confirmed power fault — check supply, cable, connector, in that order |
| `bootCount` climbing across bursts | The board is genuinely rebooting |
| `bootCount` steady through the burst | **Network** fault, not power — stop swapping hardware |
| `lastReset: "PANIC"` | Firmware crash — pull `/events` off the reader for what preceded it |
| `lastReset: "POWERON"` | Ordinary after a manual power-cycle; suspicious if nobody was there |
| both `null` | Reader firmware predates 2026-08-25 — reflash before guessing further |

Threshold is 3 reconnects inside 600s (calibrated against the 2026-08-25
incident's own reconnect spans). This is **detection only** — it tells you to
go look at the reader, it repairs nothing.

The bouncing-tap signature from the same incident: **5 `omr.ingest.nfc`
events for one UID inside ~103ms** is one physical tap producing five
electrical reads, not five taps — the relay's dedup guards the persisted
day-log but (pre-fix) not the broadcast every consumer (including print)
subscribed to. If you see a tight cluster of identical-UID events, treat it
as one tap.

## 6. Event catalog by pipeline stage

Full file:line detail lives in the code; this is the lookup table for "I saw
this event, what does it mean."

### Printing — laser (worksheets/agendas)

| Event | Level | Meaning |
|---|---|---|
| `school.print.denied` | warn | Over `maxPagesPerJob` or nothing to print — refused outright |
| `school.print.printable-excluded` | warn | A bank's item types need a paper capability the surface profile doesn't declare — silently hidden from the picker |
| `laser-printer.duplex-requested-not-applied` | warn | Duplex asked for on a direct-PDF job; this printer's sidedness comes from its own `sides-default`, not the job |
| `laser-printer.validate-job-rejected` | warn | IPP Validate-Job probe refused; adapter is trimming attributes one at a time |
| `PRINT_VALIDATE_FAILED` / `PRINT_SEND_FAILED` / `PRINT_FORMAT_UNSUPPORTED` | thrown | See `hardware-troubleshooting.md` — no bytes reached the printer |

### Printing — thermal (agendas, result receipts)

| Event | Level | Meaning |
|---|---|---|
| `thermalPrinter.preflight.refused` | warn | Pre-flight status check found a fault before sending — job aborted, correctly reported as not-dispatched |
| `thermalPrinter.timeout` | error | Connect timeout; socket destroyed so it can't wedge the printer's one connection slot |
| `thermalPrinter.open.after-abort` | warn | Connect succeeded *after* the timeout already fired — printer is slow, not unreachable; consider raising the timeout |
| `thermalPrinter.postjob.fault` / `.unverified` / `.ok` | error/warn/info | Three-tier post-send verification; only `fault` is recorded as NOT printed — `unverified` is treated as printed (bias toward never telling a child their work is lost when it may have succeeded) |
| `thermalPrinter.resync.prepended` | warn | Previous job didn't flush cleanly; a NUL-byte pad was sent to resync — recurring instances mean a flaky link |
| `school.lifecycle.no-receipt-printer` | warn | `lifecycle.receiptPrinter` names an unconfigured location — console still runs, every receipt reports itself unprinted |

### OMR scan → School record (the "never silent" backstop)

| Event | Level | Meaning |
|---|---|---|
| `school.print.scan-resolved` | info | Healthy — a live/satisfied allocation matched |
| `school.print.scan-unresolved` | warn | Card ID unreadable, or ambiguous among candidates |
| `school.print.scan-unknown-card` | warn | Real answers, but the store has never seen this card ID — usually a mis-bubbled ID; near-miss suggestions included |
| `school.print.scan-dead-card` | warn | Every record on the card is retired, yet marks arrived — a retired sheet was fed |
| `school.print.scan-no-allocation` | debug→warn* | Card is ours but nothing matches. *Promoted to `warn` when the card DOES carry a live record — that case is never routine |
| `school.print.scan-live-record-unmarked` / `scan-rows-unmarked` | warn | The wrong-rows signature — live rows blank while other rows on the card have marks (cumulative-card gotcha) |
| `school.print.scan-rescored` | warn | A settled record graded again — re-fed or borrowed card |
| `school.print.scan-awaiting-review` | info | Machine can't honestly grade everything; parked for a person, names `reasons`/`items` |
| `school.print.scan-not-recorded` | warn | Backstop: nothing else spoke for this scan, so this one did |

### Home Assistant grading hook

See [`home-assistant-grading-hook.md`](./home-assistant-grading-hook.md) for
the full event set (`school.grading_hook.fired/.skipped/.failed/.circuit_open/.error`).

### Lifecycle / boot wiring

| Event | Level | Meaning |
|---|---|---|
| `school.lifecycle.unwired` | info | Master switch off, or a hard-stop dependency missing — **entire console absent**, no routes mounted |
| `school.lifecycle.ready` | info | Successful boot — single-line summary of virtualDevices/media/receipts/economy/launchers. Check this first after any restart |
| `school.lifecycle.virtual-devices` | warn | `virtualDevices: true` — **all hardware is simulated.** If you see this in production logs, real printers/OMR/scanner are not in play, full stop |
| `school.lifecycle.no-receipt-renderer` / `.no-receipt-png-renderer` | warn | A rendering dependency failed to load — worksheets still print, receipts degrade |
| `school.lifecycle.self-service-off` | info | Self-service router not mounted (`selfService.enabled` not true) |

### Sessions / catalog

| Event | Level | Meaning |
|---|---|---|
| `school.sitting.write-failed` / `.read-failed` | warn | Mid-quiz resume snapshot failed — convenience only, never blocks the quiz |
| `school.bank.summarize-failed` | error | A question bank failed to summarize at boot — named and counted, never silently dropped |
| `school.attempts.shard-corrupt` | error | A day's evidence file failed to parse — that day drops from aggregates; other days unaffected |
| `school.agenda.plan-errors` | warn | A work is assigned but has no eligible published units — see `known-issues.md` for the current live instance of this |
| `school.curriculum.drafts-dropped` | warn | Draft-review-state units skipped — per [`failure-policy.md`](../../reference/school/failure-policy.md), this is deliberate, not a defect, but a *large* count every day means a course is stuck in draft |

## 7. Building a fresh trace when nothing here matches

1. Get the ranked event list for the window (§1's third query) — this alone
   usually shows which pipeline is noisy.
2. Pick the `learnerId` (or `testId`/`cardId`/`uid` if the learner isn't
   known yet) and pull everything for it, sorted by time.
3. Compare against the relevant §4 healthy sequence. The first missing step
   is where to read code, starting from the file the failing event's message
   names (School's event names are consistently `school.<area>.<event>`,
   which usually points straight at the source module).
4. If evidence exists on disk (attempts, allocation records, session files)
   but the logs are quiet, suspect the 7-day retention or the pre-2026-08-22
   timestamp shift (§2) before suspecting the code.
