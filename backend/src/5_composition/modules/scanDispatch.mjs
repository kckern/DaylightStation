/**
 * scanDispatch — binds the house's scan domains to the shared `ScanDispatcher`.
 *
 * This file is a LIFT, not a rewrite. Every branch below used to sit inline in
 * the `onScan` callback `app.mjs` handed to `createBarcodeRelay`; the routing
 * DECISION has moved into the vocabulary (`ScanCode` + `ScanDispatcher`) and
 * what is left here is the four domain entry points, unchanged, plus the
 * composition-only checks that only this layer can make. The comments that
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
 * The alternative — one dispatcher plus a "current scan" variable set immediately
 * before `dispatch()` — happens to work today only because `dispatch` reaches the
 * handler with no intervening `await`. That is an invariant of a file this module
 * does not own, and a future `await` in front of the handler call would corrupt
 * the timestamp silently. Constructing a Map of five handlers is measured in
 * microseconds and scans are human-paced, so the cheap thing here is also the
 * correct one.
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

import { ScanDispatcher } from '#apps/scan/ScanDispatcher.mjs';
import { PREFIX_REGISTRY, LEGACY_NUTRITION_TAGS } from '#domains/scan/ScanCode.mjs';
import { KNOWN_COMMANDS } from '#domains/barcode/BarcodeCommandMap.mjs';
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';
import { routeNutribotScan, nutriscanRefusalNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';

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

/** Startup-decided swallow reasons, reported once each. Lifted from `app.mjs`. */
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
  const leading = [
    ...(Array.isArray(screenNames) ? screenNames : []),
    ...(Array.isArray(commandNames) ? commandNames : []),
  ];
  const collisions = [...new Set(
    leading.filter((name) => typeof name === 'string' && tags.has(name)),
  )];
  if (collisions.length > 0) {
    logger?.error?.('scan.leading_segment.shadows_tag', {
      names: collisions,
      hint: 'rename it; a `<screen|command>:...` code named after a scan tag loses that segment',
    });
  }
  return collisions;
}

/**
 * @param {object} deps
 * @param {{handlesCode: Function, handleScan: Function|null}} deps.schoolLifecycle
 * @param {{handleEvent: Function}} deps.triggerDispatchService
 * @param {Record<string, object>} [deps.relayInstances]  `relays:` block from barcode-relay.yml
 * @param {object} [deps.relayConfig]                     the whole barcode-relay app config
 * @param {{execute: Function}|null} [deps.applyScanToComposition]  null when nutriscan is disabled
 * @param {() => ({refreshPrompt?: Function}|null)} [deps.getScaleNutribotBridge]  LATE-BOUND — the
 *   bridge is constructed long after this module and only exists if the head of household and bot
 *   id resolve, so it is read at scan time, never captured.
 * @param {() => ({execute: Function})} [deps.getLogFoodFromUPC]  late-bound for the same reason:
 *   `nutribotServices` is built further down `app.mjs` than the relay wiring.
 * @param {object} deps.configService
 * @param {object} deps.userIdentityService
 * @param {string[]} [deps.screenNames]   configured screen names, for the collision check
 * @param {object} deps.logger            STRUCTURED logger for the dispatcher itself
 * @param {object} deps.barcodeLogger     the channel the lifted branches already logged on; keeping
 *   it is what keeps every existing event name and payload byte-identical
 * @param {Record<string,string>} [deps.routeFallback]
 * @returns {{handleScan: (relay: object) => Promise<object>, namespaces: string[],
 *            screenCollisions: string[]}}
 */
export function createScanDispatch({
  schoolLifecycle,
  triggerDispatchService,
  relayInstances = {},
  relayConfig = {},
  applyScanToComposition = null,
  getScaleNutribotBridge = () => null,
  getLogFoodFromUPC = () => null,
  configService,
  userIdentityService,
  screenNames = [],
  // Defaulted rather than injected by `app.mjs`: this is a closed set in code,
  // not config. It is a PARAMETER only so the collision check can be driven with
  // a colliding name — an unfalsifiable guard is not a guard.
  commandNames = KNOWN_COMMANDS,
  logger,
  barcodeLogger,
  routeFallback = SCAN_ROUTE_FALLBACK,
} = {}) {
  // Per-PROCESS, keyed by reason — exactly as the `let` in `app.mjs` was. Both
  // swallow reasons are decided at STARTUP (a broken scales.yml, or a reader
  // deliberately configured without a scale), so warning per scan buried the log
  // without adding information.
  const nutriscanWarned = new Set();

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
      barcodeLogger?.warn?.('trigger.ingress.barcode.dispatch.failed', { error: err.message });
    });
    return { status: 'dispatched', effect: { value: event.value } };
  };

  // ---- school --------------------------------------------------------------
  // Gets `raw`, not `body`: the token registry looks tokens up by the full
  // `sch:<body>` string.
  const handleSchool = ({ raw, device }) => {
    if (!schoolLifecycle?.handlesCode?.(raw) || typeof schoolLifecycle.handleScan !== 'function') {
      return { status: 'unwired', ok: false, message: 'school console is not wired' };
    }
    schoolLifecycle.handleScan({ code: raw, device })
      .catch((err) => {
        barcodeLogger?.warn?.('barcode_relay.school.dispatch.failed', {
          device, error: err.message,
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
      barcodeLogger?.info?.('barcode_relay.nutriscan', {
        device, scaleId, kind: outcome.kind, ok: !refused, error: outcome.error || null,
      });
      // ACK on the message the user is already looking at — INCLUDING a refusal,
      // which writes nothing to the buffer and so would otherwise render as no
      // change whatsoever. That silent failure is precisely what the ACK exists
      // to prevent, so the reason rides along as a transient notice.
      // Fire-and-forget: a failed edit must not swallow a scan that already
      // landed in the buffer.
      const notice = refused ? nutriscanRefusalNotice(outcome) : null;
      getScaleNutribotBridge()?.refreshPrompt?.(scaleId, notice)?.catch?.(() => {});
      return { status: refused ? 'refused' : 'applied', ok: !refused, effect: outcome };
    }

    if (decision.action === 'swallow') {
      const event = NUTRISCAN_SWALLOW_EVENT[decision.reason] || 'barcode_relay.nutriscan.unavailable';
      // `raw`, not `body`: an operator reading this line wants the string that
      // was physically scanned. They are equal for every legacy code.
      if (nutriscanWarned.has(decision.reason)) {
        barcodeLogger?.debug?.(event, { device, code: raw });
      } else {
        nutriscanWarned.add(decision.reason);
        barcodeLogger?.warn?.(event, {
          device, code: raw, hint: 'further occurrences log at debug',
        });
      }
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
      || configService?.getHeadOfHousehold?.()
      || null;

    if (!userId) {
      barcodeLogger?.warn?.('barcode_relay.nutribot.no_user', { device, code: raw });
      return { status: 'refused', ok: false, message: 'no nutribot user' };
    }

    // Derive the Telegram address the same way the scale->nutribot bridge does:
    // telegram:b<botId>_c<chatId>. The old fallback built "nutribot-upc:<userId>",
    // which TelegramAdapter.extractChatId() cannot parse — it was handed to the
    // Telegram API verbatim and rejected with 400, so scans reached UPCGateway and
    // then died silently at delivery. Deriving it also means a changed bot or
    // head-of-household stays correct without a config edit.
    const resolveNutribotConversationId = () => {
      const botId = configService?.getSystemConfig?.('bots')?.nutribot?.telegram?.bot_id || '';
      const platformId = userIdentityService?.resolvePlatformId?.('telegram', userId);
      return botId && platformId ? `telegram:b${botId}_c${platformId}` : null;
    };

    const conversationId = relayCfg.nutribot?.conversation_id
      || relayConfig.nutribot?.conversation_id
      || resolveNutribotConversationId();

    if (!conversationId) {
      barcodeLogger?.warn?.('barcode_relay.nutribot.no_conversation', { device, code: raw, userId });
      return { status: 'refused', ok: false, message: 'no nutribot conversation' };
    }

    getLogFoodFromUPC().execute({
      userId, conversationId, upc: body, messageId: null,
    }).catch((err) => {
      barcodeLogger?.warn?.('barcode_relay.nutribot.dispatch.failed', { device, error: err.message });
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
