# School morning scan-and-print incident — 2026-08-25

**Status:** diagnosed; fixes not yet applied
**Window:** 2026-08-25 08:12–08:26 PDT (plus overnight background noise)
**Surfaces:** `frontend/src/modules/School/`, `backend/src/2_domains/school/`,
`backend/src/3_applications/school/`, `backend/src/1_adapters/hardware/thermal-printer/`
**Evidence:** `logs.kckern.net` (UTC window `2026-08-25T15:00:00Z`–`15:30:00Z`),
token registry and session records in the data volume, teacher dashboard `/school/teacher`

**Revision 2** — after an independent adversarial review. That review closed two
open items, overturned one root cause (RC-5), retracted one rule-out (O-1), and found
two defects the first pass missed. Corrections are marked **[rev2]** and the superseded
claims are kept visible rather than quietly deleted.

Learners are referred to as **M\*\*\***, **F\*\*\*\***, **S\*\*\*\***, **A\*\*\***.
Live panel access codes are redacted — some remain valid until 2026-08-26 11:00Z.

---

## 1. What the family experienced

One learner (M\*\*\*) tapped a personal card on the `study-omr` reader. The reader
fired **five NFC reads in 103 milliseconds** — one physical tap, five messages. The
system treated each as a separate scan and produced **five paper outputs: three good
agenda receipts and two blank, auto-cut strips** — plus **four duplicate sessions**, all
"North Dakota", all ungraded, and **five different panel access codes**, only some of
which reached paper. *[rev2: previously mis-stated as "four receipts, two of them blank".]*

A second learner (F\*\*\*\*) then tapped and got a correct receipt, but their three
follow-up taps were suppressed with "Already printed". Five panel codes typed during
the same minutes were rejected.

The duplicate sessions are on the teacher dashboard now — four identical
"North Dakota / United States Regions and States / Midwest" cards for M\*\*\*, three
reading *"No issued worksheet or result receipt is linked to this session."*

**Blast radius is data, not just paper.** Wasted roll is the cosmetic part; the
gradebook holds three phantom lessons.

---

## 2. Confirmed root causes

### RC-1 — NFC taps are deduped on the wrong path (primary trigger)

`backend/src/3_applications/hardware/omrRelay.mjs`

The relay has exactly the dedup this incident needed — a 2000 ms per-UID window — and
its own comment states the purpose:

> *"Deduped per UID on the same window sheets use — a fumbled card can leave and
> re-enter the field within a moment, and a double tap must not start two sessions
> **or print two tests**."* — `omrRelay.mjs:227-230`

But that dedup lives in `onPayload` (the **persist** path, `omrRelay.mjs:231-238`),
which runs *after* the unconditional `eventBus.broadcast` at `omrRelay.mjs:173-182`.
Everything that acts on a tap — including printing — subscribes to the **broadcast**.
The guard protects the day-log and nothing else.

The broadcast path is unguarded because of an assumption that is false in practice:

> *"The relay already debounces in hardware (it HLTAs the card, so one physical tap
> produces exactly one message), so anything arriving here is a real tap."*
> — `omrRelay.mjs:162-163`

Five `omr.ingest.nfc` events for uid `04DB930CCB2A81` at 15:12:28.958, .971, .979,
15:12:29.001 and .061 disprove it.

### RC-2 — The agenda cooldown is not concurrency-safe

`backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs:126-150`

`execute()` is check-then-act with two `await`s between the check and the arm:

```
buildAgenda.execute(...)      // ← mints a token + access code
#checkCooldown(...)           // ← reads cooldown store
receipts.print(...)           // ← seconds of I/O
#armCooldown(...)             // ← writes cooldown store
```

`backend/src/5_composition/modules/nfcTapIngress.mjs:138` dispatches each tap with
`Promise.resolve(handleTap(...))` and never awaits, so all five ran **concurrently**.
Every one passed the cooldown gate before any armed it.

This is why the 15-minute cooldown that correctly suppressed F\*\*\*\*'s *sequential*
taps at 08:15:16, 08:17:22 and 08:18:53 did nothing for M\*\*\*'s *concurrent* ones.
**The cooldown only works against slow humans, not a bouncing reader.**

Registry proof — five records for the same learner+subject, 101 ms apart, five distinct
codes (redacted):

| Token file | `issuedAt` |
|---|---|
| `TEGSZ2LXZFBPD8EJ` | 15:12:28.961Z |
| `U4BTWVTAR6J5JCLJ` | 15:12:28.973Z |
| `C48LKG3WVA7CLDE5` | 15:12:28.981Z |
| `XJLVPV2HBWPP4CWW` | 15:12:29.002Z |
| `HRNFQ2AF7DLD4P6T` | 15:12:29.062Z |

**[rev2] There is a second concurrency entry point.** `ResolveScanAction.mjs:68-83`
also holds `resolvePersonalCard`, so the QR/barcode scan path can race an NFC tap for the
same learner **even with a perfect relay dedup**. This is the concrete proof that RC-1
alone is insufficient. (No third entry point found.)

### RC-3 — Duplicate ghost sessions (consequence of RC-1 + RC-2)

`BuildAgenda.execute` opens a session when none is open (`BuildAgenda.mjs:286`). Five
concurrent builds each saw "no open session" and created one. Four session records exist
under `<household>/school/records/sessions/2026-08/` — `ses_AWo4wMn6`, `ses_eveClAKh`,
`ses_jB8pbjSu`, `ses_kGFmpOVh` — same learner, same unit.

Cleanup goes to `data/_deleteme/`, never `rm`.

### RC-4 — A timed-out print job is abandoned but never aborted

`backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs:651-660`

**This is the entire blank-paper story.** The 5000 ms guard is **connect-only** —
`clearTimeout(timeoutId)` is the first statement inside the `device.open` callback. When
it fires it does three things:

```js
this.#needsResync = true;
this.#logger.error?.('thermalPrinter.timeout', { timeout: config.timeout });
resolve(false);
```

It does **not** destroy the socket, cancel the pending connect, or mark the job dead.
`escpos-network`'s `open()` is a bare `net.Socket.connect` with no library-side connect
timeout, so the callback fires whenever TCP eventually completes. Then:

1. `resolve(false)` → `print()`'s queue (lines 322-336) advances to the next job.
2. `ReceiptPrinting.print()` sees `ok === false`, logs `school.receipt.refused`, and its
   `finally` calls `job.cleanup()` — **deleting the scratch PNG**
   (`ReceiptPrinting.mjs:66` → `DocumentReceiptRasterRenderer.mjs:152`).
3. Seconds later the abandoned callback fires. `clearTimeout` is a no-op. It builds the
   job, calls `#processImageItem`, `fileExists()` is now false →
   `thermalPrinter.image.notFound` (`ThermalPrinterAdapter.mjs:873`), returns empty.
4. It still writes init + footer + **auto-cut**, logs a phantom `job.complete`, and
   `resolve(true)` into a promise nobody is listening to.

**Net effect: blank paper, cut and dispensed, while the caller was told "refused".**

Timing arithmetic, verified twice against raw logs:

| Job start | Timeout fired | Late `image.notFound` | `job.complete` duration | Implied start | Bytes |
|---|---|---|---|---|---|
| 15:12:31.764 | 15:12:36.765 (5.001 s) | 15:12:43.212 | 11970 ms | 15:12:31.764 ✅ | 20 |
| 15:12:37.267 | 15:12:42.269 (5.002 s) | 15:12:43.211 | 6466 ms | 15:12:37.267 ✅ | 532 |

`bytes: 20` is init + code page + upside-down + footer + cut, no raster. `bytes: 532` is
the same plus the 512-byte resync pad — `resync.prepended` fired once (15:12:43.210)
because `#needsResync` is consumed by the first reader.

**[rev2] Alternative explanations actively refuted**, not merely unconsidered:
- *Two jobs sharing one temp path?* No — the paths are distinct per-job UUIDs
  (`…91bd55cb…` vs `…33063204…`).
- *Renderer never wrote the file?* No — both jobs logged `job.transcript` at start, which
  only happens after a successful render.
- Nothing else produces a `job.complete` whose implied start equals an already-refused
  job's start, twice, with byte counts that are exactly headers+footer+cut.

### RC-5 — Connect timeout is too short *(heavily revised — original causal story was wrong)*

**[rev2] Retracted:** the first revision blamed commit `a89bf7bd8` ("fix(thermal): wait
for flush, and make raster conversion linear") and claimed a "direct conflict" between the
15 s drain cap and the 5 s connect timeout. **Both claims are wrong:**

1. **The two timers cannot race.** `print()` serializes every job through one promise
   chain, so our own next job never attempts to connect while a drain holds the socket.
   The only overlapping connects in this incident were RC-4's zombies. Two timers that
   never race in normal operation are not "in conflict".
2. **"The printer stays busy after our socket closes" is contradicted by the timeline.**
   Jobs 4→5 and 5→6 closed identically (same `socket.destroy()`, same ~38 KB) and the next
   connect succeeded ~500 ms later with no timeout. The lockout happened **exactly once**:
   connects refused from ~31.8 s to 43.21 s (~11.5 s), then all three pending connects
   completed within 1 ms of each other — a one-off release event, not a per-job busy
   period. A 37.9 KB raster prints in ~1–2 s (the commit's own figure: 360 KB ≈ 11 s),
   which cannot explain 12 s.
3. **`a89bf7bd8` is not implicated.** The 5 s connect timeout
   (`ThermalPrinterAdapter.mjs:136`) and the destroy-style close both **predate** it. The
   old code destroyed the socket on a fixed 1000 ms timer, which would have produced the
   same connect-wedge *plus* truncated receipts. That commit made things strictly better;
   the first revision scapegoated a good commit.
4. **Correction:** "three abandoned connects outstanding" was wrong — **two** were
   abandoned (jobs 2 and 3); the third was job 4's legitimate connect.

**What remains true:** a 5 s connect timeout is too tight for this printer, which
demonstrably went unreachable for ~11.5 s. **The root cause of that single lockout is not
established** — printer session-teardown holdoff after job 1's abrupt destroy, an lwIP
backlog quirk, or a network blip are all candidates. Nobody has proven which.

**Revised fix:** raise the connect timeout to a **flat 15–20 s**. Do *not* derive it from
job size — the observed lockout is independent of job size.

---

## 3. Open items

### O-2 — **CLOSED [rev2]**: the CFM units are all `reviewState: draft`

The `come-follow-me-ot-2026` warning (141× today) is not a loader bug, a manifest
problem, or a schema mismatch — the first revision ruled all of those out correctly and
then missed the one field that matters.

`CurriculumAccess.mjs:108` gates every unit through `isPublishable`:

```js
if (isPublishable(result.unit)) validUnits.set(id, result.unit);
```

and `unitValidation.mjs:414-416`:

```js
export function isPublishable(unit) {
  return isPlainObject(unit) && unit.provenance?.reviewState === 'approved';
}
```

**All 86 `reviewState` values across the course are `draft`** (verified by grep over the
whole content tree). The units load fine and validate fine — production's own
`invalid-units` event (count 128) contains **zero** CFM errors, all 128 are language-reels.
They are simply dropped at the promotion gate, **silently and by design** ("a draft is not
an error"), which is exactly why nothing ever explained the empty member list.

**Fix:** approve the units, or unassign the course if drafting is deliberate. Worth adding
a planner-side hint distinguishing "no units exist" from "all units are drafts" — the
silence here cost a full investigation.

**2026-08-25 — Resolved (Task 4).** User decision: **option (a), approve all units**
(not the narrower "near-term weeks only" option, despite `HANDOFF.md`'s note that
Days 2–5 of week 37+ were deliberately left draft — the user judged the content
reviewed and wanted the whole course live).

The actual count flipped was **85**, not 86 — the pre-change grep's 86th match was
`reviewState: draft` inside `_authoring-harness.mjs` (a JS authoring script) and
`HANDOFF.md` (prose), neither of which is a unit YAML; both were correctly left
untouched. All 85 real lesson YAMLs under
`data/content/school/scripture/come-follow-me-ot-2026/` were flipped
`provenance.reviewState: draft -> approved` via a targeted line-wise `perl` replace
(no YAML round-trip), verified byte-for-byte identical apart from the `reviewState`
line, then the container was redeployed (`docker stop/rm` + `deploy-daylight`; plain
`docker restart` is not in the NOPASSWD sudoers on this host) to clear the in-memory
config/content cache.

**Verified fixed:** `GET /api/v1/school/lifecycle/learners/milo/completion` now
returns `"state":"complete"`, `"faults":[]` — the `plan_error` fault that blocked
Milo's piano-games unlock is gone. `felix` similarly shows `"faults":[]`.

**Verified improved, not fully clean:** `school.agenda.plan-errors` dropped from
~41/hr (9 non-preview + 32 preview) to ~16/hr, but **0 non-preview + 4 preview**
in the last 15 minutes post-restart. All remaining rows carry `context.preview:
"true"` — they come from the **teacher planning-preview** BuildAgenda instance
(`schoolLifecycle.mjs:588-610`, `logger.child({ preview: true })`), not the real
learner agenda path: since the `2026-08-25T17:14:10Z` container start, 0 non-preview
`plan-errors` have been logged (only `context.preview:"true"` rows remain). (A
non-preview row at `16:37:25Z` belongs to the *previous* container, ~37 minutes before
this restart, and is not evidence against the fix.) That preview instance is passed the same
`curriculum` object as the real one (`schoolLifecycle.mjs:590` vs `:547`) yet still
reports "assigned but no published units belong to it" — differs from the real path
in `previewSessions`, `previewOnly: true`, and `curriculumExceptions:
curriculumExceptionStore`; root cause not chased, flagging for a follow-up.

**Also observed:** on both learners, scripture now shows
`"excused":[{"subject":"scripture","reason":"blocked_no_offer"}]` — approving the
units cleared the `plan_error` fault but the course still doesn't offer a lesson.
This is a second, distinct gap (not addressed by O-2) worth its own investigation.

### O-1 — the "not expiry" rule-out is **RETRACTED [rev2]**

The first revision inspected only the **nine tokens written today** and concluded expiry
was impossible. That scoping was wrong. The registry also holds older tokens:

| `accessCodeExpiresAt` | Count |
|---|---|
| `2026-08-23T11:00:00.000Z` | 2 |
| `2026-08-24T11:00:00.000Z` | 12 |
| **`2026-08-25T11:00:00.000Z`** | **7** |
| `2026-08-26T11:00:00.000Z` | 9 (today's) |

**Seven codes expired at 11:00Z today — 04:00 local, four hours before the panel was
used** — and they were printed on yesterday's receipts, which were still in the room.
Typing any of them yields exactly `no-live-record`.

Circumstantially: M\*\*\*'s typed code **resolved successfully** at 15:13:56, and
F\*\*\*\*'s printed code was verified live. So ordinary expiry — children typing yesterday's
codes — is now the most probable explanation, not a registry defect.

Still not *proven*: the digits are deliberately never logged
(`ResolveAccessCode.mjs:189-193`), and the frontend logs carry none either. The proposed
fix stands but drops in priority: log a **salted, non-reversible fingerprint** (length +
short hash, never the digits) so mistype, expiry and registry-miss become distinguishable.

---

## 4. Lower-severity findings

### L-1 — Worksheet thumbnails 500 (the dashboard's "Preview not available")

```
_time 2026-08-25T04:06:20.898Z  error  school.router.error
  { error: "DOMMatrix is not defined", path: "/teacher/sessions/…/worksheet.thumbnail.png" }
```

`DOMMatrix` is a browser global that PDF rasterisation expects; absent in this Node
runtime. **[rev2]** That timestamp is UTC = **21:06 PDT on 08-24**, i.e. last night, not
this morning — the first revision listed it alongside local times without converting.

### L-2 — Three controls, one URL (`IssuedArtifactCard.jsx:27, 38, 39`)

```jsx
<a className="…__preview" href={url} target="_blank" …>            // 27 — the thumbnail
<a href={url} target="_blank" rel="noreferrer">Open worksheet</a>  // 38
<a href={url} download>Download PDF</a>                            // 39
```

All three resolve to the same `url`. **[rev2] The mechanical explanation is corrected:**
the first revision said the `download` attribute is ignored because the URL is
cross-origin. It is **same-origin** (teacher API), where `download` generally does work.
The UX duplication is real and worth fixing; the "attribute is ignored" reasoning was
wrong.

### L-3 — Portal cannot blank its own screen

`school.selfservice.screen-off.failed { reason: 'fkb_unavailable' }` ×3 (00:09, 00:20,
08:36 local). The portal tablet's FullyKiosk REST endpoint is not answering.

### L-4 — **CLOSED [rev2]**: S\*\*\*\* has no assignment plan at all

08:18:18 — `school.card.agenda-printed { created: 0, offers: 0 }`, a card with nothing on
it. `<household>/school/plans/learners/` contains **only `felix.yml` and `milo.yml`**.
S\*\*\*\* and A\*\*\* have no plan file, so there is nothing to build an agenda from. Not
an O-2 symptom; a missing-data problem. S\*\*\*\*'s blank card also carries no code.

### L-5 — **NEW [rev2]**: suppressed taps still mint tokens

Each of F\*\*\*\*'s three "suppressed" taps minted a **live** token before suppression:
`6XYUPC255EQS85ET` (15:15:15.552), `UFU2Z8K47SJ87QJY` (15:17:21.917),
`HNWTNW2HUPGMWA3U` (15:18:53.903) — every `issuedAt` precedes its suppression log.

The cooldown check runs *after* `buildAgenda.execute` by necessity: the content fingerprint
needs the built agenda. So suppression stops paper but **not** token and registry side
effects, quietly inflating the live-code pool.

**Any RC-2 fix that merely "arms the cooldown earlier" will not fix this.** It needs a
cheaper pre-build gate, or revocation of the token when a tap is suppressed.

### L-6 — Warn-level noise drowning the signal

~241 warns in 8 hours from two every-5-minute emitters (`school.agenda.plan-errors` ×141,
`school.language-reels.daily-none-approved` ×100), all tracking a small number of static
data problems. This actively hindered the investigation. Should collapse to one event per
state change, not one per poll. Fixing O-2 removes the larger half.

---

## 5. Recommended fix order *(revised [rev2])*

| # | Fix | Why here |
|---|---|---|
| 1 | **RC-1** — dedupe the broadcast path in `omrRelay`, reusing the existing `dedupWindowMs` | Smallest change; kills today's trigger |
| 2 | **RC-4** — destroy the socket and set an `aborted` flag the late callback checks | The entire blank-paper story; independent of RC-1 |
| 3 | **O-2** — approve the 85 CFM units (or unassign the course) | **Promoted:** a data fix needing no instrumentation. Ends 141 warns/day and restores the scripture course |
| 4 | **RC-3** — move the three phantom sessions to `data/_deleteme/` | Teacher board is wrong right now |
| 5 | **L-4** — create the two missing learner plans | Two learners currently get blank cards |
| 6 | **RC-2 + L-5** — atomic cooldown *and* stop suppressed taps minting tokens | Defence in depth; `ResolveScanAction` proves RC-1 alone is not enough |
| 7 | **RC-5** — flat connect-timeout raise to ≥15 s | Not size-derived; not attributed to `a89bf7bd8` |
| 8 | **L-2**, **L-1** | User-visible, cheap |
| 9 | **O-1** — fingerprint logging | Demoted: expiry is now the probable cause |

**Sequencing notes.**
RC-1 and RC-2 are *both* required — `ResolveScanAction.mjs:68-83` is a live second entry
point into the same race, so fixing only the relay would make this look solved while
leaving the defect in place.
**Do not fix RC-5 by raising the timeout alone** — without RC-4, a longer timeout only
widens the window in which abandoned sockets accumulate.

---

## 6. Verification plan

Nothing here is fixed yet; these are the checks each fix must pass.

- **RC-1:** five `nfc` broadcasts, same UID, inside the dedup window ⇒
  `resolvePersonalCard.execute` called **once**. Live: one tap ⇒ one
  `nfc.tap.school_card`.
- **RC-2:** a test that drives `execute()` **concurrently** — a sequential test passes
  today and proves nothing ⇒ exactly one `agenda-printed`, the rest `agenda_suppressed`.
  Cover the `ResolveScanAction` path too.
- **L-5:** a suppressed tap mints **no** new live token.
- **RC-4:** using the injectable transport (`options.createTransport`, added by
  `a89bf7bd8`), simulate a connect that resolves *after* the timeout ⇒ no bytes written,
  no `job.complete`. **Use the injectable transport** — the commit message records that
  module-mocking `escpos-network` opens a real socket and wastes paper.
- **RC-5:** queue three ~37 KB jobs back-to-back against the real printer ⇒ three complete
  receipts, zero `thermalPrinter.timeout`.
- **O-2:** after approval, `plan-errors` stops and the course offers lessons. **Partial**
  (2026-08-25): the `plan_error` fault is gone and completion state is correct, but
  preview-path `plan-errors` persist and scripture still doesn't offer a lesson
  (`blocked_no_offer`) — see the O-2 resolution note above.
- **RC-3:** teacher board shows one session for that lesson.
- **L-2:** one link per distinct destination.

---

## 7. Reference — verified event timeline (local PDT)

| Time | Event |
|---|---|
| 08:12:26.787 | `screen-off.armed` (manual) from the Portal tablet |
| 08:12:28.958–29.061 | **5×** `omr.ingest.nfc`, uid `04DB930CCB2A81` (M\*\*\*) — one tap |
| 08:12:28.961–29.062 | **5×** token minted, same learner+subject, 5 distinct codes |
| 08:12:29.842 | thermal job 1 start |
| 08:12:31.262 | job 1 complete (37,921 B, drain 1260 ms) — **good receipt** |
| 08:12:31.266 | `agenda-printed { created: 1 }` |
| 08:12:31.764 | job 2 start — connect never completes in time |
| 08:12:36.765 | **`thermalPrinter.timeout`** → `receipt.refused` → PNG deleted |
| 08:12:37.267 | job 3 start |
| 08:12:37.390 | `omr.ingest.nfc`, uid `048BA600CC2A81` (F\*\*\*\*) — single clean tap |
| 08:12:42.269 | **`thermalPrinter.timeout`** → `receipt.refused` → PNG deleted |
| 08:12:42.770 | job 4 start |
| 08:12:43.210 | `resync.prepended` (512 B) |
| 08:12:43.211/.212 | **2× `image.notFound`** — jobs 2 and 3 resurrected against deleted files |
| 08:12:43.733/.734 | 2× phantom `job.complete` (532 B, 20 B) — **blank paper, cut** |
| 08:12:44.483 | job 4 complete — good receipt, `created: 1` (2nd duplicate session) |
| 08:12:46.265 | `agenda-printed { created: 0 }` |
| 08:12:48.410 | F\*\*\*\*'s receipt prints correctly, carries a live panel code |
| 08:13:56–08:14:07 | Panel code resolved → laser worksheet issued → `print.confirmed` ✅ |
| 08:15:16 / 08:17:22 / 08:18:53 | F\*\*\*\* `agenda-suppressed` — each still minted a token (L-5) |
| 08:16:48 · 08:17:04 · 08:17:53 · 08:19:09 · 08:26:00 | **5× `code.rejected: no-live-record`** (O-1) |
| 08:18:18 | S\*\*\*\* `agenda-printed { created: 0, offers: 0 }` — no plan file (L-4) |
| 08:36:11 | `screen-off.failed: fkb_unavailable` (L-3) |

**Log-store clock note:** `_time` is genuine UTC (verified 2026-08-25 — the newest row
matched `date -u`). It previously stored local PDT with a `Z` suffix. Subtract 7 h from
UTC for the local times above, and re-verify the convention before trusting any window.
