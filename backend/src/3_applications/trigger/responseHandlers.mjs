/**
 * Open response-handler registry. Generalizes actionHandlers: dispatch by
 * Response.kind. deps = { wakeAndLoadService, deviceService, haGateway }.
 *
 * Layer: APPLICATION (3_applications/trigger).
 *
 * @module applications/trigger/responseHandlers
 */
import { randomUUID } from 'node:crypto';

export class UnknownResponseKindError extends Error {
  constructor(kind) {
    super(`Unknown response kind: ${kind}`);
    this.name = 'UnknownResponseKindError';
    this.kind = kind;
  }
}

function buildContentQuery(expression) {
  const { action, contentId, options } = expression;
  if (action === 'play-next') {
    return { ...(options || {}), 'play-next': contentId, op: 'play-next' };
  }
  return { ...(options || {}), [action]: contentId };
}

function buildLoadOptions(response, suppressEnd = false) {
  const opts = { dispatchId: response.dispatchId || randomUUID() };
  if (response.end && !suppressEnd) {
    opts.endBehavior = response.end;
    if (response.endLocation) opts.endLocation = response.endLocation;
  }
  return opts;
}

export const responseHandlers = {
  // Content: authoritative goes straight to wake-and-load. Optimistic posture
  // (broadcast + ack + fallback) is provided by an injected contentDispatcher
  // in Plan 3; absent that, fall back to authoritative (real behavior).
  content: async (response, deps) => {
    // First refusal on a content dispatch. The reading session uses this to
    // claim a book tap at a location where a child has a session open, so the
    // screen can confirm the pick before anything plays.
    //
    // A THROWING INTERCEPTOR NEVER EATS THE TAP. It is logged and skipped, and
    // the book plays as it always did — the failure mode of this seam must be
    // "the old behaviour", never "the TV does nothing".
    //
    // That contract is only as strong as the code OUTSIDE the try, which is
    // where the learner handler leaked twice before: at the logger. So both
    // log calls are individually guarded, and a throw with no `.message` (a
    // bare string, `null`) still yields a string.
    //
    // It sits ABOVE the posture branch on purpose: a reader configured
    // `optimistic` must be claimable too, or it silently opts out.
    const log = (level, event, data) => {
      try { deps.logger?.[level]?.(event, data); } catch { /* the tap outranks the log line */ }
    };
    for (const interceptor of deps.contentInterceptors ?? []) {
      try {
        const claim = await interceptor?.claim?.(response);
        if (claim?.claimed) {
          log('info', 'trigger.content.claimed', {
            by: claim.by ?? null,
            target: response.target,
            location: response.location ?? null,
            contentId: response.expression?.contentId,
          });
          return claim;
        }
      } catch (err) {
        log('warn', 'trigger.content.interceptor_failed', {
          error: err?.message ?? String(err),
          target: response.target,
          location: response.location ?? null,
        });
      }
    }

    // D8 — THE SECOND HALF OF THE SEAM, AND A LIVE HAZARD IF IT IS MISSING.
    // The `livingroom` source declares `end: tv-off`. That flows as
    // `endBehavior` into the content query (`WakeAndLoadService.mjs:275`) and
    // `sideEffectHandlers['tv-off']` powers the TV off the moment the content
    // ends — which, while a reading session is open, is before the ceremony
    // can render and with a child still standing at the reader.
    //
    // SUPPRESSION IS SEPARATE FROM CLAIMING BECAUSE THE TAPS THAT NEED IT ARE
    // THE ONES NOBODY CLAIMED: a browsing-mode second book, and a mid-story tap
    // whose obligation could not be read. Those dispatch normally — they just
    // must not take the room's lights with them when they finish.
    //
    // FAILURE LEANS THE OTHER WAY FROM `claim`. A throwing `claim` falls back
    // to "the book plays"; a throwing `suppressEnd` falls back to "the end
    // behaviour stands", because that is the configured behaviour and a guard
    // nobody can evaluate must not silently rewrite what the YAML says.
    let suppressEnd = false;
    if (response.end) {
      for (const interceptor of deps.contentInterceptors ?? []) {
        try {
          if (interceptor?.suppressEnd?.(response) === true) { suppressEnd = true; break; }
        } catch (err) {
          log('warn', 'trigger.content.suppress_end_failed', {
            error: err?.message ?? String(err),
            target: response.target,
            location: response.location ?? null,
          });
        }
      }
      if (suppressEnd) {
        log('info', 'trigger.content.end_suppressed', {
          end: response.end, target: response.target, location: response.location ?? null,
        });
      }
    }

    const query = buildContentQuery(response.expression);
    const loadOptions = buildLoadOptions(response, suppressEnd);
    if (response.posture === 'optimistic' && deps.contentDispatcher?.optimistic) {
      return deps.contentDispatcher.optimistic(response.target, query, loadOptions);
    }
    return deps.wakeAndLoadService.execute(response.target, query, loadOptions);
  },

  device: async (response, deps) => {
    const device = deps.deviceService.get(response.target);
    if (!device) throw new Error(`Unknown target device: ${response.target}`);
    if (response.op === 'clear') return device.clearContent();
    if (!response.path) throw new Error('device open requires a path');
    return device.loadContent(response.path, response.params || {});
  },

  ha: async (response, deps) => {
    if (response.op === 'scene') {
      return deps.haGateway.callService('scene', 'turn_on', { entity_id: response.scene });
    }
    const [domain, service] = String(response.service || '').split('.');
    if (!domain || !service) throw new Error(`Invalid ha service: ${response.service}`);
    const data = { ...(response.data || {}) };
    if (response.entity) data.entity_id = response.entity;
    return deps.haGateway.callService(domain, service, data);
  },

  transport: async (response, deps) => {
    const payload = deps.commandResolver?.(response.command, response.arg);
    if (!payload) {
      deps.logger?.warn?.('trigger.transport.unknown', { command: response.command, target: response.target });
      return;
    }
    return deps.screenBroadcast?.(response.target, payload);
  },

  script: async (response, deps) => {
    if (!deps.endpointGateway?.call) {
      deps.logger?.warn?.('trigger.script.no_gateway', { ref: response.ref });
      return;
    }
    return deps.endpointGateway.call(response.ref, response.params);
  },

  // A tap that named a person. NEVER REJECTS: a card tap that throws must still
  // answer the dispatcher, or a child gets silence and taps harder — which is
  // the exact behaviour every cooldown and debounce in this pipeline exists to
  // stop. An unregistered op is refused BY NAME and logged with its reader, so
  // an action configured before its handler shipped is findable in the log
  // rather than doing some other action's job.
  //
  // That contract is only as strong as the code OUTSIDE the try, which is
  // exactly where it has leaked in this codebase before: at the logger, and at
  // a lookup sitting above the guarded block. So every log call is individually
  // guarded, the registry lookup happens INSIDE the try, and a throw with no
  // `.message` (a bare string, `null`) still yields a string.
  learner: async (response, deps) => {
    const ctx = { op: response.op, learnerId: response.learnerId, location: response.location };
    // A broken log transport must not become a broken tap. Never let a logger
    // decide whether a child's card worked.
    const log = (level, event, data) => {
      try { deps.logger?.[level]?.(event, data); } catch { /* the tap outranks the log line */ }
    };
    try {
      const handler = deps.learnerActions?.get?.(response.op) ?? null;
      if (!handler) {
        let registered = null;
        try { registered = deps.learnerActions?.list?.() ?? null; } catch { registered = null; }
        log('warn', 'trigger.learner.no_handler', { ...ctx, registered });
        // Not retryable: an op with no owner has no owner on the second tap
        // either, so a retry would only burn another tap on the same refusal.
        return { status: 'no_handler', op: response.op, learnerId: response.learnerId };
      }
      const result = await handler({
        learnerId: response.learnerId, location: response.location, target: response.target,
      });
      log('info', 'trigger.learner.dispatched', { ...ctx, status: result?.status ?? null });
      return result ?? { status: 'ok' };
    } catch (err) {
      const error = err?.message ?? String(err);
      log('error', 'trigger.learner.failed', { ...ctx, error });
      // `retryable` is how a handler that ANSWERS instead of throwing tells the
      // dispatcher to release the debounce. The dispatcher's retry path hangs
      // off a thrown error, which this handler can never reach by design — so
      // without this flag a failed tap would lock the child out for 30s while
      // the receipt in their hand says to scan again.
      return { status: 'failed', op: response.op, error, retryable: true };
    }
  },
};

export async function dispatchResponse(response, deps) {
  const handler = responseHandlers[response.kind];
  if (!handler) throw new UnknownResponseKindError(response.kind);
  return handler(response, deps);
}

export default { responseHandlers, dispatchResponse, UnknownResponseKindError };
