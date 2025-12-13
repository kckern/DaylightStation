/**
 * Log Ingestion Service
 * 
 * Processes incoming log events from frontend clients via WebSocket or HTTP.
 * Normalizes various payload formats and dispatches to the central logging system.
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
  
  // Normalize: accept various payload formats
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

/**
 * Normalize incoming payload to array of events
 * Handles various frontend payload formats for backward compatibility
 * @param {Object} payload - Raw payload
 * @returns {Object[]} Array of event objects
 */
function normalizePayload(payload) {
  if (!payload) return [];

  // New format: { topic: 'log', events: [...] }
  if (Array.isArray(payload.events)) {
    return payload.events.map(unwrapEvent);
  }
  
  // Legacy format: { topic: 'logging', events: [...] }
  if (payload.topic === 'logging' && Array.isArray(payload.events)) {
    return payload.events.map(unwrapEvent);
  }
  
  // Legacy format: { source: 'playback-logger', event: '...', ... }
  if (payload.source === 'playback-logger') {
    return [unwrapPlaybackLoggerEvent(payload)];
  }
  
  // Single event with nested structure
  if (payload.event && typeof payload.event === 'object') {
    return [unwrapEvent(payload)];
  }
  
  // Single event with string event name
  if (typeof payload.event === 'string') {
    return [payload];
  }
  
  // Unknown format - try to use as-is
  return [payload];
}

/**
 * Unwrap nested event structure
 * Handles: { event: { event: "...", data: {...} } }
 * @param {Object} wrapper - Possibly wrapped event
 * @returns {Object} Unwrapped event
 */
function unwrapEvent(wrapper) {
  if (!wrapper) return wrapper;
  
  // Handle double-nested: { event: { event: "...", data: {...} } }
  if (wrapper.event && typeof wrapper.event === 'object' && wrapper.event.event) {
    return { ...wrapper, ...wrapper.event };
  }
  
  return wrapper;
}

/**
 * Convert legacy playback-logger format to standard format
 * @param {Object} payload - Playback logger payload
 * @returns {Object} Normalized event
 */
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

/**
 * Normalize a single event to standard LogEvent format
 * @param {Object} event - Raw event
 * @param {Object} clientMeta - Client metadata
 * @returns {Object|null} Normalized event or null if invalid
 */
function normalizeEvent(event, clientMeta = {}) {
  if (!event) return null;
  
  // Extract event name from various locations
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

/**
 * Normalize log level string
 * @param {string} level - Raw level
 * @returns {string} Normalized level
 */
function normalizeLevel(level) {
  const normalized = String(level || 'info').toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(normalized)) {
    return normalized;
  }
  return 'info';
}

export default ingestFrontendLogs;
