import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MediaJudge } from '../../../../../src/3_applications/brain/services/MediaJudge.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function makeRuntime(output) {
  return { execute: async () => ({ output }) };
}

const CANDS = [
  { id: 'a', title: 'A', source: 'plex', mediaType: 'track' },
  { id: 'b', title: 'B', source: 'plex', mediaType: 'album' },
  { id: 'c', title: 'C', source: 'plex', mediaType: 'artist' },
];

describe('MediaJudge', () => {
  it('throws if agentRuntime missing execute', () => {
    assert.throws(() => new MediaJudge({ agentRuntime: {} }), /execute/);
  });

  it('returns no_candidates for empty list', async () => {
    const j = new MediaJudge({ agentRuntime: makeRuntime('{"index":0}'), logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: [] });
    assert.strictEqual(r.index, -1);
    assert.strictEqual(r.reason, 'no_candidates');
  });

  it('returns 0 immediately for single candidate (no LLM call)', async () => {
    let called = false;
    const runtime = { execute: async () => { called = true; return { output: '{}' }; } };
    const j = new MediaJudge({ agentRuntime: runtime, logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: [CANDS[0]] });
    assert.strictEqual(r.index, 0);
    assert.strictEqual(r.reason, 'only_candidate');
    assert.strictEqual(called, false);
  });

  it('parses strict JSON output and returns the picked index', async () => {
    const j = new MediaJudge({ agentRuntime: makeRuntime('{"index":1,"reason":"best_match"}'), logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: CANDS });
    assert.strictEqual(r.index, 1);
    assert.strictEqual(r.reason, 'best_match');
  });

  it('extracts JSON from prose-wrapped output', async () => {
    const messy = 'Here is my pick: {"index":2,"reason":"highest_rated"} — done.';
    const j = new MediaJudge({ agentRuntime: makeRuntime(messy), logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: CANDS });
    assert.strictEqual(r.index, 2);
    assert.strictEqual(r.reason, 'highest_rated');
  });

  it('returns -1 when LLM output cannot be parsed', async () => {
    const j = new MediaJudge({ agentRuntime: makeRuntime('I cannot decide today'), logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: CANDS });
    assert.strictEqual(r.index, -1);
    assert.match(r.reason, /parse/);
  });

  it('returns -1 when index is out of range', async () => {
    const j = new MediaJudge({ agentRuntime: makeRuntime('{"index":99}'), logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: CANDS });
    assert.strictEqual(r.index, -1);
    assert.match(r.reason, /out_of_range/);
  });

  it('returns -1 when judge returns -1 (no_confident_pick path)', async () => {
    const j = new MediaJudge({ agentRuntime: makeRuntime('{"index":-1,"reason":"no_confident_pick"}'), logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: CANDS });
    assert.strictEqual(r.index, -1);
  });

  it('times out gracefully when runtime hangs', async () => {
    const runtime = { execute: () => new Promise(() => {}) }; // never resolves
    const j = new MediaJudge({ agentRuntime: runtime, logger: silentLogger, timeoutMs: 50 });
    const r = await j.pick({ query: 'x', candidates: CANDS });
    assert.strictEqual(r.index, -1);
    assert.match(r.reason, /timeout/);
  });

  it('reports latencyMs on success', async () => {
    const j = new MediaJudge({ agentRuntime: makeRuntime('{"index":0}'), logger: silentLogger });
    const r = await j.pick({ query: 'x', candidates: CANDS });
    assert.ok(typeof r.latencyMs === 'number');
    assert.ok(r.latencyMs >= 0);
  });
});
