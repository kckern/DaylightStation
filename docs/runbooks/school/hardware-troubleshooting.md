# School — physical hardware troubleshooting

Symptom → diagnosis → fix for every device the physical console touches.
Config sources of truth (no IPs reproduced here — check the live file):

| Device | Config |
|---|---|
| Kitchen laser printer, Portal kiosk, barcode/NFC scanner, kitchen-relay board | `data/household/hardware/devices.yml` |
| Thermal printer(s) — named locations, timeouts, codepage | `data/system/config/adapters.yml` → `thermal_printers` |
| Which thermal printer School uses, teacher PINs, lifecycle switch | `data/household/school/school.yml` (**boot-cached** — restart after any edit) |
| OMR reader | `config/omr-readers.yml` — **does not exist in the live data tree**; see §3 |

## 1. Kitchen laser printer (Brother HL-L2460DW)

`backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs`. This
file's own header documents three real production incidents, each because
"the printer's capability list didn't mean what we assumed" — the lesson
generalizes to any future laser-printer defect on this device:

1. The printer advertises `application/octet-stream` support but has no PDF
   interpreter — a raw PDF prints as literal text until the tray empties.
2. Format negotiated correctly, but the *raster bit-depth* didn't match the
   printer's declared tokens, so jobs were silently dropped.
3. Everything else correct, print still rejected with IPP
   `0x0505 server-error-temporary-error` — **this firmware refuses the IPP
   `sides` attribute at any value, including its own advertised default.**
   There is no way to request single-sided for one job; sidedness comes from
   the printer's own `sides-default` applied to every job. See
   [`print-documents.md` → Duplex](../../reference/school/print-documents.md#4-rendering-varieties-keys-variants)
   for why this is an accepted comfort loss, not a defect to keep chasing.

**Diagnose:**

```bash
# Reachability only — no IPP, tells you nothing about print readiness
node -e "require('backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs')" # (see adapter's ping())
```

The adapter's `getStatus()` performs a real IPP Get-Printer-Attributes and
returns `{state, stateReasons[], accepting}` — `stateReasons` is whatever the
firmware itself reports (jam, media-empty, cover-open, toner-empty, etc.).
The self-service panel already translates the blocking subset of these into a
plain sentence for a child ("printer is jammed") via `ReadPrinterHealth` —
if a kid reports a cryptic printer message, that translation table
(`BLOCKING_REASONS` in `ReadPrinterHealth.mjs`) is the first place to check
whether the reason is even recognized.

**Symptom → cause:**

| Symptom | Likely cause | Fix |
|---|---|---|
| `PRINT_FORMAT_UNSUPPORTED` thrown | No compatible format in the printer's advertised list | Check `getStatus()`/capabilities; verify `negotiate.mjs` still matches this printer's IPP attributes |
| `PRINT_VALIDATE_FAILED` | Validate-Job refused even with every optional attribute stripped | The document/format itself is the problem, not an attribute — inspect the PDF |
| `PRINT_SEND_FAILED` | Real Print-Job rejected | Check printer reachability/IPP status code from the error |
| `PRINTER_STATUS_ERROR` / `PRINTER_HTTP_ERROR` | Can't reach the printer at all | Network/power — likely offline |
| A worksheet's card allocation is stranded (print failed mid-issue) | Fit rejection or a jam during issue | `node cli/school.mjs docs release-card <cardId>` frees it for retry — this is logged loudly, never silently orphaned |
| Duplex "isn't working" on a `quiz`/`infopage` document | Expected — only the `worksheet` archetype gets alternating gutters; sidedness is device-wide anyway (see above) | Not a defect — see the print-documents.md link above before spending time on it |

No automatic retry exists anywhere in this adapter — a failed job stays
failed until a person or the calling use case decides to retry.

## 2. Thermal receipt printer(s)

`backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs`
(ESC/POS over raw TCP, one named printer per location — `school.yml
lifecycle.receiptPrinter` selects which one School dispatches to).

**This printer refuses a second concurrent connection.** `getStatus()` opens
its *own* socket to query status; calling it while a print job holds the
connection is exactly what cascaded the 2026-08-25 incident (a stuck
zombie job left the socket busy, and the *next* job's connect attempt was
refused for ~11.5 seconds). Never script a status check in a loop while jobs
are actively printing.

**Diagnose:**

- `ping()` — opens/closes a raw socket **without writing bytes**. Never send
  arbitrary bytes to test connectivity; any unsolicited byte on this port
  gets spooled and physically printed as garbage.
- `getStatus()` — sends four `DLE EOT` queries, returns
  `{success, online, paperPresent, errors}`.

**Symptom → cause:**

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank paper cut and dispensed, but the caller/log said "refused" | A zombie job: the connect timeout fired and abandoned the job, but the eventual late connect still wrote init+footer+cut with no content (2026-08-25 RC-4, fixed — socket is now destroyed on timeout so a late connect can't resurrect a deleted scratch file) | If you see this on an OLD build, the fix is destroying the socket and setting an aborted flag the late callback checks — confirm the build includes it |
| Connects refused for several seconds, then several jobs complete at once | The printer's single connection slot was held by a stuck prior job | Check for a preceding `thermalPrinter.timeout`/zombie; don't assume the printer itself is broken |
| Accented characters print as garbage | Wrong codepage — this specific unit ignores `ESC t 16` (win1252); `cp858` is the configured default that actually renders correctly | Check `thermal_printers` defaults in `adapters.yml` |
| A receipt "definitely" printed but the console shows unprinted | `postjob` verification came back `faulted`, not `unverified` — only `faulted` is recorded as not-printed | Check the specific job's `thermalPrinter.postjob.*` log line |

## 3. OMR bubble-sheet reader (Chatsworth OMR-1100)

**Status: hardware not assembled in the field.** The protocol is fully
solved and verified end-to-end on a bench Linux host
(see [`docs/reference/omr/README.md`](../../reference/omr/README.md)), but
the actual field unit (M5Stack ATOM Lite + ATOMIC RS232 base) is not built,
and `config/omr-readers.yml` exists only inside an old rollback snapshot, not
in the live data tree. **Do not assume a household report of "the OMR
scanner is broken" means a live physical reader is malfunctioning** — first
confirm the reader has actually been deployed to that household before
troubleshooting hardware that may not exist yet.

Once a reader exists, work the troubleshooting ladder in this exact order —
the first two steps are cheap and their failure modes are silent:

1. **Conversion mode not loaded** (almost always the answer). A power-cycled
   reader emits nothing at all until the host re-downloads mode `I00` — this
   is volatile and lost every power-off. Re-send it and look for the `G` ack.
2. **Framing is 7E1, not 8N1.** 8N1 produces **total silence**, not garbage —
   this inverts the usual "garbage = wrong baud, silence = wiring fault"
   heuristic and is the single most expensive trap in this device.
3. **Card geometry.** Width must be 3.250 in ± 0.010 — a Scantron-family card
   (even one advertised as "Chatsworth-compatible") is commonly ⅛ in too
   wide and transports cleanly while reading nothing. Test with
   `_extensions/omr-relay/tools/gen-test-strip.py`'s output to remove the
   card as a variable entirely.
4. Card orientation (printed face toward the lamp, strobe edge toward the
   timing sensor).
5. **Wiring last.** DSR/DCD are reader-driven and drop when unplugged; CTS
   floats high with nothing attached and proves nothing on its own.

**"NFC taps register but sheets won't feed"** is a documented power-brownout
signature: NFC draws almost nothing and keeps working, while the sheet-feed
motor is the first thing a sagging supply drops. Confirm via the reader's own
HTTP status returning `000` (unreachable), then read `lastReset`/`bootCount`
off the next `omr.reader_liveness.reconnect_burst` warning — see
[`logs-and-tracing.md`](./logs-and-tracing.md#5-reading-the-omr-relays-own-health-signals)
for the full interpretation table. This is detection only; nothing repairs
the reader automatically.

**Diagnostics that mislead** (from the OMR reference doc, worth repeating
here because they cost real time in the field):

- `GETCONFIG` succeeding proves the serial *link*, not the data path — it
  works fine on a reader that will never emit a scan.
- A card reciprocating (entering and popping back out) is documented normal
  behavior, not a jam.
- Modem control lines are weak evidence — drivers assert DTR/RTS on port
  open, and cable hoods commonly loop them back to themselves.

## 4. Barcode / NFC card scanner (Zebra DS2278 + kitchen-relay board)

The scanner pairs over BLE HID to the kitchen-relay ESP32 board (the same
board that runs the kitchen food scale). Routing happens **at the parser
level**: any code beginning `sch:` always claims School routing
(`scanDispatch.mjs`), regardless of which physical scanner produced it.

**The scanner triple-beeps waiting for an ACK that never arrives** if SNAPI
Status Handshaking is left enabled — this is an audible symptom fixable *on
the scanner itself* (disable SNAPI handshaking), not in code.

**The single most misleading failure mode in the whole console:** if
`school.yml lifecycle.enabled` is not exactly `true`, a scan produces
**literally nothing observable in the room** — no exception, no print, no
sound, no log-visible error at the scan site. `scanDispatch` gets back
`{status:'unwired', ok:false}` and stops. This is indistinguishable from a
dead scanner unless you check `school.yml` or look for
`school.lifecycle.unwired` in the boot log. **Always check the lifecycle
switch before troubleshooting scanner hardware.**

**An unrecognized or expired card is NOT silent** (this is a different case
from the lifecycle-disabled one above) — `ResolveScanAction` turns an unknown
or expired token into a printed thermal receipt slip carrying a plain-
language message ("We do not know that ticket. Scan your card for a new
list."), *provided the thermal printer itself is reachable*. If a card
produces nothing at all, suspect the lifecycle switch or the thermal printer
before suspecting the card/scanner.

**Housekeeping for stuck or misidentified cards:**

```bash
node cli/school.mjs docs list-cards [--status <s>] [--older-than <Nd>]
node cli/school.mjs docs release-card <cardId> [--rows a-b]
node cli/school.mjs docs audit                 # integrity check, exit 1 on any real defect
```

## 5. Portal touchscreen kiosk

The Portal is a repurposed Facebook Portal panel running FullyKiosk, exactly
like the Piano Kiosk in spirit — the generic FKB debugging checklist in the
root `CLAUDE.md` ("Shield TV / FKB Operations") applies here too: is FKB
running, is its REST API reachable, are motion/acoustic background services
disabled, is anything else holding a resource FKB needs.

Two configuration facts worth knowing before chasing a phantom defect:

- **The physical Bluetooth parental-presence gate is currently disarmed** in
  the live household config (`school.yml`'s `gate:` block is commented out).
  There is no active headset/keyboard-presence enforcement today — don't
  spend time pairing or troubleshooting Bluetooth for this feature until it's
  re-enabled.
- **Self-service keypad codes need two independent switches**, both set:
  `school.yml selfService.enabled: true` *and* the mounted screen's own
  `mode: locked` (`data/household/screens/portal.yml`). Either alone changes
  nothing observable.

**Media/video units print "there is nowhere to play this" by design** — the
`playbackAdapter` is not wired to any real device for School (see
[`school-physical-console-deploy.md`](../school-physical-console-deploy.md)
§4). This is an accepted, visible gap, not a defect to diagnose. Worksheet,
OMR, and quiz units are unaffected.
