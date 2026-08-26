# OMR (bubble-sheet reader → event bus)

How a physical bubble-sheet scan reaches the DaylightStation backend.

The reader is a **Chatsworth Data OMR-1100** desktop optical mark reader
(firmware `Version 1.04, Wed Oct 2 1996`) on RS-232. Unlike its relay siblings
this one carries no BLE and no proprietary transport — it speaks plain
asynchronous serial and decodes marks on-board. The whole difficulty was that
its serial contract is undocumented on the live web and one mandatory step is
invisible from the outside; both are captured below.

**Status (2026-07-21):** protocol solved and verified end-to-end on hardware;
cards decode correctly. See
[remaining work](../../_wip/plans/2026-07-21-omr-relay-bringup.md).

**Update (2026-07-29):** the extension was renamed `scantron-relay` → `omr-relay`
(bus topic `scantron` → `omr`, source `scantron-relay` → `omr-relay`, config
`scantrons.yml` → `omr-readers.yml`). **Backend dispatch is now written and
wired** (`createOmrRelay`, 20 tests). Host wiring is resolved and the household
config exists. What remains is physical: the loopback test, then flashing the
ATOM — and the standing card-sourcing blocker.

---

## End-to-end flow

```
Chatsworth OMR-1100   (RS-232C, 9600 7E1, marks decoded on-board)
     │  host must FIRST download a conversion mode, or output is silent
     │  record: 2 bytes/column, CR-terminated
     ▼
M5Stack ATOM Lite + ATOMIC RS232 base (MAX3232)     [_extensions/omr-relay]   NOT BUILT
     │  re-arms the mode every 60s while idle (self-heals reader power cycles)
     │  WS message: { source:'omr-relay', type:'sheet', id, columns, marks[] }
     ▼
WebSocketEventBus  (/ws)  .onClientMessage
     ▼
createOmrRelay()        [backend/src/3_applications/hardware/omrRelay.mjs]   ✅ WRITTEN
     ├─ broadcast('omr', payload)   → live subscribers
     │       ▼
     │  createQuizScanRecorder()  [backend/src/3_applications/quizzes/]
     │       └─ DECODE → household/apps/quizzes/<reader-id>/<YYYY-MM-DD>.yml
     └─ PERSIST → household/history/omr/<reader-id>/<YYYY-MM-DD>.yml
```

Every scan is double-processed: the relay's manifest keeps the raw 12-bit
masks byte-faithfully, and the quiz decoder writes the meaningful version —
records like `{ ts, testId, answers: { 1: A, 15: [A, E] } }`. Unanswered
questions are omitted; multi-marked questions keep every letter (grading
policy is downstream); an unreadable test-ID digit records as `?`. The
7-digit test ID is *not* a student number — the printed quiz carries it and
maps it to both the student and that quiz's answer key, so randomized or
per-student question orders still grade. `cli/school.mjs omr`
rebuilds all decoded day files from the manifest (idempotent). For School
print documents, that mapping is the allocation store: the test ID is the
card id, and the scan resolves/grades through the card's allocation records —
see [`docs/reference/school/print-documents.md`](../school/print-documents.md) §8.

### Quiz form layout (calibrated 2026-07-30 against a marked card)

32 columns; rows are given as mask bits (bit 0 = row 12 far edge … bit 11 =
row 9 strobe edge). Bits 11 and 5 are printed label rows and never carry data.

| Columns | Meaning | Encoding |
|---|---|---|
| 1–7 | test ID, one digit each | digit *d* = bit (9−*d*) |
| 8–32 upper bank | questions 1–25 | A…E = bits 10…6 |
| 8–32 lower bank | questions 26–50 | A…E = bits 4…0 |

Cross-check for re-calibration: the test-ID digit-0 bubble is on the same row
as the upper bank's **B**, and digit 6 shares the lower bank's **B** row.

The relay **broadcasts three message types and persists two**: `sheet` (a card)
and `reader-error` (a rejected command echo) are recorded; `raw` — undecodable
frames, and every frame while the firmware is in `SNIFF_MODE` — is broadcast for
live diagnostics but never written to disk, because sniff mode is a firehose.

Two behaviors worth knowing before reading a day file:

- **`columns` and `markedColumns` are re-derived from `marks[]`**, not taken from
  the wire. The firmware sends them for convenience and a truncated frame can
  leave them disagreeing with the array.
- **Identical sheets inside a 2 s window are treated as one card.** The OMR-1100
  has a documented `R` retransmit command and a stalled card gets re-fed by hand;
  both produce a byte-identical record that would otherwise grade as two
  submissions. Tunable via `persistence.dedupWindowMs`. Dedup is **per reader**,
  so two readers producing the same sheet at once both record.

During bring-up a Linux host with a USB-serial adapter stands in for the ATOM,
running the tools in `_extensions/omr-relay/tools/`. The adapter in use is
a **Keyspan USA-19HS**, which works on Linux (in-tree `keyspan` driver, two-stage
firmware upload) but **not on Apple silicon** — macOS enumerates the device and
creates no `/dev/cu.*`, because the pre-CDC vendor driver was never ported to
DriverKit. Capture on `{env.prod_host}`, not on the Mac.

---

## Serial protocol

### Link parameters

| Setting | Value |
|---|---|
| Baud | 9600 (power-up default; settable 300–38400) |
| Framing | **7 data bits, EVEN parity, 1 stop bit (7E1)** |
| Flow control | none, as shipped |
| Duplex | full |

> **8N1 produces total silence, not garbage.** This inverts the usual serial
> heuristic ("garbage = wrong baud, silence = wiring fault") and is the single
> most expensive trap in this device. See [Troubleshooting](#troubleshooting).

### Command framing

Two distinct framings share the line. Both are terminated the same way.

| Kind | Bytes | Use |
|---|---|---|
| Download | `0x12` `<cmd>` `0x12` `'E'` | conversion modes, masks, row enable |
| Factory | `0x12` `ESC` `<cmd>` `0x12` `'E'` | queries and configuration |

`0x12` is Ctrl-R. Note the download form has **no ESC** — the difference is easy
to miss and a wrong framing is simply rejected.

Responses: `G` + CR on success; the offending command echoed back followed by
`?` + CR on rejection.

### ⚠️ Conversion modes are volatile — this is the one that hides

A freshly powered OMR-1100 has **no conversion mode loaded**. In that state it
behaves like a perfectly healthy reader that has lost its output path: the lamp
fires, the transport pulls the card through, it reciprocates the card back out,
and every modem control line reads ready — while it emits **not one byte**,
because it is translating zero columns.

The host must download a mode before any scan produces output:

```
0x12 "I00" 0x12 "E"      → Binary-to-ASCII, all columns (up to 126)
```

Modes live in volatile memory and are lost on reader power-off. Any host must
re-send the download after a reader power cycle. The firmware re-arms every
60 seconds while the line is idle rather than tracking reader power state — the
command is idempotent and costs one `G` ack, and the manual requires that host
commands only be sent while the transport is stopped.

### Record format (mode `I00`)

Two bytes per column, whole record terminated by CR. Bit 5 (`0x20`) is forced
high in both bytes so every byte stays printable; a blank column reads
`0x20 0x20`.

| Byte | `0x01` | `0x02` | `0x04` | `0x08` | `0x10` | `0x40` |
|---|---|---|---|---|---|---|
| first  | row 12 | row 11 | row 0 | row 1 | row 2 | row 3 |
| second | row 4  | row 5  | row 6 | row 7 | row 8 | row 9 |

Rows are Hollerith-numbered `12, 11, 0, 1…9` running from the far edge of the
card toward the timing track, so **row 9 is the channel nearest the strobe
marks**. Twelve channels; up to 126 columns.

Other conversion modes exist (`H##` Hollerith-to-ASCII, one character per
column; `T`/`X` translate plus table; `S`/`L` split translate) and are documented
in the recovered manuals. Binary is the most general — it reports every mark
without imposing a form interpretation — so mark-to-meaning mapping belongs in
the backend.

### Command reference

Safe, read-only:

| Command | Returns |
|---|---|
| `GETCONFIG` | baud code, EEPROM flags, timing track, parity, threshold, decay |
| `GETTBLS` | threshold and decay |
| `S` | 8-bit status byte |
| `V` | firmware version string |

This unit answers `GETCONFIG` with `22 00 80 EVEINL80 1.5` — 9600 baud, flags
`00` (no flow control, no feed control, no reciprocate), bottom timing track,
even parity, inline alignment, 80% threshold, 1.5% decay. Factory defaults.

**Destructive — writes EEPROM, do not send casually:** `SETBAUD`, `SETFLAGS`,
`SETPARITY`, `SETTHRESH`, `SETDECAY`, `SETTMTYPE`, `SETTMCH`, `PROGRAM`,
`SETFACTORY`, and `CHECKSUM`/`RESET` which commit pending writes. A wrong
`SETBAUD` costs you the link until you find the new rate; `SETFLAGS` can enable
feed control, after which the transport refuses to move without host permission.

---

## Card specification

Geometry is not negotiable and is the second failure mode. From Appendix A of
the recovered technical manual:

| Property | Requirement |
|---|---|
| Width | **3.250 in ± 0.010** |
| Length | 5–14 in (3 in minimum to transport) |
| Thickness | 0.004–0.008 in |
| Paper | 20–40 lb bond, white, ≥75% reflectance, no fluorescent additives |
| Strobe marks | black (<10% reflectance), flush to one long edge, 0.125 in tall × ≥0.030 in wide, **0.250 in centers**, first mark ≥0.250 in from the leading edge |
| Data rows | 12 channels on 0.250 in centerlines, each directly above its strobe mark |
| Leading edge | first 0.125 in clear of print in all channels (media detect) |
| Background print | must be dropout — warm red for a Visible Red head |

### A Scantron-compatible form is not a Chatsworth form

This matters more than it sounds. A ScanRite 815-E quiz sheet — a legitimate
bubble sheet with a real printed timing track — transports through this reader
cleanly and reads as **nothing**, because Scantron's strobe geometry does not
put marks where this reader's timing sensor looks. "It's a scantron sheet" is
not evidence that a card is readable here.

The vendor's own spec sheet settles it numerically: the **815-E is 3⅜ in
(3.375) wide**, against this reader's required **3.250 ± 0.010**. It is an eighth
of an inch too wide, so the strobe track rides past the timing sensor's lane.
Any Scantron form in the 4.25 in family is further out still.

### Sourcing cards — SOLVED ✅ (ordered 2026-07-24)

> **Ordered 2026-07-22: one package of `3705` — 500 cards, $68.25.** Invoiced
> 2026-07-24, paid by check (their invoice adds 3% for credit-card payment, so
> deduct it when paying by check). The `LP`-prefix thread below was correct:
> Lincolnshire still stocks Chatsworth cards, so the "nothing fits, expect a
> custom run" conclusion recorded 2026-07-21 is **superseded**. The reasoning is
> kept because it found the right vendor; do not act on its conclusion.
>
> **Also in stock there:** `2093-5SD`, and `2093-6SD` (6 packages / 3000 cards on
> the shelf). Volume pricing, per pack of 500: 1–9 packs $68.25, 10–24 $49.75,
> 25+ $43.40.
>
> ### The lesson: a vendor's public page is not their inventory
>
> The 2026-07-21 audit checked Lincolnshire's live stock-forms page, found eleven
> forms, none 3¼ in, and concluded no card exists. **`3705`, `2093-5SD` and
> `2093-6SD` are none of those eleven** — they're kept in stock but were never on
> the public page. The conclusion was wrong not because the audit was sloppy but
> because the source was incomplete. A phone call found in one voicemail what a
> careful page-read could not.
>
> **`omrscan.com` is the live contact route**, which also resolves an old mystery:
> that domain was recorded here as "a dead vendor domain that now redirects to a
> print storefront." The storefront *is* Lincolnshire. The redirect was the answer,
> not a dead end.
>
> **They have MOVED** — shipping/receiving is now Wilmot, WI; corporate/mailing is
> Antioch, IL. Confirm current details with them rather than trusting the Illinois
> phone number below.

#### ⚠️ `SD` suffix vs. bare part numbers = the IR / Visible-Red split

This is the thing to get right before reordering. The archived 2006 catalog marks
`05SD` / `06SD` as *"use with pencil only OMR's (I.R.)"* — the `SD` cards are
printed for **infrared** heads, and their background ink would read as marks on a
Visible Red unit. Lincolnshire's in-stock list maps straight onto that split:

| Part | Printed for | Use if our head is |
|---|---|---|
| `3705` (ordered) | non-`SD` | **Visible Red** |
| `2093-5SD`, `2093-6SD` | `SD` → I.R. | **Infrared** |

**[Step 0b — which optical variant we have — is still unresolved](#step-0b), and
this is what hangs on it.** The happy case is that `3705` reads correctly, which
retroactively confirms a Visible Red head and closes Step 0b for free. If `3705`
transports but reads nothing while a pencil mark is clearly present, suspect an
IR head and the `SD` cards become the correct order — Lincolnshire has 3000 of
them on the shelf, so that recovery is a phone call, not another month.

Do **not** conclude "the reader is broken" from one card type failing to read.

> **Unknown until they arrive:** `3705`'s actual width and question count. The
> spec sheet came as an email attachment that isn't in the repo. Geometry is what
> killed the ScanRite 815-E, so measure before assuming — see *Verifying the cards
> on arrival* below.

#### Superseded 2026-07-21 finding (kept for the reasoning, not the conclusion)

**No off-the-shelf card currently sold anywhere fits this reader.** Verified
2026-07-21 against Lincolnshire Printing's live stock-forms page: every one of
their eleven stock forms is Scantron/NCS geometry, and none is 3¼ in wide.

| Their form | Size | Fits? |
|---|---|---|
| 3289 ES-15 (Scantron 815-E) | 3⅜ × 6 in | no — ⅛ in too wide |
| 2020 | 4.25 × 6 in | no |
| 3277 / 3278 / 3287 / 9702 | 4.25 × 11–12 in | no |
| 3276 | 4.5 × 11 in | no |
| 3538 | 5.5 × 11 in | no |
| 3411 / 3544 / 9700 | 8.5 × 11–12 in | no |

Their closest item, 3289 ES-15, is the same 3⅜ in form that already failed on
this reader. Buying it again will not work.

Chatsworth *did* sell 3¼ in stock cards, and the part numbers survive from the
2006 catalog — transcribed in
[`card-specification.md`](card-specification.md#historical-stock-cards):
`LP2745` (20 questions, 3¼ × 5¾), `H45070-0` and `B350060-2` (50 questions),
`H35070-0` and `B350010-2` (100 questions), `2093-6` (50-item). Avoid `05SD` and
`06SD`, which are marked *"use with pencil only OMR's (I.R.)"* — printed for
infrared readers, so their background ink would read as marks on this Visible
Red unit. **These are historical listings from a defunct product line; treat
them as an inquiry reference, not a catalog.**

The one promising thread: the `LP` in `LP2745` is Lincolnshire Printing's own
prefix, and the OMR-1102 datasheet credits them for card `2093-6`. They printed
the Chatsworth line originally, still supply Chatsworth readers, and their stock
page explicitly invites custom work — *"Even if you don't see your particular
card on the list, please contact us"* and *"we can modify any existing stock form
to accommodate your individual needs."* So the realistic ask is whether they
still hold the artwork or plates for the 3¼ in Chatsworth cards.

**Lincolnshire Printing & Promotions** — `omrscan.com` (the live contact route,
confirmed 2026-07-24), also `www.printlpp.com` (bare domain does not resolve —
the `www.` is required), historically `815-578-0740`. Shipping/receiving moved to
Wilmot, WI; corporate/mailing to Antioch, IL. There is no secondhand supply;
searching the archived part numbers returns only 1980s trade-magazine scans.

### Verifying the cards on arrival

Geometry is what killed the ScanRite 815-E, and a vendor saying "Chatsworth
cards" is not proof of fit. Check in this order, cheapest first:

1. **Width, with calipers: 3.250 in ±0.010.** The 815-E failed at 3⅜ in — ⅛ in
   over. This single measurement is the whole gate.
2. **Timing ticks** flush to one long edge, 0.125 in × ≥0.030 in on 0.250 in
   centers, first tick ≥0.250 in from the leading edge, leading 0.125 in blank.
3. **Background ink.** A Visible Red head needs warm-red dropout printing; a
   green or black background reads as marks. If these cards were printed for the
   Chatsworth line they should already be correct — but this also means the cards
   **double as the test for [Step 0b, the optical variant](#step-0b), which is
   still unresolved.** If a pencil mark reads and the printed background doesn't,
   the head/ink pairing is right and that question closes itself.
4. **Feed one blank card** before marking any. A blank card that transports and
   returns an all-`0x20 0x20` record proves transport, strobe timing and framing
   independently of any mark detection.

Until they arrive, `tools/gen-test-strip.py` remains the only card verified to
work on this reader.

Until a source is confirmed, `gen-test-strip.py` output is the only card known
to work, and a custom print run is the likely end state.

`_extensions/omr-relay/tools/gen-test-strip.py` generates a spec-exact
printable strip (`docs/omr1100-test-strip.pdf` in that extension) carrying a
walking-diagonal pattern whose decode is self-evident. Print at **100% / actual
size** — any "fit to page" scaling breaks the 0.250 in pitch — and cut on the
outline with a straightedge. That strip is also the starting geometry for
designing real household forms.

### Optical variant

This unit is **Visible Red** (steady red glow visible in the read slot), so it
reads #2 pencil *and* blue or black ballpoint or felt-tip. The tradeoff is that
background printing must be in the warm-red dropout range; green or black
background print will be read as marks.

---

## Bus message

```json
{
  "source": "omr-relay",
  "type": "sheet",
  "id": "<reader-id>",
  "columns": 39,
  "markedColumns": 37,
  "marks": [2048, 1024, 512]
}
```

`marks[]` carries one 12-bit mask per column in physical top-to-bottom order:
bit 0 = row 12 (far edge) … bit 11 = row 9 (strobe edge). The relay deliberately
does **not** translate columns into answers — that mapping is per-form, and
scoring is a backend concern because the reader is read-only (it cannot print,
imprint, or grade).

### Relay status (sent on every reconnect)

The relay announces itself whenever its socket comes up, before anything else:

```json
{
  "source": "omr-relay",
  "type": "relay-status",
  "id": "<reader-id>",
  "queued": 0,
  "dropped": 0,
  "truncated": 0,
  "uptimeMs": 8412,
  "boot_count": 47,
  "last_reset": "BROWNOUT"
}
```

`boot_count` and `last_reset` are the reader's **post-mortem of its previous
life** — added 2026-08-25 to make a suspected brownout confirmable. `last_reset`
is `esp_reset_reason()` captured as the first statement in `setup()`;
`boot_count` is a monotonic counter kept in NVS (flash), so it survives a true
power loss, which RTC memory would not. Both also appear on `/health`.

They ride this message and not only the HTTP server on purpose: when the reader
is faulting, its HTTP server is typically the first thing to stop answering, so
the report it pushes itself is the only one that still arrives. See
[Troubleshooting](#nfc-taps-register-but-sheets-will-not-feed) for how to read
them.

### NFC tap (optional, added 2026-07-29)

A reader may also carry an **M5 Unit NFC** (ST25R3916) on the ATOM's Grove port so
a student taps a card to start a session. Same relay, same bus link, same
`omr` topic:

```json
{
  "source": "omr-relay",
  "type": "nfc",
  "id": "<reader-id>",
  "uid": "04669C0FCB2A81",
  "piccType": "NTAG 215",
  "atqa": 68,
  "sak": 0
}
```

Broadcast as `event: 'nfc'` and persisted alongside sheets, deduped per UID within
`persistence.dedupWindowMs`. Resolving `uid` → student is **not** done here, for
the same reason scoring isn't: it is per-roster, and keeping it out lets one
reader serve several.

Enabled per reader via the `nfc:` / `buzzer:` blocks in `omr-readers.yml`; when
disabled the firmware compiles the path out entirely. Hardware detail, the
core-pinning rationale, and the buzzer's duty-vs-duration gotcha are in
[`_extensions/omr-relay/README.md`](../../../_extensions/omr-relay/README.md#nfc-tap-reader--tap-to-start).

---

## Tools

All in `_extensions/omr-relay/tools/`, runnable against any host with the
reader on a serial port.

| Tool | Purpose |
|---|---|
| `omr-query.py` | read-only interrogation; sweeps baud/framing until the reader answers |
| `omr-listen.py` | downloads mode `I00`, then streams every byte to disk |
| `omr-decode.py` | renders a capture as a 12-row mark grid |
| `gen-test-strip.py` | generates the spec-exact printable test card |
| `omr-sniff.py` | raw tail; predates the protocol work, retained for framing investigations |

Captures stream to disk as bytes arrive and are safe to interrupt at any moment.
Never buffer a capture in memory for a fixed window — an early version did, so a
run could not be inspected while in progress and interrupting it destroyed the
data.

---

## Troubleshooting

### "The reader transports cards but sends nothing"

Work in this order. The first two are cheap and the failure modes are silent.

1. **Is a conversion mode loaded?** Almost always the answer. A reader that has
   been power-cycled since the last download emits nothing. Send `I00` and look
   for the `G` ack.
2. **Is the framing 7E1?** 8N1 gives silence, so silence does *not* rule out a
   framing problem the way it would on most devices.
3. **Is the card actually to spec?** Check width against 3.250 in and confirm the
   strobe marks sit flush to the edge on 0.250 in centers. Test with a generated
   strip to take the card out of the equation entirely.
4. **Is the card oriented correctly?** Printed face toward the lamp, strobe edge
   toward the timing sensor, leading edge first.
5. **Only then suspect wiring.** Confirm with a control-line check: DSR and DCD
   are driven by the reader and drop when it is unplugged. CTS floats high with
   nothing attached and proves nothing.

### "NFC taps register but sheets will not feed"

This is the power signature, and it is worth recognising on sight because the
two halves of the reader fail apart. NFC reads draw almost nothing and keep
working; the sheet feed runs a **motor** and is the first thing a sagging supply
drops. If the device's own HTTP status server is also unreachable (`curl`
returning `000`), suspect a brownout — supply, cable, or connector — before
suspecting the serial link or the cards.

The backend flags the software-visible half of this automatically. A failing
reader **reconnects to the event bus repeatedly**, and because each individual
connection subscribes promptly and looks entirely healthy, nothing about a
single connection gives it away — the fault is only in the rate.
`omrReaderLiveness` therefore counts reconnections per reader and warns:

```
omr.reader_liveness.reconnect_burst  { id, ip, reconnects, windowMs, spanMs, lastReset, bootCount }
```

- **Threshold: 3 reconnections inside 600s.** Taken from the 2026-08-25 incident,
  not chosen for roundness. That day's failing clusters ran 3-4 reconnects in
  227s / 574s / 415s; the tightest three-reconnect span on the preceding healthy
  day was 1324s. 600s sits above the worst failing span and below half the
  tightest healthy one.
- **Restarts do not trip it.** The window is per-process and in-memory, so a
  redeploy begins with an empty history; a restart's own reconnect (observed at
  18-23s after `omr.relay.ready`) is one, never three, and a startup grace
  discards it regardless.
- **It is `warn`, deliberately.** `debug` is not shipped to the log store, so a
  debug line here would be invisible in production — which is precisely how this
  failure mode stayed hard to diagnose.

Detection only: nothing here repairs the reader, and a burst warning is a
prompt to go look at the power, not an error the backend can retry past.

#### Reading `lastReset` / `bootCount` — the burst says *what*, these say *why*

A burst alone is a symptom: the socket keeps dropping, cause unstated. The
firmware reports its own post-mortem on the `relay-status` message it sends at
every reconnect, and the warning carries it through:

| On the warning | Verdict |
|---|---|
| `lastReset: "BROWNOUT"` | **Confirmed power fault.** Supply, cable, connector — in that order. Not a hint; this is the board saying its voltage collapsed. |
| `bootCount` **climbing** across successive bursts | the board is genuinely rebooting. |
| `bootCount` **steady** through the whole burst | the board never rebooted. This is a **network** fault, not power — stop replacing bricks. |
| `lastReset: "PANIC"` | firmware crash, not power. Pull `/events` off the reader for what preceded it. |
| `lastReset: "POWERON"` | plug pulled, or someone power-cycled it. Ordinary after a household reset; suspicious if nobody was there. |
| both `null` | the reader is running firmware older than 2026-08-25. Reflash it before spending an afternoon guessing; the fields cost nothing and settle the question. |

Both are optional by design and default to `null` — an un-updated reader still
produces the burst warning, just without the diagnosis. Values are those of the
*preceding* connection, which is the right ones: a burst is recognised the
instant the third socket arrives, before its own hello, and a brownout that
killed connection N is reported by connection N+1, which has already landed.

### Diagnostics that mislead

- **`GETCONFIG` succeeding proves the link, not the data path.** Queries work
  fine on a reader that will never emit a scan, because they do not depend on a
  conversion mode.
- **Reciprocating feed is normal.** A card entering and popping back out the
  front is documented behavior, not a reject or a jam.
- **Modem control lines are weak evidence.** Drivers assert DTR/RTS on port open
  and cable hoods commonly loop DTR→DSR and RTS→CTS, so "all lines high" can be
  entirely self-inflicted. Compare attached vs unplugged before believing it.
- **`TIOCGICOUNT` is unsupported by the keyspan driver**, so kernel framing- and
  break-error counters are unavailable on that adapter; they cannot be used to
  distinguish "nothing sent" from "sent but unparseable".

---

## Recovered documentation

None of the vendor documentation is on the live web. Searches are swamped by the
unrelated Chatsworth Products rack company, and the vendor's old domain now
redirects to a print storefront.

Everything was recovered from the **Wayback Machine CDX index of the vendor's
dead domain** and is archived at `_extensions/omr-relay/docs/recovered/`:

| File | Contents |
|---|---|
| `OMR1100Manual.pdf` | operator guide — installation, checkout, serial parameters |
| `OMR1100commandsB.pdf` | factory command set, EEPROM flag definitions |
| `omr1102_techmanual.pdf` | 48 pp — download commands, **Appendix A card spec**, Hollerith and binary tables, factory defaults |

Everything operationally relevant is transcribed into
[`command-reference.md`](command-reference.md) and
[`card-specification.md`](card-specification.md); the PDFs are retained as
primary source for verification. Also recovered but **not** kept in-repo, since
their content is fully transcribed or irrelevant: the ACP-100 technical manual
and datasheets (sibling models), the OMR-1102 datasheet, the 2006 stock-card
catalog, the Scantron-compatible forms list, and the original DOS utilities
(`OMRCFG`, `OMRDETCT`, `OMRDISPLAY` — 16-bit binaries whose functions are all
reachable over the serial protocol, and which `omr-query.py` and `omr-decode.py`
already reproduce).

The technique generalizes: for any dead hardware vendor, query the Wayback CDX
API across the whole domain and grep the result for `.pdf`, `.exe`, and `.zip`
rather than relying on search engines.
