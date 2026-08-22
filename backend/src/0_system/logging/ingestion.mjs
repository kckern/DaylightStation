/**
 * Log Ingestion Service
 *
 * Processes incoming log events from frontend clients via WebSocket or HTTP.
 */

import { getDispatcher, isLoggingInitialized } from './dispatcher.mjs';
import { formatLocalTimestamp } from './localTimestamp.mjs';
import { getSessionFileTransport } from './transports/sessionFile.mjs';
import { getSessionEventsFileTransport } from './transports/sessionEventsFile.mjs';

/**
 * Predicate: is this a full-fidelity input-telemetry event?
 * Input-channel events bypass the semantic dispatcher and session-file entirely,
 * routing straight to the .events stream transport.
 */
export function isInputChannel(event) { return event?.context?.channel === 'input'; }



/**
 * Process incoming log events from frontend
 * @param {Object} payload - WebSocket or HTTP message payload
 * @param {Object} clientMeta - Client metadata { ip?, userAgent? }
 * @param {Object} [hooks]
 * @param {(normalized: Object) => void} [hooks.onEvent] - called once per
 *   normalized event (the same `{event, data, context, ...}` shape the
 *   dispatcher receives), for EVERY event including input-channel telemetry —
 *   BEFORE dispatch/session-file writes. Additive, optional, never throws the
 *   caller: a throwing hook is caught and logged, never lets a presence
 *   observer (e.g. `FitnessPresenceTracker.observe`, composed in
 *   `5_composition/modules/donow.mjs`) take down log ingestion. There is no
 *   per-event-name hook registry here — `ingestFrontendLogs` has exactly one
 *   call site (`app.mjs`'s WS message handler), so a single caller-supplied
 *   hook is enough; a second consumer can fan out from there.
 * @returns {number} Number of events processed
 */
export function ingestFrontendLogs(payload, clientMeta = {}, hooks = {}) {
  if (!isLoggingInitialized()) {
    process.stderr.write('[LogIngestion] Dispatcher not initialized, dropping events\n');
    return 0;
  }

  const { onEvent } = hooks;
  const dispatcher = getDispatcher();
  const events = normalizePayload(payload);

  let processed = 0;
  for (const event of events) {
    const normalized = normalizeEvent(event, clientMeta);
    if (normalized) {
      if (typeof onEvent === 'function') {
        try {
          onEvent(normalized);
        } catch (err) {
          process.stderr.write(`[LogIngestion] onEvent hook threw: ${err?.message || err}\n`);
        }
      }

      // Input-channel telemetry bypasses the semantic pipeline (dispatcher +
      // session-file) and routes straight to the .events stream transport.
      if (isInputChannel(normalized)) {
        const eft = getSessionEventsFileTransport();
        if (eft) eft.write(normalized);
        processed++;
        continue;
      }

      dispatcher.dispatch(normalized);

      // Write to session file if sessionLog flag is set
      const sft = getSessionFileTransport();
      if (sft && normalized.context?.sessionLog) {
        sft.write(normalized);
      }

      processed++;
    }
  }

  return processed;
}

function normalizePayload(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.events)) {
    return payload.events.map(unwrapEvent);
  }

  if (payload.topic === 'logging' && Array.isArray(payload.events)) {
    return payload.events.map(unwrapEvent);
  }

  if (payload.source === 'playback-logger') {
    return [unwrapPlaybackLoggerEvent(payload)];
  }

  if (payload.event && typeof payload.event === 'object') {
    return [unwrapEvent(payload)];
  }

  if (typeof payload.event === 'string') {
    return [payload];
  }

  return [payload];
}

function unwrapEvent(wrapper) {
  if (!wrapper) return wrapper;

  if (wrapper.event && typeof wrapper.event === 'object' && wrapper.event.event) {
    return { ...wrapper, ...wrapper.event };
  }

  return wrapper;
}

function unwrapPlaybackLoggerEvent(payload) {
  return {
    ts: payload.timestamp || payload.ts,
    level: payload.level || 'info',
    event: payload.event,
    data: payload.payload || payload.data || {},
    context: {
      ...payload.context,
      channel: 'playback'
    },
    tags: payload.tags || []
  };
}

function normalizeEvent(event, clientMeta = {}) {
  if (!event) return null;

  const eventName = typeof event.event === 'string' && event.event.length > 0
    ? event.event
    : 'frontend.unknown';

  return {
    ts: event.ts || event.timestamp || formatLocalTimestamp(),
    level: normalizeLevel(event.level),
    event: eventName,
    message: event.message,
    data: event.data || event.payload || {},
    context: {
      source: 'frontend',
      app: event.context?.app || event.context?.logger || 'frontend',
      ...event.context,
      ip: clientMeta.ip,
      userAgent: clientMeta.userAgent
    },
    tags: event.tags || []
  };
}

function normalizeLevel(level) {
  const normalized = String(level || 'info').toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(normalized)) {
    return normalized;
  }
  return 'info';
}

export default ingestFrontendLogs;
