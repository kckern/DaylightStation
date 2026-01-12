/**
 * Log Ingestion Service
 *
 * Processes incoming log events from frontend clients via WebSocket or HTTP.
 */

import { getDispatcher, isLoggingInitialized } from './dispatcher.js';

/**
 * Process incoming log events from frontend
 * @param {Object} payload - WebSocket or HTTP message payload
 * @param {Object} clientMeta - Client metadata { ip?, userAgent? }
 * @returns {number} Number of events processed
 */
export function ingestFrontendLogs(payload, clientMeta = {}) {
  if (!isLoggingInitialized()) {
    process.stderr.write('[LogIngestion] Dispatcher not initialized, dropping events\n');
    return 0;
  }

  const dispatcher = getDispatcher();
  const events = normalizePayload(payload);

  let processed = 0;
  for (const event of events) {
    const normalized = normalizeEvent(event, clientMeta);
    if (normalized) {
      dispatcher.dispatch(normalized);
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
    ts: event.ts || event.timestamp || new Date().toISOString(),
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
