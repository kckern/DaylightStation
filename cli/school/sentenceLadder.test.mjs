import { describe, expect, it, vi } from 'vitest';
import { main } from './sentenceLadder.mjs';
import { SEQ16_EVENTS } from '#domains/school/language/trace.fixture.mjs';

const io = () => ({ stdout: { write: vi.fn() }, stderr: { write: vi.fn() } });

/** A log-store row: flat, dotted keys, every value a string, arrays as JSON. */
function flatten(prefix, obj, out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = `${prefix}.${k}`;
    if (Array.isArray(v)) out[key] = JSON.stringify(v);
    else if (typeof v === 'object') flatten(key, v, out);
    else out[key] = String(v);
  }
  return out;
}
const ROWS = SEQ16_EVENTS.map((e) => ({
  _msg: e.msg, _time: '2026-09-23T16:00:00Z', level: e.level, ...flatten('data', e.data), ...flatten('context', e.context),
}));
const ndjsonFetch = (rows, ok = true) => vi.fn(async () => ({ ok, text: async () => rows.map((r) => JSON.stringify(r)).join('\n') }));

describe('school sentence-ladder trace', () => {
  it('queries the store for the learner\'s sentence-ladder events on that day and prints the sitting', async () => {
    const fetchImpl = ndjsonFetch(ROWS);
    const out = io();
    expect(await main(['trace', '--learner', 'learner-a', '--day', '2026-09-23'], out, { fetch: fetchImpl })).toBe(0);
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain('school.language');
    expect(body).toContain('data.learnerId%3A%22learner-a%22');
    expect(decodeURIComponent(body.replace(/\+/g, ' '))).toContain('_time:[2026-09-23T00:00:00, 2026-09-25T00:00:00]');
    const printed = out.stdout.write.mock.calls.map((c) => c[0]).join('');
    expect(printed).toContain('# learner-a · glossika-korean · day 8 · trace run-seq16');
    expect(printed).toContain('cut piece 0 at 3611ms (raw 3702, snapped) → pieces 0–3611 | 3611–5400 of 5400ms');
    expect(printed).toContain('summary: pieces 2 · takes 4 (refused 0) · redos 2 · restarts 3 (key:Tab×3)');
  });

  it('narrows to one corpus with --corpus', async () => {
    const fetchImpl = ndjsonFetch(ROWS);
    await main(['trace', '--learner', 'learner-a', '--day', '2026-09-23', '--corpus', 'glossika-korean'], io(), { fetch: fetchImpl });
    expect(String(fetchImpl.mock.calls[0][1].body)).toContain('data.corpus%3A%22glossika-korean%22');
  });

  it('says so, and fails, when the store has nothing', async () => {
    const out = io();
    expect(await main(['trace', '--learner', 'learner-a', '--day', '2026-09-23'], out, { fetch: ndjsonFetch([]) })).toBe(1);
    expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/no sentence-ladder events for learner-a/));
  });

  it('says so when the store cannot be reached', async () => {
    const out = io();
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await main(['trace', '--learner', 'learner-a'], out, { fetch: fetchImpl })).toBe(1);
    expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/log store unreachable/));
  });

  it('requires --learner', async () => {
    const out = io();
    expect(await main(['trace'], out, { fetch: ndjsonFetch([]) })).toBe(1);
    expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/--learner is required/));
  });
});
