// tests/isolated/applications/content/ContentQueryService.timings.test.mjs
//
// Task 4 (RC3 observability): the searchStream.complete log recorded only
// totalMs, so during the 2026-07-16 incident we couldn't tell whether the
// files/abs/singalong timeouts were endemic or cold-start. This test drives
// the real searchStream through one resolving adapter and one failing
// adapter and asserts the completion log carries a numeric per-source
// elapsed-ms entry for both.
import { describe, it, expect, vi } from 'vitest';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

// Fake adapters shaped to satisfy #canHandle (getSearchCapabilities must
// declare the 'text' query key) and #translateQuery (getQueryMappings is
// optional but harmless to include), matching the pattern used by the
// existing tests/unit/content/ContentQueryService.searchStream.test.mjs.
function fakeAdapter(source, searchImpl) {
  return {
    source,
    search: searchImpl,
    getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
    getQueryMappings: () => ({}),
  };
}

describe('ContentQueryService.searchStream per-source timings', () => {
  it('logs sourceTimings for every adapter (resolved and failed) in searchStream.complete', async () => {
    const logs = [];
    const logger = { info: (evt, data) => logs.push({ evt, data }), warn: () => {}, debug: () => {} };

    const plex = fakeAdapter('plex', async () => ({ items: [{ id: 'plex:1', title: 'A' }] }));
    const files = fakeAdapter('files', async () => { throw new Error('files timeout after 5000ms'); });

    const registry = {
      resolveSource: () => [plex, files],
      get: (s) => [plex, files].find(a => a.source === s),
    };

    const svc = new ContentQueryService({ registry, logger });

    // Drain the async generator.
    const events = [];
    for await (const ev of svc.searchStream({ text: 'x' })) events.push(ev);

    const complete = logs.find(l => l.evt === 'content-query.searchStream.complete');
    expect(complete).toBeTruthy();
    expect(complete.data.sourceTimings).toBeTruthy();
    expect(typeof complete.data.sourceTimings.plex).toBe('number');
    expect(typeof complete.data.sourceTimings.files).toBe('number');
    // Integer ms, not fractional.
    expect(Number.isInteger(complete.data.sourceTimings.plex)).toBe(true);
    expect(Number.isInteger(complete.data.sourceTimings.files)).toBe(true);

    // Unchanged existing behavior: complete event still carries totalMs.
    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe('complete');
    expect(typeof lastEvent.totalMs).toBe('number');
  });

  it('does not include a timing entry for an adapter skipped by #canHandle', async () => {
    const logs = [];
    const logger = { info: (evt, data) => logs.push({ evt, data }), warn: () => {}, debug: () => {} };

    const plex = fakeAdapter('plex', async () => ({ items: [{ id: 'plex:1', title: 'A' }] }));
    // Declares no support for the 'text' canonical/specific key -> #canHandle returns false -> skipped.
    const unsupported = {
      source: 'unsupported',
      search: vi.fn(),
      getSearchCapabilities: () => ({ canonical: [], specific: [] }),
      getQueryMappings: () => ({}),
    };

    const registry = {
      resolveSource: () => [plex, unsupported],
      get: (s) => [plex, unsupported].find(a => a.source === s),
    };

    const svc = new ContentQueryService({ registry, logger });

    for await (const _ev of svc.searchStream({ text: 'x' })) { /* drain */ }

    const complete = logs.find(l => l.evt === 'content-query.searchStream.complete');
    expect(complete.data.sourceTimings.plex).toBeTypeOf('number');
    expect(complete.data.sourceTimings).not.toHaveProperty('unsupported');
    expect(unsupported.search).not.toHaveBeenCalled();
  });
});
