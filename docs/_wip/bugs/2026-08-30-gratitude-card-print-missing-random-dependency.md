# Gratitude card printing fails before reaching thermal printer — 2026-08-30

**Status:** diagnosed and repaired locally; not deployed or hardware-verified  
**Severity:** high for the Gratitude print workflow; no destructive side effect observed  
**First production failure observed:** 2026-08-30 13:58:41 PDT  
**Latest failure inspected:** 2026-08-30 17:15:30 PDT  
**Affected endpoints:** `GET /api/v1/gratitude/card/print/:location` and, by the
shared renderer path, `GET /api/v1/gratitude/card`  
**Observed caller:** Home Assistant  
**Affected printer in observed requests:** `downstairs` (`10.0.0.50:9100`)  
**Production source revision inspected:** `ca72bbc8d417e432b533ccb8b896489c93568e02`  
**Defect introduced by:** `76f2089c37e1aac702033e312aa364eeb80c26cd`
(`refactor(backend): complete DDD boundary remediation`, 2026-08-29 09:42 PDT)  
**Primary evidence:** VictoriaLogs, deployed source at
`homeserver.local:/opt/Code/DaylightStation`, live count-only API query, Git history,
and an isolated reproduction

No gratitude or hope text was copied into this report. The live API was queried only
for category counts.

---

## 1. Executive summary

The latest Gratitude card requests **did not print**. They failed while selecting the
items to draw on the card, before an image was generated and before the thermal-printer
gateway was called.

The domain function `selectItemsForPrint` was changed from a three-argument API to a
four-argument API that requires an injected random-number function:

```js
selectItemsForPrint(items, count, now, random)
```

The active composition code in `backend/src/app.mjs` still calls it with three
arguments:

```js
selectItemsForPrint(items, count, nowMs)
```

For a nontrivial selection pool, `random` is therefore `undefined` and the domain
function throws:

```text
selectItemsForPrint requires random
```

The error propagates from card rendering through the router's async error handler and
becomes HTTP 500. The router never reaches `printOperation.print(...)`, so there is no
`thermalPrinter.job.start`, no print payload, and no printed-state mutation for these
requests.

This is a composition contract mismatch, not a printer, network, paper, cover, canvas,
or Home Assistant failure.

---

## 2. What happened in production

Home Assistant called the downstairs Gratitude print endpoint three times. All three
requests failed with the same exception and returned HTTP 500.

| Local time (PDT) | UTC | HTTP duration | Result |
|---|---|---:|---|
| 2026-08-30 13:58:41 | `2026-08-30T20:58:41.407Z` | 5399 ms | 500, missing `random` |
| 2026-08-30 16:46:31 | `2026-08-30T23:46:31.535Z` | 18 ms | 500, missing `random` |
| 2026-08-30 17:15:30 | `2026-08-31T00:15:30.814Z` | 10 ms | 500, missing `random` |

The latest error record is:

```text
_msg: http.error.unknown
message: selectItemsForPrint requires random
status: 500
traceId: 39d117e1-6b1b-42c9-b037-5693b4246421
stack:
  PrintSelectionService.mjs:27  selectItemsForPrint
  app.mjs:2527                  pick
  app.mjs:2534                  getSelectionsForPrint
  GratitudeCardRenderer.mjs:48  createCanvas
  gratitude.mjs:476             route handler
```

The matching response record is:

```text
_msg: http.response
method: GET
path: /api/v1/gratitude/card/print/downstairs
status: 500
deviceId: HomeAssistant/2026.8.3 aiohttp/3.14.3 Python/3.14
durationMs: 10
```

There are no matching thermal-printer start or completion events around any of the
three failures. The stack also proves the exception occurred at card generation, which
precedes submission to the printer.

### Resulting call sequence

```text
Home Assistant GET /gratitude/card/print/downstairs
  -> router resolves the named printer
  -> router calls createGratitudeCardCanvas()
  -> renderer requests selections
  -> app.mjs calls selectItemsForPrint(items, count, nowMs)
  -> selector rejects missing random function
  -> HTTP error middleware returns 500

Never reached:
  -> canvas.toBuffer()
  -> printOperation.print()
  -> TemporaryImagePrintGateway
  -> ThermalPrinterAdapter
  -> gratitudeService.markAsPrinted()
```

---

## 3. Confirmed root cause

### RC-1 — The selector contract changed but its active caller did not

Commit `76f2089c3` made randomness an explicit dependency of the domain selection
function. This was a sound direction: replacing direct `Math.random()` calls with a
caller-supplied function makes the domain policy deterministic and testable.

The commit changed:

```diff
-export function selectItemsForPrint(items, count, now) {
+export function selectItemsForPrint(items, count, now, random) {
+  if (typeof random !== 'function') throw new Error('selectItemsForPrint requires random');
```

and replaced both internal `Math.random()` calls with `random()`.

However, the active production call in `backend/src/app.mjs:2527` was not changed:

```js
selectItemsForPrint(items, count, nowMs)
```

That leaves `random` undefined and violates the new domain contract.

This defect is present in the deployed revision and in current committed `main`; the
two commits between deployed `ca72bbc8d` and workspace/origin `5938107e8` do not change
any relevant Gratitude file.

### RC-2 — The correctly designed application service was added but never wired

The same refactor added:

`backend/src/3_applications/gratitude/services/GratitudePrintPresentationService.mjs`

That service correctly calls:

```js
selectItemsForPrint(items, count, nowMs, this.random)
```

But a repository-wide search at the deployed revision finds no import, construction,
or use of `GratitudePrintPresentationService`; only its class declaration and default
export exist. The composition root retained the older inline selection/projection
closure instead.

The result is duplicate policy code:

- the new, correct application service is dead code;
- the older inline composition path remains live and has the stale signature.

The intended boundary remediation was therefore only partially completed.

### RC-3 — The failure is deferred until random selection is necessary

`selectItemsForPrint` returns before validating `now` or `random` when the input is
empty or `items.length <= count`:

```js
if (!items || items.length === 0) return [];
if (items.length <= count) return [...items];

// Dependency validation happens only after those returns.
if (typeof random !== 'function') throw new Error('selectItemsForPrint requires random');
```

The card policy selects two Gratitude items and two Hope items. A missing RNG can
therefore remain hidden in small fixtures or a nearly empty household, then fail once
either category has more than two entries.

Isolated reproduction:

```text
2 items, count 2, no random -> ok: 2 items returned
3 items, count 2, no random -> error: selectItemsForPrint requires random
```

The live count-only query returned:

| Category | Current selections |
|---|---:|
| Gratitude | 292 |
| Hopes | 163 |

Production therefore always enters the branch that requires `random`.

### RC-4 — The public function documentation was not updated

The JSDoc above `selectItemsForPrint` documents `items`, `count`, and `now`, but has no
`@param` entry for `random`. The signature and runtime guard are the only declaration
of the new required dependency. This did not cause the runtime failure by itself, but
it made the contract migration easier to miss.

---

## 4. Why existing tests passed

The relevant suites were run against the diagnosed workspace:

```text
Test Files  3 passed (3)
Tests       9 passed (9)
```

Suites:

- `tests/unit/domains/gratitude/PrintSelectionService.test.mjs`
- `backend/src/3_applications/gratitude/services/GratitudeCardPrintService.test.mjs`
- `backend/src/4_api/v1/routers/gratitude.card.test.mjs`

They pass despite the production defect for four reasons.

### T-1 — Domain tests were updated selectively

The two domain tests that force weighted selection now supply `() => 0.5`. Tests with
one or two items still omit the RNG, but they exercise the early-return path and never
validate the dependency.

### T-2 — Router tests mock away rendering and selection

The successful router test injects a fake `createGratitudeCardCanvas` that returns an
already-built canvas. It tests HTTP translation, printer-service invocation, and
printed markers, but never executes the real renderer or the stale closure in
`app.mjs`.

### T-3 — Printer-service tests start after rendering

`GratitudeCardPrintService.test.mjs` tests printer resolution and print outcomes with
an already-created PNG buffer. It cannot detect an exception that occurs before the
service is called.

### T-4 — The new presentation service has neither wiring nor a focused test

The application service that correctly accepts `random` is not instantiated in
production and has no direct test proving its dependency contract or projection.

There is no integration/characterization test that composes the real selection
policy, renderer, router, and a fake printer with more than two selections. That is the
specific missing coverage boundary.

---

## 5. Impact and data integrity

### Confirmed impact

- All three observed downstairs Gratitude print requests returned HTTP 500.
- No Gratitude card image was submitted to the thermal printer for those requests.
- No paper was consumed by those failed requests.
- No selections were marked as printed.
- Home Assistant received a server error rather than a semantic print outcome.
- The PNG preview endpoint shares the same selection/rendering path and is expected to
  fail under the current production data shape as well.
- The defect is location-independent. Any valid printer location reaches the same
  broken renderer before printing.

### Ruled out for this incident

- printer unreachable or connection timeout;
- paper-out, cover-open, or printer-reported fault;
- printer registry lookup failure;
- ESC/POS image conversion failure;
- temporary PNG cleanup race;
- socket write or drain failure;
- Home Assistant aborting the request;
- printed-state corruption or partial mark-as-printed writes.

The printer had no opportunity to accept or reject these jobs.

---

## 6. Implemented remediation

The durable P1 repair below is now implemented in the workspace. The smaller P0
one-line patch was not used because it would have left the correct application service
as dead code and preserved duplicate selection policy in `app.mjs`.

### P0 alternative — not selected

The smallest safe hotfix is to inject the runtime RNG at the active composition call:

```diff
-selectItemsForPrint(items, count, nowMs)
+selectItemsForPrint(items, count, nowMs, Math.random)
```

`Math.random` belongs at the composition boundary, not inside the domain service, so
this restores the explicit-dependency design while minimizing production change.

This hotfix is sufficient to stop the HTTP 500, but it leaves duplicate presentation
policy in `app.mjs`.

### P1 — Completed: application-service wiring

The preferred durable fix is to instantiate
`GratitudePrintPresentationService` in composition with explicit dependencies:

```js
const presentation = new GratitudePrintPresentationService({
  gratitude: gratitudeServices.gratitudeService,
  resolveGroupLabel: (userId) => userService.resolveGroupLabel(userId),
  clock: { now: () => Date.now() },
  random: Math.random,
  counts: { gratitude: 2, hopes: 2 },
});
```

Then make the renderer delegate to `presentation.prepare(householdId)` and delete the
inline import, count policy, selection, and projection closure from `app.mjs`.

This produces one owner for card-selection presentation policy and makes the already
created application service real rather than orphaned code.

### P1 — Completed: construction-time validation

`GratitudePrintPresentationService` should reject invalid composition immediately:

- `gratitude.getSelectionsForPrint` must be a function;
- `resolveGroupLabel` must be a function;
- `clock.now` must be a function;
- `random` must be a function;
- counts must be nonnegative integers.

A missing RNG should prevent application bootstrap or module construction, not wait
for a household to accumulate a third selection.

The domain function should also document its `random` parameter. Whether it validates
dependencies before or after trivial early returns is less important once the
application service validates at construction, but tests should make that choice
explicit.

### P1 — Completed: composed selection/render regression test

Add a test that uses:

- the real `GratitudePrintPresentationService`;
- the real `GratitudeCardRenderer` selection callback boundary;
- at least three Gratitude and three Hope selections;
- deterministic `clock` and `random` fakes;
- a fake canvas/printer boundary so no hardware is touched.

It must prove:

1. exactly two items per category are selected;
2. selection is deterministic for the injected RNG;
3. rendering reaches the print operation without throwing;
4. selected IDs, not all candidate IDs, are marked only after success;
5. missing `random` fails during service construction.

The new test uses three candidates in each category, an injected clock and RNG, and
the production canvas renderer. It verifies two selected IDs per category and a
nonempty PNG. The existing router translation tests remain because they cover the
separate print/marking boundary.

### P2 — Add Gratitude-specific print observability

The router currently relies on generic HTTP events and hardware adapter events, which
have to be correlated by timestamp. Add structured events without logging private card
text:

- `gratitude.print.render.start` — location and candidate counts;
- `gratitude.print.render.complete` — dimensions, byte count, selected counts;
- `gratitude.print.render.failed` — location, stage, error, trace ID;
- `gratitude.print.submit.complete` — dispatched/verification outcome and trace ID;
- `gratitude.print.marked` — category counts, not item text.

Propagate the HTTP trace ID or a print operation ID into the printer events so a single
request can be followed without relying on millisecond proximity.

---

## 7. Verification plan after the fix

### Automated

1. Run the new presentation-service and composed render-path tests.
2. Run the existing three Gratitude suites listed above.
3. Run the relevant backend unit/isolated test gate.
4. Verify a fixture with two items and one with more than two items.
5. Verify both card preview and card print route contracts.

### Production-safe read check

1. Call `GET /api/v1/gratitude/card` and require HTTP 200, `Content-Type: image/png`,
   and a nonempty response.
2. Confirm no `http.error.*` event with `selectItemsForPrint requires random`.

### One controlled hardware check

Because this operation has a physical side effect, perform exactly one deliberate
downstairs print after the preview succeeds. Require this event sequence:

```text
gratitude render start/complete
thermalPrinter.job.start
thermalPrinter.preflight.ok (or explicitly unreadable, but not faulted)
thermalPrinter.job.complete
thermalPrinter post-job outcome
http.response
```

Then inspect the response body and the paper output separately. Do not infer physical
paper success from HTTP 200 alone.

---

## 8. Related print-truth issue — not the cause of this incident

The thermal adapter distinguishes:

- `dispatched: true` — bytes left the application;
- `verification: 'verified'` — the printer answered conclusively after the job;
- `verification: 'unreadable'` — the application could not learn post-job state;
- `verification: 'faulted'` — the printer positively reported a blocking fault.

`GratitudeCardPrintService` currently reports success only when the legacy return is
literal `true` or `outcome.verified === true`:

```js
success: outcome === true || outcome?.verified === true
```

Therefore `{ dispatched: true, verification: 'unreadable' }` becomes
`success: false`, even though bytes were sent and paper may have emerged. This is not
what happened in the three 2026-08-30 failures—the gateway was never called—but it is
an existing source of operational ambiguity after the rendering defect is fixed.

For example, an earlier downstairs job on 2026-08-29 at 12:12 PDT logged:

```text
thermalPrinter.job.start       target 10.0.0.50:9100, itemCount 1
thermalPrinter.preflight.ok    answered 4
thermalPrinter.job.complete    36,169 bytes, duration 1,901 ms
thermalPrinter.postjob.unverified answered 0
```

That proves dispatch and local completion, but not physical paper output. The desired
Gratitude policy for an unreadable post-job status—mark printed, do not mark, or return
an explicit `dispatched_unverified` state—should be decided separately. It must not be
folded into the missing-RNG hotfix or described as the root cause of the current 500s.

---

## 9. Acceptance criteria

The incident is resolved when all of the following hold:

- card preview succeeds with the live-size selection pool;
- card printing no longer throws `selectItemsForPrint requires random`;
- all valid printer locations use the same corrected presentation service;
- the live path has a required, injected RNG;
- missing composition dependencies fail at startup/construction;
- a regression test exercises more than two items per category through the composed
  render path;
- no printer job is marked successful merely because the HTTP response is 200;
- Gratitude-specific logs distinguish render failure, dispatch, verification, and
  printed-state mutation;
- one controlled production print is checked both in logs and at the physical printer.

---

## 10. Diagnosis confidence

**Root-cause confidence: high.** The production stack names the exact guard, deployed
source shows the missing fourth argument, Git history shows the contract change, the
correct replacement service is demonstrably unwired, and the isolated reproduction
matches the production exception exactly.

**Physical-print conclusion for the latest requests: definitive no.** The exception
occurred before the print gateway, no matching thermal job events exist, and the route
cannot reach printer submission after that exception.
