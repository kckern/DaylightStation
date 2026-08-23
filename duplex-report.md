# Laser printer duplex honesty — report

## What changed

`backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs`:

1. **New private method `#getSidesCapability()`** — a dedicated read of the
   printer's own `sides-default` / `sides-supported`, obtained via
   `#fetchAttributes()` (the exact same `GET_PRINTER_ATTRIBUTES` round trip
   `getStatus()` and `#getCapabilities()` already use — no new HTTP code was
   written). It's a deliberately *separate* round trip from the one
   `#getCapabilities()` makes for format negotiation, made only when a caller
   actually asks for `duplex: true`, so a failure here is isolated from the
   negotiation path the print itself depends on.

2. **`printPdf` now branches on the printer's real duplex state** when
   `duplex === true` (moved this whole block to after the buffer/PDF-header
   validation, before it now ran ahead of even a basic sanity check):
   - `sides-default` is `two-sided-long-edge` or `two-sided-short-edge` →
     logs `laser-printer.duplex-via-printer-default` at info, with
     `{ host, jobName, sidesDefault }`. The old `...not-applied` event is
     **not** emitted in this branch — the request genuinely was satisfied,
     just by the printer's own default rather than a job attribute.
   - `sides-default` is `one-sided` (or missing) → still logs
     `laser-printer.duplex-requested-not-applied` (same event name as
     before, so existing log queries/dashboards keep matching), now carrying
     `sidesDefault`, `sidesSupported`, and a `reason` that names the actual
     remedy: change the printer's own `sides-default` at its web UI/front
     panel, because this firmware rejects the IPP `sides` attribute at any
     value.
   - the `#getSidesCapability()` call throws for any reason → caught right
     at the call site in `printPdf`, never propagated. Logs
     `laser-printer.sides-default-lookup-failed` at warn, then degrades to
     the same `duplex-requested-not-applied` event with `sidesDefault: null`
     and a reason noting the lookup failed. **The print proceeds exactly as
     it would have before this fix** — negotiation, Validate-Job, and
     Print-Job are all unaffected by a failed duplex-honesty read.
   - `duplex` is not `true` (`false`/`undefined`) → none of the above runs at
     all; no extra `GET_PRINTER_ATTRIBUTES` round trip, no new log line.

3. **The big header comment above `printPdf`** was extended (not shortened)
   with the new evidence and remedy: the exact Validate-Job bisection
   results from today (no `sides` attribute → `0x0`, `sides=one-sided` →
   `0x505`, `sides=two-sided-long-edge` → `0x505`), the printer's measured
   `sides-default`/`sides-supported`, and the explanation that the actual
   fix for the original one-sided-worksheet bug is a printer-side setting
   change, not new IPP job attributes — the adapter's job is now just to
   report that state truthfully.

4. **`negotiate.mjs` is untouched.** `JOB_ATTRIBUTE_TRIM_ORDER` still puts
   `sides` first and `chooseJobAttributes` still never sends a `sides` job
   attribute the printer would accept — this fix does not attempt to
   resurrect that path, per the task's explicit constraint.

## How `sides-default` is obtained

Via the existing IPP plumbing: `OPS.GET_PRINTER_ATTRIBUTES` request through
`#ipp()` → `decodeResponse(buf)` → the returned object's `.attrs` map (NOT
`.attributes`) has `attrs['sides-default']` and `attrs['sides-supported']` as
arrays of keyword strings, same shape as every other capability attribute
this adapter already reads (`document-format-supported`, etc.).
`#getSidesCapability()` extracts `sidesDefault = attrs['sides-default']?.[0] ?? null`
and `sidesSupported = attrs['sides-supported'] ?? []`.

## Tests

Extended the existing vitest suite at
`tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs` (no colocated
node:test file existed for this adapter, and vitest is this file's own
established convention — the task's node:test guidance is for genuinely
colocated `backend/src/**` tests, which this isn't). The fake IPP server
(`ippServer()`) gained:
- `sidesDefault` / `sidesSupported` options to include those attributes in
  its `GET_PRINTER_ATTRIBUTES` response.
- `attributesFailOn: [n]` — makes the fake printer answer the Nth
  `GET_PRINTER_ATTRIBUTES` call with a bare HTTP 500, used to simulate the
  dedicated duplex read failing independently of the later capabilities read
  format negotiation needs.
- a live `attributesCallCount` getter, to assert exactly how many
  `GET_PRINTER_ATTRIBUTES` round trips happened (and that `duplex` not being
  requested adds none).

New `describe('LaserPrinterAdapter.printPdf — duplex honesty ...')` block,
four tests:
1. printer `sides-default: two-sided-long-edge` → `duplex-via-printer-default`
   fires, `duplex-requested-not-applied` does not.
2. printer `sides-default: one-sided` → `duplex-requested-not-applied` fires
   carrying `sidesDefault`, `sidesSupported`, and a reason mentioning
   `sides-default`.
3. the sides-default read's `GET_PRINTER_ATTRIBUTES` call fails (500) while
   the later capabilities call succeeds → `sides-default-lookup-failed`
   (warn) + `duplex-requested-not-applied` (with `sidesDefault: null`) both
   fire, **and** `result.ok === true` / `printJobs.length === 1` — the print
   still happens.
4. `duplex` omitted → zero extra `GET_PRINTER_ATTRIBUTES` calls, zero
   duplex/sides log events.

### Test command and full output

```
npx vitest run tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs --reporter=verbose
```

```
 RUN  v4.1.10 /opt/Code/DaylightStation/.claude/worktrees/household-data-reorg

 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — validation (before any network activity) > rejects a non-PDF buffer before opening any connection 19ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — validation (before any network activity) > rejects an empty buffer 1ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — capability negotiation (the fix) > a printer that advertises application/pdf gets the PDF verbatim, over IPP, unrasterized 43ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — capability negotiation (the fix) > a printer advertising only urf/pwg-raster gets rasterized bytes (image/urf magic), never the raw PDF 94ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — capability negotiation (the fix) > incident #2, end to end: the exact Brother HL-L2460DW capability shape produces a grayscale-8bpp raster at the format-specific DPI, with matching IPP job attributes 73ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — capability negotiation (the fix) > a printer advertising neither PDF nor a producible raster format is REFUSED — nothing is sent 9ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — capability negotiation (the fix) > the guard also fires when a printer advertises nothing at all 4ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter — Incident #3: Validate-Job before every real Print-Job > a printer that accepts the full candidate: Validate-Job runs once, Print-Job carries every attribute unchanged 70ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter — Incident #3: Validate-Job before every real Print-Job > the exact real-world shape: printer refuses any job carrying `sides` — adapter drops it and Print-Job succeeds without it 72ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter — Incident #3: Validate-Job before every real Print-Job > a printer that refuses every candidate, down to the empty one, is never sent a real Print-Job: PRINT_VALIDATE_FAILED 72ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter — Incident #3: Validate-Job before every real Print-Job > validateJob is exposed publicly and reports the raw ok/statusCode the printer returned 4ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter — Incident #3: Validate-Job before every real Print-Job > validateJob requires an explicit documentFormat, same rule as Print-Job — never defaults to octet-stream 1ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — duplex honesty (reads the printer's own sides-default) > printer sides-default is two-sided: logs duplex-via-printer-default, never "not applied" 6ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — duplex honesty (reads the printer's own sides-default) > printer sides-default is one-sided: logs not-applied carrying sidesDefault + sidesSupported and a remedy that names the fix 6ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — duplex honesty (reads the printer's own sides-default) > the sides-default read failing does NOT prevent the print: degrades to not-applied with the lookup failure noted, and Print-Job still succeeds 7ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — duplex honesty (reads the printer's own sides-default) > duplex not requested: no sides-default lookup happens at all (no extra GET_PRINTER_ATTRIBUTES round trip) 6ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — raw 9100 transport (opt-in, still capability-gated) > with rawTransport:true and a printer that advertises PDF, sends over raw JetDirect instead of IPP 24ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — raw 9100 transport (opt-in, still capability-gated) > sends N copies as N concatenated documents over raw 9100 23ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — raw 9100 transport (opt-in, still capability-gated) > rawTransport:true does NOT bypass the guard — a printer that only lists octet-stream still gets refused, never sent raw 23ms
 ✓ tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs > LaserPrinterAdapter.printPdf — raw 9100 transport (opt-in, still capability-gated) > surfaces a raw connection failure as an InfrastructureError 4ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  18:48:10
   Duration  1.01s (transform 105ms, setup 76ms, import 218ms, tests 562ms, environment 0ms)
```

20/20 passed (16 pre-existing + 4 new), no regressions.

## Confirmation: a lookup failure cannot break printing

- `#getSidesCapability()` is only ever called from inside a `try { ... }
  catch (err) { ... }` block in `printPdf`, and every statement inside that
  `try` is the lookup itself (`await this.#getSidesCapability()` and the
  destructuring of its result) — nothing print-critical runs inside it.
- On catch, the code sets `lookupFailed = true`, logs a warn, and falls
  through to the normal `duplex-requested-not-applied` log — it does not
  `throw`, `return`, or otherwise abort `printPdf`. Execution continues
  straight into `const caps = await this.#getCapabilities();` and the rest
  of the existing negotiate → rasterize → Validate-Job → Print-Job pipeline,
  completely unchanged by whether the duplex lookup succeeded.
- Verified directly by test 3 above: the fake server 500s on the first
  `GET_PRINTER_ATTRIBUTES` call (the duplex read) and answers the second
  (capabilities) call normally; the assertions confirm `result.ok === true`,
  exactly one real `Print-Job` was sent, and `attributesCallCount === 2`
  (the failed read + the successful capabilities read) — i.e. the failure
  was contained to the log line and never touched the actual print.

## Not done (out of scope, per task)

- No `sides` job attribute is sent — `JOB_ATTRIBUTE_TRIM_ORDER` and
  `chooseJobAttributes` in `negotiate.mjs` are unchanged.
- No physical print, Print-Job, or paper was produced while verifying this;
  only the stubbed fake IPP server in the test suite was used.
