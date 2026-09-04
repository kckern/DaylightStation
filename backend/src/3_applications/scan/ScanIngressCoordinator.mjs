/**
 * ScanIngressCoordinator — routes a scan to the appropriate injected use case.
 *
 * This file is a LIFT, not a rewrite. Every branch below used to sit inline in
 * the `onScan` callback `app.mjs` handed to `createBarcodeRelay`; the routing
 * DECISION has moved into the vocabulary (`ScanCode` + `ScanDispatcher`) and
 * what is left here is the four domain entry points, unchanged, plus the
 * dependency capability checks. The comments that
 * travelled with each branch record a defect that branch has already caused —
 * they are kept verbatim for that reason.
 *
 * ## What moved, and what deliberately did not
 *
 * `go:` and `cmd:` share ONE handler on purpose. Content and command codes are
 * told apart downstream inside `BarcodePayload.parse`, and stripping either
 * prefix leaves exactly the legacy positional string it already understands.
 * Two handlers would mean two copies of a grammar that has one parser.
 *
 * School is reached because the PARSER claims `sch:`, not because a check runs
 * first — which is the same guarantee the old ordering gave (`isSchoolToken` is
 * `startsWith('sch:')`, and a namespace always outranks the reader's route). The
 * `handlesCode` call is preserved inside the handler because it is ALSO the
 * unwired-console switch: when the lifecycle fails to build it is a constant
 * false, and no scan reaches a console that is not there.
 *
 * ## Why a dispatcher is built PER SCAN
 *
 * The handler contract carries `{namespace, body, raw, form, device, route}` and
 * no transport metadata, but the TriggerEvent the content branch builds carries
 * `meta.timestamp` — the relay's LOCAL wall-clock string, stamped at ingest and
 * not re-derivable here (it needs the household timezone and, more to the point,
 * the instant the scan actually arrived). Binding it into the handler is the only
 * way to keep that field, and binding it per scan is the only way to do that
 * without shared mutable state between scans.
 *
 * There are THREE options, not two, and the third is the right one — later.
 *
 *  1. One dispatcher plus a "current scan" variable set immediately before
 *     `dispatch()`. REJECTED: it works today only because `dispatch` reaches the
 *     handler with no intervening `await`. That is an invariant of a file this
 *     module does not own, and a future `await` in front of the handler call
 *     would corrupt the timestamp silently.
 *  2. A dispatcher per scan — what this does. Measured at ~347ns to construct
 *     against ~1318ns to dispatch, so it is about a quarter of an operation that
 *     happens at human pace. It costs an allocation, the `buildHandlers(ts)`
 *     indirection, and a probe that is not quite the object production uses.
 *  3. PHASE 2: widen `dispatch({code, device, route})` to carry a `meta` bag
 *     alongside `device` and `route` and pass it through to handlers. `ts` is
 *     transport metadata exactly as `device` is, and the only reason it is not
 *     already there is that the contract was drawn before this caller existed.
 *     That removes the allocation, the indirection, and the probe/production
 *     divergence in one change — but it edits the dispatcher's public contract,
 *     which is not a thing to do in a phase whose criterion is zero behaviour
 *     change. Option 2 is the cheapest correct thing UNTIL then, not forever.
 *
 * A dispatcher is still built ONCE at composition, and discarded: it proves the
 * handler set is well-formed (the `ScanDispatcher` constructor rejects duplicate
 * and malformed registrations) at BOOT rather than on the first scan, hours later
 * and far from its cause.
 *
 * ## Trimming
 *
 * `body` is NOT trimmed by the parser, by design — `go: living-room:plex:1`
 * yields a body with a LEADING SPACE, and trimming in the parser would change
 * what `go:` means for every domain at once. It is trimmed HERE, in the CONTENT
 * handler only, because:
 *
 *  1. It is provably a NO-OP for every code in circulation today. A legacy code
 *     takes `body === raw`, and `raw` is already trimmed twice over (the relay
 *     trims at ingest, `parseScanCode` trims again). Only the new prefixed forms,
 *     which nothing has printed yet, can carry an interior space.
 *  2. Untrimmed, the damage is SILENT rather than loud. `BarcodePayload`
 *     normalises a space to a COLON, so `" living-room:plex:1"` resolves with an
 *     EMPTY screen and `living-room` read as the action — a wrong dispatch, not a
 *     refusal. That is the whole reason this is worth a line of code.
 *  3. Both `ScanCode` and `ScanDispatcher` assign this job to the handler in so
 *     many words, and CLAUDE.md records the same hazard for YAML content ids.
 *
 * The nutrition handler deliberately does NOT trim, and that is not an oversight:
 * `ScanVocabularyService.parseScan` trims its own input, so a trim here would be
 * a line nothing could ever distinguish from its absence. School and product read
 * grammars with no segments at all. One trim, in the one place a space changes
 * the meaning.
 *
 * ## KNOWN PHASE 1 GAP: an unhandled namespace has no way to answer the person
 *
 * `book` is a real parse outcome with no handler here, so an ISBN-13 resolves,
 * finds nothing registered, and comes back `{ok: false, domain: 'book'}` — which
 * `onScan` discards. The scan is SILENT at the scanner. That is a real loss for
 * the one place it can happen today: scanning a book at the food scale used to
 * reach the UPC lookup and get a "not found" reply in Telegram, which was wrong
 * but was at least an ANSWER. It is user error either way and Phase 1 ships no
 * book handler on purpose, so this is not worth a special case — but whoever
 * builds that handler should know the FEEDBACK path is missing too, not just the
 * handler. The dispatcher's whole premise is that a scanner which appears to do
 * nothing is indistinguishable from a broken one; honouring that here means
 * `onScan` (or a `book` handler) eventually has to render the Outcome it is
 * currently throwing away.
 *
 * @module composition/modules/scanDispatch
 */

import { ScanDispatcher, emit } from '#apps/scan/ScanDispatcher.mjs';
import { PREFIX_REGISTRY, LEGACY_NUTRITION_TAGS } from '#domains/scan/ScanCode.mjs';
import { KNOWN_COMMANDS } from '#domains/barcode/BarcodeCommandMap.mjs';
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';
import { routeNutribotScan, nutriscanRefusalNotice, swallowNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';

/**
 * Reader route -> namespace, for the dispatcher's step 5.
 *
 * The relay itself only ever emits `content` or `nutribot` (see
 * `createBarcodeRelay`, which coerces anything else to its default), so this map
 * is total over the routes that can actually arrive.
 *
 * `product` is load-bearing and has NO other way in: since the parser claims only
 * ISBN-13 by shape, a bare UPC resolves to `unknown` and reaches the food log
 * through this map or not at all. See `assertRouteFallback`.
 */
export const SCAN_ROUTE_FALLBACK = Object.freeze({ nutribot: 'product', content: 'content' });

/**
 * Read a rejection's message ONCE, defensively.
 *
 * Every `.catch` below used to read `err.message` bare, which is fine for an
 * `Error` and a live grenade for anything else: `Promise.reject(null)` from any
 * collaborator throws INSIDE the catch callback, and a throw there is not caught
 * by anything — it surfaces as a process-level `unhandledRejection`. The module
 * advertises a never-reject invariant; a reporting path that can take the process
 * down is not compatible with it.
 *
 * `ScanDispatcher.#failed` already learned this the hard way and its docstring
 * says so: reading `message` unguarded WAS the bug. Same trust boundary, same
 * treatment — one read, wrapped, reused. `String()` because a thrown value need
 * not carry a string message, and `?? err` so a bare `throw 'nope'` still says
 * something useful instead of an empty string. The `?? err` branch is itself
 * inside the try, because `String(Object.create(null))` throws.
 *
 * The `?.` is belt-and-braces rather than the thing holding this up: the catch
 * subsumes it, and `errText(null)` answers `''` with or without it. It is kept
 * on the same grounds `emit` keeps its `typeof` guard — a null or undefined
 * rejection is an ORDINARY shape, not a fault, and ordinary shapes are handled
 * rather than caught. Mutation-testing says so out loud: dropping the `?.`
 * changes no observable behaviour while the try/catch stands.
 *
 * EXPORTED for `app.mjs`, whose `onScan` holds the last-resort catch around
 * `handleScan`. That catch sits at the very top of the scan path — a throw
 * inside it has nothing above it at all — so it wants this treatment most, and
 * gets it from here rather than from a second copy.
 */
export function errText(err) {
  try {
    return String(err?.message ?? err ?? '');
  } catch {
    return '';
  }
}

/**
 * Rate-limit WITHIN a level, never by dropping to one that is not shipped.
 *
 * `debug` never reaches the log store (see `docs/reference/core/*` on the
 * logging framework), so the module used to warn ONCE per swallow reason and
 * demote every repeat to `debug` — which was not suppression, it was deletion.
 * The second refusal of an incident simply did not exist anywhere. The 12:31
 * incident this module is named after is exactly that: a `dl:140` refusal was
 * visible and the `ct:60` refusal four seconds later left no record at all.
 *
 * `logger.sampled` (see `backend/src/0_system/logging/logger.mjs`) keeps a
 * countable, still-shipped record instead: within budget it logs every call,
 * over budget it aggregates a count rather than discarding it silently. Falls
 * back to `warn` via `emit` — unconditionally, not once — when the logger has
 * no `sampled` method, the same defensive shape `emit` already uses for a
 * logger missing a level.
 */
function emitSampled(logger, event, data, options) {
  try {
    if (typeof logger?.sampled === 'function') {
      logger.sampled(event, data, options);
      return;
    }
  } catch {
    // Fall through to the `warn` fallback below — see `emit`'s own rationale.
  }
  emit(logger, 'warn', event, data);
}

/** Startup-decided swallow reasons. Lifted from `app.mjs`. */
const NUTRISCAN_SWALLOW_EVENT = {
  'nutriscan-disabled': 'barcode_relay.nutriscan.config_disabled',
  'no-scale-id': 'barcode_relay.nutriscan.no_scale_id',
};

/**
 * Every namespace a route falls back to MUST have a registered handler.
 *
 * No parse ever yields `product`, so a missing or misspelled key here stops UPC
 * food logging house-wide with no parse-level signal and nothing in the logs
 * pointing at the cause — the failure nobody notices for a week. The dispatcher
 * already rejects a DOUBLED registration at construction; this completes the
 * pair, so neither half of a mis-wiring can reach production as a mystery
 * `unknown` on a kiosk.
 *
 * Throws, unlike the screen-name check below, because this is a WIRING bug in
 * code, not a mistake in somebody's YAML.
 */
function assertRouteFallback(routeFallback, handlers) {
  for (const [route, namespace] of Object.entries(routeFallback || {})) {
    if (!handlers.some((h) => h.namespace === namespace)) {
      throw new Error(
        `scanDispatch: route "${route}" falls back to "${namespace}", which has no registered handler`,
      );
    }
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function isFunction(value) {
  return typeof value === 'function';
}

/** Present-but-null, told apart from absent. See the YAML note in DEP_CONTRACT. */
function isNotNull(value) {
  return value !== null;
}

/**
 * What `app.mjs` must hand this factory, and what each argument must BE.
 *
 * ## Why this exists at all
 *
 * The call site is in `createApp`, a composition root of several thousand lines
 * that no unit test can import — nothing in this repository exercises it. Every
 * test of this module drives it through a harness of its own, so the arguments
 * `app.mjs` actually passes are covered by NOTHING. Deleting
 * `screenNames: barcodeScreenNames` from that call used to pass every gate in
 * the repo while turning the leading-segment guard off house-wide.
 *
 * A test cannot reach that line, so the check lives here instead: a dropped or
 * misspelled argument stops the boot, loudly, naming itself. That is the same
 * trade `assertRouteFallback` above already makes, for the same reason — a
 * WIRING bug in code, not a mistake in somebody's YAML.
 *
 * ## Absent is not the same as empty
 *
 * Every required key is checked on the RAW bag and destructured only afterwards,
 * so no default can stand in for a missing argument. That is the whole mechanism:
 * `screenNames = []` in the signature made `[]` (a household with no screens)
 * and "nobody passed it" the same value, and the guard reads healthy in both.
 * The keys with a deliberate default — `commandNames` and `routeFallback`, which
 * `app.mjs` does not pass — keep theirs, and are listed as optional rather than
 * required.
 *
 * `schoolLifecycle`, `schoolCalcResultImporter`, and `applyScanToComposition`
 * may be NULL: an unbuilt console, a disabled SchoolCalc product, and a disabled
 * nutriscan are real states. They may not be ABSENT, because null is an answer
 * and absence is not.
 *
 * ## Unknown keys are rejected, and that is what catches a misspelling
 *
 * A misspelled REQUIRED key already fails the missing check. A misspelled
 * OPTIONAL one does not: `relayInstance` (singular) would leave `relayInstances`
 * at nothing, strip every reader of its `scale_id`, and swallow every fridge
 * scan in the house. Rejecting names this module does not know is the only thing
 * that catches it.
 *
 * ## What is checked for SHAPE, and what only for presence
 *
 * Shape checks apply to values `app.mjs` BUILDS: services, loggers, the
 * late-bound getters, and `screenNames` (assembled in code from device config,
 * so an array is a code guarantee). A wrong shape there is a wiring bug and this
 * throws on it.
 *
 * `relayInstances` and `relayConfig` come straight out of `barcode-relay.yml`
 * and are checked only for being present and non-null. Their CONTENT is
 * somebody's YAML, and this module already decided that argument the other way
 * for the nutriscan table — refusing to boot the whole station over a mistyped
 * config value is the worst available trade in the building. Null is the one
 * exception because `relayInstances[device]` would then throw on every scan,
 * from `handleScan`, outside the dispatcher's never-reject guard.
 */
const DEP_CONTRACT = Object.freeze({
  schoolLifecycle:        { ok: () => true, want: 'present (may be null when the console is unbuilt)' },
  schoolCalcResultImporter: {
    ok: (v) => v === null || typeof v?.execute === 'function',
    want: 'null or an object with execute()',
  },
  triggerDispatchService: { ok: (v) => typeof v?.handleEvent === 'function', want: 'an object with handleEvent()' },
  relayInstances:         { ok: isNotNull, want: 'non-null (indexed by reader id)' },
  relayConfig:            { ok: isNotNull, want: 'non-null' },
  applyScanToComposition: { ok: () => true, want: 'present (may be null when nutriscan is disabled)' },
  getObservationService:  { ok: isFunction, want: 'a function (late-bound getter)' },
  getLogFoodFromUPC:      { ok: isFunction, want: 'a function (late-bound getter)' },
  nutribotIdentity:       { ok: (v) => typeof v?.defaultUserId === 'function' && typeof v?.conversationIdFor === 'function', want: 'a semantic NutriBot identity resolver' },
  screenNames:            { ok: Array.isArray, want: 'an array of configured screen names' },
  logger:                 { ok: isObject, want: 'a structured logger' },
  barcodeLogger:          { ok: isObject, want: 'a structured logger' },
});

/**
 * Keys with a deliberate default. Optional to PASS, still checked when passed —
 * a `commandNames` string would iterate as characters and report no collisions
 * while looking perfectly healthy.
 */
const OPTIONAL_DEPS = Object.freeze({
  commandNames:  { ok: Array.isArray, want: 'an array of command names' },
  routeFallback: { ok: isObject, want: 'an object mapping reader route -> namespace' },
});

/**
 * Refuse to build on a bag that does not match the contract above.
 *
 * Runs FIRST, ahead of every other check in the factory, so a missing argument
 * is reported as the missing argument rather than as whatever the first
 * consumer of it complains about.
 *
 * Reports all three faults together, and every instance of each: one boot, one
 * fix. Only KEY NAMES go into the message — a dependency value here is a live
 * service object, and the name is the whole diagnosis anyway.
 */
function assertDeps(deps) {
  if (!isObject(deps)) throw new TypeError('scanDispatch: dependencies must be an object');

  const missing = [];
  const malformed = [];
  for (const [key, { ok, want }] of Object.entries(DEP_CONTRACT)) {
    const value = deps[key];
    if (value === undefined) missing.push(key);
    else if (!ok(value)) malformed.push(`${key} (wants ${want})`);
  }
  for (const [key, { ok, want }] of Object.entries(OPTIONAL_DEPS)) {
    if (deps[key] !== undefined && !ok(deps[key])) malformed.push(`${key} (wants ${want})`);
  }

  // `Object.hasOwn`, never `key in DEP_CONTRACT`. Both maps are ordinary object
  // literals, so `in` resolves `Object.prototype` and would accept
  // `constructor`, `toString` and `__proto__` as recognised dependency names —
  // the same prototype hazard `PREFIX_REGISTRY` and `toRouteMap` are hardened
  // against, met here with `hasOwn` instead of a null prototype so that exactly
  // ONE thing decides the answer and a test can prove which. `Object.keys` on
  // the caller's bag is own-and-enumerable for the same reason.
  const unknown = Object.keys(deps).filter(
    (key) => !Object.hasOwn(DEP_CONTRACT, key) && !Object.hasOwn(OPTIONAL_DEPS, key),
  );

  const problems = [];
  if (missing.length) problems.push(`missing: ${missing.join(', ')}`);
  if (malformed.length) problems.push(`malformed: ${malformed.join(', ')}`);
  if (unknown.length) problems.push(`unknown: ${unknown.join(', ')}`);
  if (problems.length)
    throw new TypeError(`scanDispatch: bad dependencies — ${problems.join('; ')}`);
}

/**
 * Nothing that can LEAD a legacy positional code may share a name with a scan
 * tag.
 *
 * Deferred to composition from `ScanCode`, which imports nothing and so cannot
 * read config: this is the first place both lists are in hand. A legacy code is
 * `<screen>:<source>:<id>` or `<command>:<arg>`, and both steps 1 and 2 of the
 * resolution order split at the FIRST colon — so a leading segment that matches
 * a tag is claimed by the tag and the segment is gone.
 *
 * ## Two tag sets, and the SECOND one is the dangerous one
 *
 * `PREFIX_REGISTRY` (`go`/`cmd`/`nut`/`sch`) is the obvious half: a screen named
 * `go` would make `go:plex:1` resolve as a PREFIXED content code with body
 * `plex:1` — the screen dropped, the content sent wherever the reader defaults
 * to.
 *
 * `LEGACY_NUTRITION_TAGS` (`dl`/`ct`/`rs`) is the half that matters more, and it
 * is THIS COMMIT that made it matter. `ScanVocabularyService` has always warned
 * that "the one theoretical collision is a screen named `dl`, `ct`, or `rs`",
 * but until now the fridge grammar was consulted only when the reader's route
 * was `nutribot`, so a `dl`-named screen still worked on every content reader in
 * the house. Step 2 is ROUTE-INDEPENDENT: `dl:plex:1` now resolves to nutrition
 * on a content reader too, where it is swallowed rather than dispatched. The
 * blast radius grew here, so the guard belongs here.
 *
 * `KNOWN_COMMANDS` is checked alongside the configured screens because a command
 * leads a legacy code exactly as a screen does — `volume:30` is `<tag>:<rest>` to
 * the same `indexOf(':')`. It is a closed set in code rather than config, but a
 * check that covered only half the leading segments would be a guard placed
 * where the risk LOOKS like it is.
 *
 * No collision exists today, in either direction.
 *
 * Reported, NOT thrown. The collision breaks barcodes for one screen; a throw
 * here would stop the whole station from booting over a name in `devices.yml`,
 * and this codebase already decided that argument the other way for the
 * nutriscan table (`nutriscan.config.invalid` fails soft on purpose). The
 * offending screen's codes were already broken before the check ran, so failing
 * loudly buys nothing and costs everything else in the house.
 *
 * @returns {string[]} colliding names, for a caller (or a test) to assert on
 */
function reportLeadingSegmentCollisions(screenNames, commandNames, logger) {
  const tags = new Set([...Object.keys(PREFIX_REGISTRY), ...LEGACY_NUTRITION_TAGS]);
  // Both lists are checked as arrays by `assertDeps`, so they are spread
  // directly. An `Array.isArray` fallback here would be a second opinion no test
  // could reach, and would put back the exact failure the contract removes: a
  // non-array quietly contributing nothing while the guard reports all clear.
  const leading = [...screenNames, ...commandNames];
  const collisions = [...new Set(
    leading.filter((name) => tags.has(name)),
  )];
  if (collisions.length > 0) {
    emit(logger, 'error', 'scan.leading_segment.shadows_tag', {
      names: collisions,
      hint: 'rename it; a `<screen|command>:...` code named after a scan tag loses that segment',
    });
  }
  return collisions;
}

/**
 * Every key below is REQUIRED unless marked optional; see `DEP_CONTRACT` for why
 * the bag is checked before it is destructured.
 *
 * @param {object} deps
 * @param {{handlesCode: Function, handleScan: Function|null}|null} deps.schoolLifecycle  null when
 *   the console is not built
 * @param {{execute: Function}|null} deps.schoolCalcResultImporter  the common QR/cable result
 *   importer, or null when SchoolCalc is disabled
 * @param {{handleEvent: Function}} deps.triggerDispatchService
 * @param {Record<string, object>} deps.relayInstances  `relays:` block from barcode-relay.yml
 * @param {object} deps.relayConfig                     the whole barcode-relay app config
 * @param {{execute: Function}|null} deps.applyScanToComposition  null when nutriscan is disabled
 * @param {() => ({refreshPrompt?: Function}|null)} deps.getObservationService  LATE-BOUND — the
 *   scale observation service is constructed long after this module and only exists if the head of
 *   household and bot id resolve, so it is read at scan time, never captured.
 * @param {() => ({execute: Function})} deps.getLogFoodFromUPC  late-bound for the same reason:
 *   `nutribotServices` is built further down `app.mjs` than the relay wiring.
 * @param {{defaultUserId:Function,conversationIdFor:Function}} deps.nutribotIdentity
 * @param {string[]} deps.screenNames     configured screen names, for the collision check. Required
 *   even when empty — pass `[]` to say a household has no screens.
 * @param {object} deps.logger            STRUCTURED logger for the dispatcher itself
 * @param {object} deps.barcodeLogger     the channel the lifted branches already logged on; keeping
 *   it is what keeps every existing event name and payload byte-identical
 * @param {string[]} [deps.commandNames]  OPTIONAL, defaults to the live command map
 * @param {Record<string,string>} [deps.routeFallback]  OPTIONAL, defaults to SCAN_ROUTE_FALLBACK
 * @returns {{handleScan: (relay: object) => Promise<object>, namespaces: string[],
 *            screenCollisions: string[]}}
 */
export function createScanDispatch(deps = {}) {
  // FIRST, and on the RAW bag: a destructuring default cannot tell an argument
  // that was omitted from one that was passed empty, so nothing may be
  // destructured until the bag has been checked. See `DEP_CONTRACT`.
  assertDeps(deps);

  const {
    schoolLifecycle,
    schoolCalcResultImporter,
    triggerDispatchService,
    relayInstances,
    relayConfig,
    applyScanToComposition,
    getObservationService,
    getLogFoodFromUPC,
    nutribotIdentity,
    screenNames,
    // Defaulted rather than injected by `app.mjs`: this is a closed set in code,
    // not config. It is a PARAMETER only so the collision check can be driven
    // with a colliding name — an unfalsifiable guard is not a guard.
    commandNames = KNOWN_COMMANDS,
    logger,
    barcodeLogger,
    routeFallback = SCAN_ROUTE_FALLBACK,
  } = deps;

  const relayCfgFor = (device) => relayInstances[device] || {};

  // ---- content + command ---------------------------------------------------
  // ONE handler. `ts` is bound per scan; see the module docstring.
  const makeTriggerHandler = (ts) => ({ body, device, route }) => {
    const event = TriggerEvent.create({
      source: 'barcode',
      location: device,
      value: body.trim(),
      meta: { device, timestamp: ts, transport: 'ws', route },
    });
    // Fire and forget, as before: the relay's `onScan` never awaited this, and
    // making the scan wait on a screen would change when the next one is read.
    triggerDispatchService.handleEvent(event).catch((err) => {
      emit(barcodeLogger, 'warn', 'trigger.ingress.barcode.dispatch.failed', { error: errText(err) });
    });
    return { status: 'dispatched', effect: { value: event.value } };
  };

  // ---- school --------------------------------------------------------------
  // Gets `raw`, not `body`. `sch:r1:` is the published SchoolCalc result form;
  // every other `sch:` payload remains an opaque School console action token.
  // The distinction is made here, at composition, because the two products
  // share the household scanner namespace without coupling either application.
  const handleSchool = ({ raw, device }) => {
    if (raw.startsWith('sch:r1:')) {
      if (!schoolCalcResultImporter) {
        return { status: 'unwired', ok: false, message: 'SchoolCalc result ingress is not wired' };
      }
      Promise.resolve()
        .then(() => schoolCalcResultImporter.execute({ record: raw, transport: 'qr' }))
        .catch((err) => {
          emit(barcodeLogger, 'warn', 'barcode_relay.schoolcalc.result.failed', {
            device, error: errText(err),
          });
        });
      return { status: 'dispatched', effect: { transport: 'qr' } };
    }
    if (!schoolLifecycle?.handlesCode?.(raw) || typeof schoolLifecycle.handleScan !== 'function') {
      return { status: 'unwired', ok: false, message: 'school console is not wired' };
    }
    schoolLifecycle.handleScan({ code: raw, device })
      .catch((err) => {
        emit(barcodeLogger, 'warn', 'barcode_relay.school.dispatch.failed', {
          device, error: errText(err),
        });
      });
    return { status: 'dispatched' };
  };

  // ---- nutrition (the fridge sheet) ---------------------------------------
  // The DECISION lives in `routeNutribotScan` (pure, unit-tested) — this branch
  // only acts on it, because the version inlined in `app.mjs` had an untestable
  // hole: with nutriscan disabled it fell through and UPC-looked-up `dl:4`.
  const handleNutrition = ({ body, raw, device }) => {
    const scaleId = relayCfgFor(device).scale_id || null;
    // Not trimmed — `parseScan` trims. See the module docstring.
    const decision = routeNutribotScan({ scaleId, code: body, apply: applyScanToComposition });

    if (decision.action === 'nutriscan') {
      const { outcome } = decision;
      const refused = outcome.ok === false;
      emit(barcodeLogger, 'info', 'barcode_relay.nutriscan', {
        device, scaleId, kind: outcome.kind, ok: !refused, error: outcome.error || null,
      });
      const scale = getObservationService();

      // `rs:done` COMMITS; it does not arm, and it does not ACK.
      //
      // The card reads "the sequence is complete, process it now", and arming a
      // 25 s clock for it was the opposite of that: `ApplyScanToComposition` has
      // already consumed the slots by the time this branch runs, so the timer
      // fired against an empty composition and skipped as incomplete — the
      // explicit finish gesture was the one path that GUARANTEED a stranded entry
      // with no density. The pre-consumption snapshot rides on the outcome,
      // because by now the store has nothing left to read.
      //
      // No ACK refresh on this path, deliberately. `refreshPrompt` renders from a
      // FRESH store read, which for `done` is the composition that was just
      // consumed — so it would repaint the prompt with no tare and no density, and
      // `LogFoodFromScale` would PERSIST that un-tared weight for the commit to
      // then multiply. The commit re-renders the message itself once the density
      // applies, which is the ack the user is waiting for anyway.
      //
      // Fire-and-forget like the ACK it replaces: `commitNowFor` never rejects,
      // and the `.catch` covers a service that predates it.
      //
      // `!refused` FIRST, and the order is load-bearing. A refusal carries the parsed
      // kind, so a refused `rs:done` — the whole scale being unwired, say — matches this
      // branch on `kind` alone, commits nothing, and still returns `ok: true`. That is a
      // refused scan reported as applied, in the one gesture that means "process it now":
      // exactly the silent-success failure this subsystem exists to remove, and the last
      // place anyone would look for it. A refusal falls through to the ACK path below and
      // comes back `refused` like every other one.
      if (!refused && outcome.kind === 'done') {
        scale?.commitNowFor?.(scaleId, outcome.snapshot)?.catch?.(() => {});
        return { status: 'applied', ok: true, effect: outcome };
      }

      // ACK on the message the user is already looking at — INCLUDING a refusal,
      // which writes nothing to the buffer and so would otherwise render as no
      // change whatsoever. That silent failure is precisely what the ACK exists
      // to prevent, so the reason rides along as a transient notice.
      // Fire-and-forget: a failed edit must not swallow a scan that already
      // landed in the buffer.
      const notice = refused ? nutriscanRefusalNotice(outcome) : null;
      scale?.refreshPrompt?.(scaleId, notice)?.catch?.(() => {});
      // A fridge-sheet scan restarts the quiet-commit clock. Without
      // this the entry finalises 25s after the last WEIGHT, and a density or
      // tare scanned in the meantime lands on a log that is already closed —
      // the 12:31 incident, where a container arrived 4.4s behind its density.
      //
      // A REFUSED scan restarts it too, alongside the ACK above and for the same
      // reason: the person is mid-gesture and about to rescan, and the failure
      // directions are not symmetric. Restarting too eagerly only delays a
      // commit the next lull will make anyway; not restarting closes the entry
      // under the hand that was still filling it in.
      //
      // Fire-and-forget like the ACK: synchronous, optional, and never allowed
      // to swallow a scan that already reached the buffer.
      scale?.armCommitFor?.(scaleId);
      return { status: refused ? 'refused' : 'applied', ok: !refused, effect: outcome };
    }

    if (decision.action === 'swallow') {
      const event = NUTRISCAN_SWALLOW_EVENT[decision.reason] || 'barcode_relay.nutriscan.unavailable';
      // `raw`, not `body`: an operator reading this line wants the string that
      // was physically scanned. They are equal for every legacy code.
      // See `emitSampled`'s own docstring for why this is unconditional now.
      emitSampled(barcodeLogger, event, { device, code: raw }, { maxPerMinute: 6, aggregate: true });
      // ACK a refusal too. Without this the ONE path where nothing happened is
      // the one path that says nothing: the user gets a scanner beep, no change
      // on the prompt, and no way to tell a dead feature from a bad code.
      // Fire-and-forget, exactly like the nutriscan branch — a failed edit must
      // not turn a silent refusal into a thrown one.
      getObservationService()?.refreshPrompt?.(scaleId, swallowNotice(decision.reason))?.catch?.(() => {});
      return { status: 'swallowed', ok: false, message: decision.reason };
    }

    // `upc` — a code the fridge grammar does not claim. It reached the product
    // lookup inline before; now it cannot, because a NUTRITION namespace only
    // ever comes from a `nut:`/`dl:`/`ct:`/`rs:` code, and claim is not success.
    return { status: 'unclaimed', ok: false, message: 'not a fridge-sheet code' };
  };

  // ---- product (a bare UPC, claimed by the reader's route) ------------------
  const handleProduct = ({ body, raw, device }) => {
    const relayCfg = relayCfgFor(device);
    const userId = relayCfg.nutribot?.user_id
      || relayConfig.nutribot?.user_id
      || nutribotIdentity.defaultUserId()
      || null;

    if (!userId) {
      emit(barcodeLogger, 'warn', 'barcode_relay.nutribot.no_user', { device, code: raw });
      return { status: 'refused', ok: false, message: 'no nutribot user' };
    }

    // Derive the Telegram address the same way the scale->nutribot path does:
    // telegram:b<botId>_c<chatId>. The old fallback built "nutribot-upc:<userId>",
    // which TelegramAdapter.extractChatId() cannot parse — it was handed to the
    // Telegram API verbatim and rejected with 400, so scans reached UPCGateway and
    // then died silently at delivery. Deriving it also means a changed bot or
    // head-of-household stays correct without a config edit.
    const conversationId = relayCfg.nutribot?.conversation_id
      || relayConfig.nutribot?.conversation_id
      || nutribotIdentity.conversationIdFor(userId);

    if (!conversationId) {
      emit(barcodeLogger, 'warn', 'barcode_relay.nutribot.no_conversation', { device, code: raw, userId });
      return { status: 'refused', ok: false, message: 'no nutribot conversation' };
    }

    getLogFoodFromUPC().execute({
      userId, conversationId, upc: body, messageId: null,
    }).catch((err) => {
      emit(barcodeLogger, 'warn', 'barcode_relay.nutribot.dispatch.failed', { device, error: errText(err) });
    });
    return { status: 'logged', effect: { upc: body, conversationId } };
  };

  const buildHandlers = (ts) => {
    const trigger = makeTriggerHandler(ts);
    return [
      { namespace: 'content', handle: trigger },
      { namespace: 'command', handle: trigger },
      { namespace: 'school', handle: handleSchool },
      { namespace: 'nutrition', handle: handleNutrition },
      { namespace: 'product', handle: handleProduct },
    ];
  };

  // Boot-time checks. Both compare two halves that only exist together here.
  const probeHandlers = buildHandlers(null);
  assertRouteFallback(routeFallback, probeHandlers);
  const probe = new ScanDispatcher({ handlers: probeHandlers, routeFallback, logger });
  const screenCollisions = reportLeadingSegmentCollisions(screenNames, commandNames, barcodeLogger);

  /**
   * @param {{code?: string, device?: string, route?: string, ts?: string}} relay
   *   the payload `createBarcodeRelay` publishes, verbatim
   * @returns {Promise<object>} always resolves — see the dispatcher's invariant
   */
  function handleScan(relay = {}) {
    // Lifted verbatim: the relay always sets a route, but the reader's own config
    // and then `content` remain the fallbacks, and this value is what lands in
    // `meta.route` as well as what the step-5 lookup reads.
    const route = relay.route || relayCfgFor(relay.device).route || 'content';
    const dispatcher = new ScanDispatcher({
      handlers: buildHandlers(relay.ts), routeFallback, logger,
    });
    return dispatcher.dispatch({ code: relay.code, device: relay.device, route });
  }

  return { handleScan, namespaces: probe.namespaces, screenCollisions };
}

export default createScanDispatch;
