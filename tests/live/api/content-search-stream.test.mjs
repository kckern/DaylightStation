// tests/live/api/content-search-stream.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import { getAppPort } from '#testlib/configHelper.mjs';

const BASE_URL = `http://localhost:${getAppPort()}`;

// SSE streams can take several seconds to complete all adapter searches
const SSE_TIMEOUT = 30000;

/**
 * Parse SSE data from response text
 */
function parseSSEEvents(text) {
  const events = [];
  const lines = text.split('\n');
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentData) {
      try {
        events.push(JSON.parse(currentData));
      } catch {
        // Skip malformed JSON
      }
      currentData = '';
    }
  }
  return events;
}

describe('GET /api/v1/content/query/search/stream', () => {
  beforeAll(async () => {
    // Verify backend is running
    const health = await fetch(`${BASE_URL}/api/v1/health`).catch(() => null);
    if (!health?.ok) {
      throw new Error(`Backend not running at ${BASE_URL}`);
    }
  });

  it('returns SSE content type', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=test`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  }, SSE_TIMEOUT);

  it('emits pending event first', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=office`);
    const text = await response.text();
    const events = parseSSEEvents(text);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe('pending');
    expect(Array.isArray(events[0].sources)).toBe(true);
  }, SSE_TIMEOUT);

  it('emits complete event last', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=office`);
    const text = await response.text();
    const events = parseSSEEvents(text);

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe('complete');
    expect(typeof lastEvent.totalMs).toBe('number');
  }, SSE_TIMEOUT);

  it('emits results events with items and pending sources', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=office`);
    const text = await response.text();
    const events = parseSSEEvents(text);

    const resultEvents = events.filter(e => e.event === 'results');
    // May have 0 results if no matches, but if we have results, check structure
    if (resultEvents.length > 0) {
      expect(Array.isArray(resultEvents[0].items)).toBe(true);
      expect(Array.isArray(resultEvents[0].pending)).toBe(true);
      expect(typeof resultEvents[0].source).toBe('string');
    }
  }, SSE_TIMEOUT);

  it('handles short search terms gracefully', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=a`);
    expect(response.status).toBe(400);
  });
});
