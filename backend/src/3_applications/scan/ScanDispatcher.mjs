/**
 * One scan in, one Outcome out — the layer that turns a parsed code into an
 * answer somebody can render.
 *
 * `ScanCode.parseScanCode` resolves a string to its owning namespace and stops
 * there, by design: it imports nothing and so cannot know which reader sent the
 * scan. This module supplies the missing step (5, the reader `route` fallback),
 * looks up the handler for whatever namespace comes out, and normalises the
 * answer. Handlers are INJECTED — nothing here knows what content, nutrition,
 * school or product actually do.
 *
 * ## THE INVARIANT: dispatch never falls through
 *
 * Every path returns an Outcome. `status: 'unknown'` is a real value, not an
 * absence, so a caller always has something to render — a scan that nobody
 * claims must still light up the screen, because a scanner that appears to do
 * NOTHING is indistinguishable from a broken scanner. The same rule covers a
 * handler that throws: the rejection is caught and becomes
 * `status: 'failed'` carrying the message. `dispatch` never rejects.
 *
 * The invariant covers the LOGGER too, which is easy to miss because it is not
 * part of the scan. An injected logger has a transport behind it and can fail;
 * if it does, the scan must still be answered. See `emit`, and note that the try
 * around the handler call deliberately contains nothing else.
 *
 * ## Claim is not success
 *
 * Once a handler has been reached, dispatch is OVER. A refusal is still a claim,
 * and the route fallback is NOT retried behind it. This generalises nutrition's
 * existing `handled`-not-`ok` rule (see `routeNutribotScan`, where consulting
 * `ok` instead of `handled` would have sent a fridge-sheet code to a product
 * database). A typo'd `ct:teapot` is unmistakably a fridge-sheet code, so it must
 * be REFUSED rather than passed on to a product lookup that would answer a typo
 * with a nonsense food. Re-entering resolution after a claim is exactly how one
 * printed code comes to mean two different things depending on which reader read
 * it.
 *
 * So the resolution ladder has exactly ONE rung of fallback, and it is consumed
 * before any handler runs: parse first, reader route second, unknown third.
 *
 * ## Handler contract
 *
 * A handler receives the whole parse result plus `device` and `route`:
 * `{ namespace, body, raw, form, device, route }`. It gets `raw` as well as
 * `body` because school's token registry looks tokens up by the full
 * `sch:<body>` string; the object is freshly built per dispatch, so a handler
 * that mutates its argument cannot affect anything else.
 *
 * A handler returns a PARTIAL Outcome, merged over the defaults. It may not
 * override `domain` — see `dispatch` — and anything that is not a plain object
 * (including `undefined`, which is what an `async` function with no `return`
 * produces) is treated as "no fields", leaving the defaults intact.
 *
 * Field VALUES are otherwise not validated, deliberately. `status` is free-form
 * per domain, so there is no schema to check it against, and `physical` is
 * checked by the handler that sets it (assert against `PHYSICAL_KINDS`) rather
 * than here — validating it twice would put the contract in two places and let
 * them drift. The exposure is narrow because the two fields a generic caller
 * steers on, `domain` and `ok`, are BOTH dispatcher-controlled: `domain` is
 * assigned here and cannot be spoofed, and `ok` has a default so a silent
 * handler cannot fake a refusal. An out-of-contract `physical` therefore
 * degrades which paper comes out; it cannot cost the user their feedback.
 * What is guarded here is only what the never-fall-through invariant depends
 * on: that an Outcome always EXISTS, always carries these seven keys, and is
 * always attributed to the handler that produced it.
 *
 * KNOWN GAP — a handler that never settles hangs the dispatch forever, and there
 * is NO TIMEOUT. Handler liveness is the handler's own responsibility. This is a
 * deliberate omission, not an oversight: today's `app.mjs` fires and forgets with
 * no timeout either, so adding one would be a behaviour change in a phase whose
 * criterion is zero behaviour change, and choosing a duration is a policy call
 * that needs real handlers in front of it (school prints paper and is slow;
 * content flips a relay and is not). Revisit in Phase 2, once the four handlers
 * exist and their latencies are known.
 *
 * KNOWN, DELIBERATE, and not this module's to fix: `body` is not trimmed, so
 * `go: living-room:plex:1` hands the handler a body with a LEADING SPACE (the
 * outer `trim()` cannot reach it once the tag is stripped). A handler that
 * splits on `:` must trim its own segments. See the `Body convention` note in
 * ScanCode. Dispatch passes `body` through verbatim and must keep doing so —
 * trimming here would silently change what `go:` means for every domain at once.
 *
 * @module scan/ScanDispatcher
 */

import { parseScanCode } from '#domains/scan/ScanCode.mjs';

/**
 * The uniform answer shape, whatever the domain.
 *
 * - `status`   — free-form per domain (`ok`, `logged`, `refused`, …). Only
 *                `unknown` and `failed` are produced HERE.
 * - `ok`       — did the scan do what it was for? The ONLY field a generic
 *                caller can read, and the reason it exists: `status` is each
 *                domain's private vocabulary, so composition cannot tell
 *                `refused` from `logged` without knowing all four grammars.
 *                Defaults TRUE, so a handler that refuses must SAY so — the
 *                alternative defaults every careless handler to "refused" and
 *                makes diligence indistinguishable from luck. The dispatcher's
 *                own non-success outcomes (`unknown`, `failed`) set it false.
 *                `ok === false` is therefore the generic refusal test.
 * - `domain`   — who handled it, or who WOULD have owned it when nothing is
 *                registered. Null only when nothing claimed the code at all.
 * - `physical` — `'worksheet' | 'receipt' | 'none'`. School prints paper;
 *                everything else is `'none'`.
 * - `printed`  — whether paper actually came out, which is not the same as
 *                having asked for it.
 * - `effect`   — domain-specific payload for the caller to act on.
 *
 * These seven keys are ALWAYS present. A handler may add its own on top — that
 * is what keeps `effect` a convention rather than a cage — so the key set is a
 * guaranteed minimum, not a closed list.
 */
const OUTCOME_DEFAULTS = Object.freeze({
  status: 'unknown',
  ok: true,
  domain: null,
  message: '',
  physical: 'none',
  printed: false,
  effect: null,
});

/** Every `physical` value an Outcome may carry. Exported so handlers can be tested against it. */
export const PHYSICAL_KINDS = Object.freeze(['worksheet', 'receipt', 'none']);

const outcome = (over = {}) => ({ ...OUTCOME_DEFAULTS, ...over });

/**
 * A handler's return value is untrusted input from another module. Arrays and
 * strings both spread into an object literal (a string spreads to
 * `{0:'a',1:'b'}`), so `typeof === 'object'` alone is not enough — an accidental
 * `return 'ok'` would otherwise decorate the Outcome with numeric keys instead of
 * being ignored. Null-prototype objects must still pass, since a handler is free
 * to build one.
 */
function isMergeableObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copy own string keys into a null-prototype map.
 *
 * The route fallback is indexed by a value that ultimately comes from device
 * config, and `Object.prototype` is inherited by every object literal — a caller
 * passing `{ nutribot: 'nutrition' }` would ALSO answer to `route: 'constructor'`
 * with a Function, and `route: '__proto__'` with an object. That is the exact bug
 * the prefix registry in `ScanCode` had to be hardened against; the fix travels
 * with the pattern, not with the file. Dropping the prototype here means an
 * unregistered route reads `undefined` and lands on `unknown`, which is the
 * declared behaviour.
 *
 * Values are checked too: a config typo like `{ nutribot: null }` must read as
 * "no fallback" rather than propagate a non-string namespace into the handler
 * lookup.
 */
function toRouteMap(routeFallback) {
  const map = Object.create(null);
  if (!isMergeableObject(routeFallback)) return map;
  for (const [route, namespace] of Object.entries(routeFallback)) {
    if (typeof namespace === 'string' && namespace) map[route] = namespace;
  }
  return map;
}

/**
 * Best-effort structured log. A caller may inject a partial logger, no logger,
 * or one that is BROKEN — and those are three different problems.
 *
 * The `typeof` check only proves a method exists, not that it works. Composition
 * injects a real structured logger with a transport behind it, and a transport
 * can fail: a full disk, a closed socket, a serialiser choking on a circular
 * reference in the data. So the call is wrapped as well as guarded.
 *
 * This try/catch is the ONLY thing holding the invariant against a logger fault,
 * and it is load-bearing on every path: the `warn` calls in `dispatch` sit
 * outside any try, and the `debug` and `error` calls sit inside blocks whose
 * catch routes to `#failed` — which logs again. Splitting the tries in
 * `dispatch` does NOT provide a second line of defence here; it changes which
 * catch would mislabel the scan, not whether one does. Unwrap this and a
 * successful scan whose `debug` emit fails is reported as
 * `{status:'failed', message:'logger down'}`, which is worse than a rejection
 * because it is plausible.
 *
 * The `typeof` guard is therefore belt-and-braces rather than load-bearing —
 * this catch subsumes it — and is kept only because a missing method is an
 * ordinary, expected shape (a partial logger) rather than a fault.
 *
 * SWALLOWED SILENTLY, deliberately. There is no fallback log and no rethrow: a
 * logger that just threw is not a logger you can report to, and `console` may be
 * the very thing that failed. Observability is the one thing a dispatcher may
 * lose without failing the scan — a person is standing at a scanner waiting for
 * an answer, and "the log sink was down" is not an answer.
 */
/**
 * The default logger: silent by CHOICE. `console` was the obvious default and
 * the wrong one — it is precisely what masks the failure mode above, since
 * Node's console swallows write errors, and CLAUDE.md rules out raw console for
 * diagnostics. Composition injects the real structured logger (Task 6); until
 * it does, a dispatcher with no logger should say nothing rather than scribble
 * on stdout from inside a domain module.
 */
const NO_LOGGER = Object.freeze({});

function emit(logger, level, event, data) {
  try {
    if (typeof logger?.[level] === 'function') logger[level](event, data);
  } catch {
    // Intentionally empty — see above.
  }
}

export class ScanDispatcher {
  #handlers;

  #routeFallback;

  #logger;

  /**
   * @param {object} deps
   * @param {Array<{namespace: string, handle: (args: object) => Promise<object>}>} deps.handlers
   * @param {Record<string, string>} deps.routeFallback  reader route -> namespace
   * @param {{debug?: Function, info?: Function, warn?: Function, error?: Function}} deps.logger
   */
  constructor({ handlers = [], routeFallback = {}, logger = NO_LOGGER } = {}) {
    this.#handlers = new Map();
    // Before the for-of, or a composition-root typo surfaces as a bare
    // `handlers is not iterable` and reads like an internal fault. Every other
    // registration error here names this class; this one must too.
    if (!Array.isArray(handlers))
      throw new TypeError('ScanDispatcher: `handlers` must be an array');
    for (const handler of handlers) {
      // Fail at CONSTRUCTION, not at scan time. A malformed or duplicated
      // registration is a wiring bug in the composition root; discovering it
      // when somebody scans a sticker means the failure surfaces as a mystery
      // `unknown` on a kiosk, hours later and far from its cause. Duplicates in
      // particular would otherwise be silent last-wins: two handlers both
      // claiming `nutrition` is never intentional.
      if (typeof handler?.namespace !== 'string' || !handler.namespace)
        throw new TypeError('ScanDispatcher: every handler needs a non-empty string namespace');
      if (typeof handler.handle !== 'function')
        throw new TypeError(`ScanDispatcher: handler "${handler.namespace}" has no handle()`);
      if (this.#handlers.has(handler.namespace))
        throw new Error(`ScanDispatcher: duplicate handler for namespace "${handler.namespace}"`);
      this.#handlers.set(handler.namespace, handler);
    }
    this.#routeFallback = toRouteMap(routeFallback);
    this.#logger = logger;
  }

  /** The namespaces this dispatcher can serve. Ordered as registered. */
  get namespaces() {
    return [...this.#handlers.keys()];
  }

  /**
   * @param {object} input
   * @param {unknown} input.code    raw scanned payload
   * @param {string|null} input.device  reader that produced the scan
   * @param {string|null} input.route   reader's configured route, for the step-5 fallback
   * @returns {Promise<typeof OUTCOME_DEFAULTS>} Resolves for ANY `code` value —
   *   any type, any shape, claimed or not — and for any handler behaviour,
   *   including one that throws or returns something unreadable. NOT guaranteed
   *   against a hostile `input` OBJECT: `dispatch({ get code() { throw } })`
   *   rejects, and deliberately is not guarded. The caller is composition, which
   *   is trusted code in this repo; the scanned payload is the untrusted input,
   *   and that is what the guarantee covers.
   */
  async dispatch({ code, device = null, route = null } = {}) {
    const parsed = parseScanCode(code);

    // Step 5. Only consulted when the CODE ITSELF says nothing — a code that
    // named its owner is never overridden by the reader it happened to be
    // scanned on, or the same sticker would mean different things in different
    // rooms. `route` is untrusted enough to type-check: a non-string key would
    // stringify into the lookup.
    const routed = typeof route === 'string' ? this.#routeFallback[route] : undefined;
    const namespace = parsed.namespace ?? routed ?? null;

    if (!namespace) {
      emit(this.#logger, 'warn', 'scan-unclaimed', { raw: parsed.raw, device, route });
      return outcome({ ok: false, message: `unrecognised scan "${parsed.raw}"` });
    }

    const handler = this.#handlers.get(namespace);
    if (!handler) {
      // `domain` is set even though nothing ran: it is what makes this case
      // distinguishable from "nothing claimed the code" without parsing the
      // message. `status: 'unknown'` with a domain reads as "this is a school
      // code and school is not wired up here".
      emit(this.#logger, 'warn', 'scan-no-handler', { namespace, raw: parsed.raw, device, route });
      return outcome({
        ok: false, domain: namespace, message: `no handler registered for "${namespace}"`,
      });
    }

    // TWO guarded steps, not one, because calling the handler and READING what
    // it returned can fail independently — and neither may reject.
    //
    // The first try wraps the call and NOTHING ELSE, so that ATTRIBUTION stays
    // honest: "the handler threw" and "the handler's result could not be read"
    // are different faults and are caught in different places. The split is NOT
    // a second line of defence against a logger fault — both catches route to
    // `#failed`, which logs — so it changes which catch would mislabel a scan,
    // not whether one does. `emit`'s own try/catch is the only thing that
    // prevents that; see its docstring.
    let result;
    try {
      result = await handler.handle({ ...parsed, device, route });
    } catch (err) {
      return this.#failed(namespace, err, { raw: parsed.raw, device, route });
    }

    // The second try wraps reading the result. A spread INVOKES GETTERS, so a
    // handler returning `{ get status() { throw } }` explodes at the return
    // statement — after the first try has closed. Still a handler fault: its own
    // return value is what could not be read, so `failed` is the honest answer.
    try {
      // `domain` is applied AFTER the spread, so a handler cannot report itself
      // as another domain. Everything else it returns wins over the defaults;
      // attribution does not.
      const merged = outcome({ ...(isMergeableObject(result) ? result : {}), domain: namespace });
      // Read `status` off the MERGED plain object, never off `result` — the
      // spread has already materialised every getter exactly once, so this
      // cannot re-enter hostile code, and a logger fault cannot be blamed on
      // the handler.
      emit(this.#logger, 'debug', 'scan-handled', {
        namespace, form: parsed.form, status: merged.status, device,
      });
      return merged;
    } catch (err) {
      return this.#failed(namespace, err, { raw: parsed.raw, device, route });
    }
  }

  /**
   * The one way a handler fault becomes an Outcome. Logs, then returns; never throws.
   *
   * This runs FROM the catch blocks, so it sits outside every try — nothing above
   * can save it, and `emit`'s internal catch does not cover the DATA OBJECT built
   * in this frame. A thrown value crosses the same trust boundary as a returned
   * one and gets the same treatment: `{ get message() { throw } }` and a hostile
   * proxy are as real here as `{ get status() { throw } }` was there.
   *
   * So `message` is read EXACTLY ONCE, defensively, before anything else can
   * touch it — one read that cannot escape, reused for both the log and the
   * Outcome. Reading it twice was the bug: each read is a fresh chance to throw.
   * `String()` because a thrown value need not carry a string message.
   */
  #failed(namespace, err, context) {
    let message = '';
    try {
      message = String(err?.message ?? '');
    } catch {
      // Unreadable — fall through to the generic message below.
    }
    // The invariant's last mile: a throwing handler becomes a renderable
    // failure, never a rejected promise the caller has to remember to catch.
    emit(this.#logger, 'error', 'scan-handler-threw', {
      namespace, ...context, error: message,
    });
    return outcome({
      status: 'failed',
      ok: false,
      domain: namespace,
      message: message || `scan handler "${namespace}" failed`,
    });
  }
}

export default ScanDispatcher;
