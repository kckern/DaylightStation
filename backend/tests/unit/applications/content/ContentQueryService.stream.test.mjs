import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContentQueryService } from '../../../../src/3_applications/content/ContentQueryService.mjs';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

function withinProtocolTick(promise) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), 25);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function serviceWithAnsweredAndPending({ result = { items: [] }, answeredCapabilities = ['text'] } = {}) {
  let leaveHanging;
  const hanging = new Promise((resolve) => { leaveHanging = resolve; });
  const contentCatalog = {
    sourcesFor: () => ['empty', 'slow'],
    searchCapabilities: (source) => ({ canonical: source === 'empty' ? answeredCapabilities : ['text'], specific: [] }),
    queryMappings: () => ({}),
    search: (source) => (source === 'empty' ? Promise.resolve(result) : hanging),
  };
  return {
    stream: new ContentQueryService({ contentCatalog, logger: silentLogger, adapterTimeoutMs: 0 }).searchStream({ text: 'arrival' }),
    release: () => leaveHanging({ items: [] }),
  };
}

describe('ContentQueryService searchStream answered-empty protocol', () => {
  it('emits an empty source result and the remaining pending identity', async () => {
    // RED: successful empty/filtered/skipped sources disappeared from the
    // stream, leaving clients to falsely blame them when another source hung.
    const { stream, release } = serviceWithAnsweredAndPending();
    try {
      assert.deepEqual(await stream.next(), {
        value: { event: 'pending', sources: ['empty', 'slow'], intent: null }, done: false,
      });
      const emptyFrame = stream.next();
      assert.deepEqual(await withinProtocolTick(emptyFrame), {
        value: { event: 'results', source: 'empty', items: [], pending: ['slow'] }, done: false,
      });
    } finally {
      release();
      await stream.return();
    }
  });

  it('uses the same answered-empty frame for skipped and post-filtered source completions', async () => {
    // Skipped is a successful capability decision; the relevance case is a
    // successful adapter response whose items become empty after filtering.
    for (const options of [
      { answeredCapabilities: [] },
      { result: { items: [{ id: 'empty:noise', source: 'empty', title: 'Unrelated noise' }] } },
    ]) {
      const { stream, release } = serviceWithAnsweredAndPending(options);
      try {
        await stream.next();
        const emptyFrame = stream.next();
        assert.deepEqual(await withinProtocolTick(emptyFrame), {
          value: { event: 'results', source: 'empty', items: [], pending: ['slow'] }, done: false,
        });
      } finally {
        release();
        await stream.return();
      }
    }
  });
});
