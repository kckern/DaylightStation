import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump, load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { buildEnrollPlan, main, resolveDeckId } from './cardLadder.mjs';

// Korean is the worked example; nothing in the CLI names it.
const LEXICON = {
  schema: 'school.word-lexicon/v2', package: 'korean-vocab',
  language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  program: { title: 'Korean words' },
  entries: [
    { id: 'gawi', kind: 'word', group: 'week-01-classroom', term: '가위', gloss: 'Scissors', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } },
  ],
};

async function fixture(root) {
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEXICON));
  const decks = path.join(root, 'data/content/school/learning-catalog/flashcard-decks/language/korean');
  await mkdir(decks, { recursive: true });
  await writeFile(path.join(decks, 'week-01-classroom.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
  await writeFile(path.join(decks, 'week-02-home.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/week-02-home', title: 'Korean — Home', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
}
const dirs = (root) => ['--data-dir', path.join(root, 'data'), '--media-dir', path.join(root, 'media')];
const io = () => ({ stdout: { write: vi.fn() }, stderr: { write: vi.fn() } });

// A two-word lexicon so an "introduced words only" filter has something to exclude.
const LEARNER_LEXICON = {
  schema: 'school.word-lexicon/v2', package: 'korean-vocab',
  language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  program: { title: 'Korean words' },
  entries: [
    { id: 'gawi', kind: 'word', group: 'week-01-classroom', term: '가위', gloss: 'Scissors', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } },
    { id: 'pul', kind: 'word', group: 'week-01-classroom', term: '풀', gloss: 'Glue', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } },
  ],
};
async function learnerFixture(root) {
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEARNER_LEXICON));
  const decks = path.join(root, 'data/content/school/learning-catalog/flashcard-decks/language/korean');
  await mkdir(decks, { recursive: true });
  await writeFile(path.join(decks, 'week-01-classroom.yml'), dump({
    schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom',
    revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi', 'pul'],
  }));
}
function statusFile(root, learnerId, pkg) {
  return path.join(root, 'data/users', learnerId, 'apps/school/word-ladder', pkg, 'status.yml');
}

describe('card-ladder CLI', () => {
  it('resolves a full deck id as-is, and a bare slug only when exactly one deck ends with it', () => {
    const ids = ['language/korean/week-01-classroom', 'language/spanish/week-01-classroom', 'language/spanish/unit-02'];
    expect(resolveDeckId('language/korean/week-02-home', ids)).toBe('language/korean/week-02-home');
    expect(resolveDeckId('unit-02', ids)).toBe('language/spanish/unit-02');
    expect(() => resolveDeckId('week-01-classroom', ids)).toThrow(/ambiguous: language\/korean\/week-01-classroom, language\/spanish\/week-01-classroom/);
    expect(() => resolveDeckId('week-09', ids)).toThrow(/no flashcard deck matches 'week-09'/);
  });
  it('quiz writes a document source under the learning-catalog documents root, idempotently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-'));
    try {
      await fixture(root);
      const argv = ['quiz', '--deck', 'week-01-classroom', ...dirs(root)];
      expect(await main(argv, io())).toBe(0);
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/week-01-classroom-quiz.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.id).toBe('language/korean/week-01-classroom-quiz');
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
      expect(source.header.instructions).toBe('Not sure of a word? Open Korean words on the Portal and review the cards, then come back.');
      expect(source.topics).toEqual(['korean', 'vocabulary']);
      expect(await main(argv, io())).toBe(0);
      await writeFile(file, 'schema: school.document-source/v1\nid: hand-edited\n');
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/differs; pass --force/));
      expect(await main([...argv, '--force'], io())).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('quiz --learner writes a per-learner document source over introduced words only, idempotently, refusing an unforced overwrite', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-learner-'));
    try {
      await learnerFixture(root);
      const sf = statusFile(root, 'test-learner', 'korean-vocab');
      await mkdir(path.dirname(sf), { recursive: true });
      await writeFile(sf, dump({
        schema: 'school.word-ladder-status/v3',
        words: { gawi: { state: 'claimed', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null, verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: '2026-09-01', rechecks: 0, lastGraded: null } },
        decksSeen: [], lastFoldedDay: null, paperAttemptsFolded: [],
      }));
      const argv = ['quiz', '--learner', 'test-learner', '--package', 'korean-vocab', '--week', '2026-W39', ...dirs(root)];
      expect(await main(argv, io())).toBe(0);
      // The id lowercases the ISO week (a document id is lowercase-kebab-only);
      // the display title keeps the ISO-cased week.
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/korean-vocab-quiz-test-learner-2026-w39.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.id).toBe('language/korean/korean-vocab-quiz-test-learner-2026-w39');
      // only 'gawi' is introduced; 'pul' has no status entry (still new) and is excluded.
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
      expect(source.title).toBe('Korean words — week 2026-W39');

      expect(await main(argv, io())).toBe(0); // second run: unchanged

      // A changed status (pul now introduced too) makes a different source; refused without --force.
      await writeFile(sf, dump({
        schema: 'school.word-ladder-status/v3',
        words: {
          gawi: { state: 'claimed', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null, verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: '2026-09-01', rechecks: 0, lastGraded: null },
          pul: { state: 'claimed', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null, verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: '2026-09-21', rechecks: 0, lastGraded: null },
        },
        decksSeen: [], lastFoldedDay: null, paperAttemptsFolded: [],
      }));
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/differs; pass --force/));
      expect(await main([...argv, '--force'], io())).toBe(0);
      const forced = load(await readFile(file, 'utf8'));
      expect(forced.blocks.map((b) => b.itemId)).toEqual(['pul', 'gawi']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('quiz --learner migrates a v1 status file and reads it as introduced', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-learner-v1-'));
    try {
      await learnerFixture(root);
      const sf = statusFile(root, 'test-learner', 'korean-vocab');
      await mkdir(path.dirname(sf), { recursive: true });
      await writeFile(sf, dump({ schema: 'school.word-ladder-status/v1', words: { gawi: { state: 'known', step: 2, nextCheckDay: '2026-10-01' } } }));
      // Lowercase --week input, to prove it is accepted just like the ISO-cased form.
      const argv = ['quiz', '--learner', 'test-learner', '--package', 'korean-vocab', '--week', '2026-w39', ...dirs(root)];
      expect(await main(argv, io())).toBe(0);
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/korean-vocab-quiz-test-learner-2026-w39.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.id).toBe('language/korean/korean-vocab-quiz-test-learner-2026-w39');
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('quiz --learner throws when nobody has been introduced yet', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-learner-empty-'));
    try {
      await learnerFixture(root);
      const argv = ['quiz', '--learner', 'test-learner', '--package', 'korean-vocab', '--week', '2026-W39', ...dirs(root)];
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/no introduced words/));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('buildEnrollPlan needs a title (the CLI supplies the lexicon\'s program.title)', () => {
    expect(() => buildEnrollPlan({ programs: [] }, { deckId: 'language/korean/week-02-home' })).toThrow(/tile title/);
  });

  it('enroll-plan defaults the tile title to the lexicon\'s program.title when --title is omitted', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-enroll-'));
    try {
      await fixture(root);
      const out = path.join(root, 'plan.yml');
      const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ courses: [], units: [], programs: [] }) }));
      const argv = ['enroll-plan', '--learner', 'kid', '--deck', 'week-02-home', '--out', out, ...dirs(root)];
      expect(await main(argv, io(), { fetch: fetchImpl })).toBe(0);
      const plan = load(await readFile(out, 'utf8'));
      expect(plan.programs).toEqual([
        { programId: 'flashcards', deckId: 'language/korean/week-02-home', title: 'Korean words', policy: { mode: 'card-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } },
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('enroll-plan appends (or replaces) the card-ladder program and keeps everything else', () => {
    const current = {
      learnerId: 'kid', updatedAt: '2026-09-04T05:35:39.484Z',
      courses: [{ courseId: 'atlas' }], units: [],
      programs: [{ programId: 'sentence-ladder', corpusId: 'glossika-korean' }, { programId: 'flashcards', deckId: 'language/korean/week-01-classroom', policy: { mode: 'card-ladder' } }],
    };
    const plan = buildEnrollPlan(current, { deckId: 'language/korean/week-02-home', title: 'Korean words' });
    expect(plan.courses).toEqual(current.courses);
    expect(plan.programs).toEqual([
      { programId: 'sentence-ladder', corpusId: 'glossika-korean' },
      { programId: 'flashcards', deckId: 'language/korean/week-02-home', title: 'Korean words', policy: { mode: 'card-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } },
    ]);
  });
});

describe('card-ladder trace CLI', () => {
  // The inverse of the CLI's own unflattenRow(): a log-store row is flat,
  // dotted-key, all-string — this is what a real logsql query response line
  // looks like (verified against the live store, see task-3 report).
  function flatten(prefix, obj, out = {}) {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      const key = `${prefix}.${k}`;
      if (typeof v === 'object' && !Array.isArray(v)) flatten(key, v, out);
      else out[key] = String(v);
    }
    return out;
  }
  function row(msg, time, data) {
    return { _msg: msg, _time: time, level: 'info', ...flatten('data', data) };
  }
  function ndjsonFetch(rows, ok = true) {
    return vi.fn(async () => ({ ok, text: async () => rows.map((r) => JSON.stringify(r)).join('\n') }));
  }

  const TRACE_ROWS = [
    row('school.card-ladder.sitting.opened', '2026-09-22T10:00:00Z', {
      traceId: 'tr1', sittingId: 'korean-vocab.abc.1', seq: 1, t: 0, learnerId: 'learner-a', deckId: 'language/korean/week-01-classroom', package: 'korean-vocab', mode: 'live',
    }),
    row('school.card-ladder.item.shown', '2026-09-22T10:00:00Z', {
      traceId: 'tr1', sittingId: 'korean-vocab.abc.1', seq: 2, t: 200, learnerId: 'learner-a', deckId: 'language/korean/week-01-classroom', package: 'korean-vocab', mode: 'live',
      itemId: 'i1', type: 'flashcard', wordId: 'gawi', layout: 'flashcard-front',
    }),
    row('school.card-ladder.item.answered', '2026-09-22T10:00:03Z', {
      traceId: 'tr1', sittingId: 'korean-vocab.abc.1', seq: 3, t: 3200, learnerId: 'learner-a', deckId: 'language/korean/week-01-classroom', package: 'korean-vocab', mode: 'live',
      itemId: 'i1', type: 'flashcard', correct: true, ms: 3000,
    }),
    row('school.card-ladder.sitting.closed', '2026-09-22T10:00:03Z', {
      traceId: 'tr1', sittingId: 'korean-vocab.abc.1', seq: 4, t: 3300, learnerId: 'learner-a', deckId: 'language/korean/week-01-classroom', package: 'korean-vocab', mode: 'live',
      itemId: 'i1', reason: 'goal', activeMs: 3300,
    }),
  ];

  it('queries the log store for the learner and prints the formatted trace', async () => {
    const fetchImpl = ndjsonFetch(TRACE_ROWS);
    const out = io();
    const argv = ['trace', '--learner', 'learner-a', '--day', '2026-09-22'];
    expect(await main(argv, out, { fetch: fetchImpl })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/select/logsql/query');
    const body = String(init.body);
    expect(body).toContain('data.learnerId%3A%22learner-a%22');
    expect(body).toContain('school.card-ladder');
    const printed = out.stdout.write.mock.calls[0][0];
    expect(printed).toContain('learner-a · korean-vocab · ? · live · trace tr1');
    expect(printed).toContain('0:00  flashcard gawi flashcard-front');
    expect(printed).toContain('goal');
  });

  it('reads the pre-rename school.word-ladder.* events too, and prints them the same', async () => {
    const legacyRows = TRACE_ROWS.map((r) => ({ ...r, _msg: r._msg.replace('school.card-ladder.', 'school.word-ladder.') }));
    const current = io();
    const legacy = io();
    expect(await main(['trace', '--learner', 'learner-a', '--day', '2026-09-22'], current, { fetch: ndjsonFetch(TRACE_ROWS) })).toBe(0);
    const fetchImpl = ndjsonFetch(legacyRows);
    expect(await main(['trace', '--learner', 'learner-a', '--day', '2026-09-22'], legacy, { fetch: fetchImpl })).toBe(0);
    expect(legacy.stdout.write.mock.calls[0][0]).toBe(current.stdout.write.mock.calls[0][0]);
    const query = new URLSearchParams(String(fetchImpl.mock.calls[0][1].body)).get('query');
    expect(query).toContain('_msg:~"school.card-ladder"');
    expect(query).toContain('_msg:~"school.word-ladder"');
  });

  it('`school word-ladder …` is an alias of `school card-ladder …`, kept out of the help listing', async () => {
    const { main: school } = await import('../school.mjs');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await school(['word-ladder', '--help'])).toBe(0);
      const aliasHelp = write.mock.calls.map((c) => String(c[0])).join('');
      expect(aliasHelp).toContain('card-ladder trace --learner');
      write.mockClear();
      await school(['--help']);
      const listing = write.mock.calls.map((c) => String(c[0])).join('');
      expect(listing).toContain('card-ladder');
      expect(listing).not.toMatch(/^\s+word-ladder\s/m);
    } finally { write.mockRestore(); }
  });

  it('parses the JSON-string arrays the store keeps (a round.phase quiz queue) and prints served reasons and input', async () => {
    const stamp = { traceId: 'tr1', sittingId: 'korean-vocab.abc.1', learnerId: 'learner-a', package: 'korean-vocab', mode: 'live' };
    const rows = [
      row('school.card-ladder.item.shown', '2026-09-22T10:00:00Z', { ...stamp, seq: 1, t: 200, itemId: 'r1:s:0', type: 'flashcard', itemMode: 'stream', wordId: 'gawi', layout: 'flashcard-front' }),
      row('school.card-ladder.item.answered', '2026-09-22T10:00:03Z', { ...stamp, seq: 2, t: 3200, itemId: 'r1:s:0', type: 'flashcard', response: { sort: 'claimed' }, ms: 3000, input: 'key:3' }),
      row('school.card-ladder.item.served', '2026-09-22T10:00:00Z', { learnerId: 'learner-a', sittingId: 'korean-vocab.abc.1', mode: 'live', itemId: 'r1:s:0', reason: 'stream', via: 'respond' }),
      { ...row('school.card-ladder.round.phase', '2026-09-22T10:00:03Z', { learnerId: 'learner-a', sittingId: 'korean-vocab.abc.1', mode: 'live', itemId: 'r1:s:0', round: 'r1', from: 'stream', to: 'quiz' }), 'data.queue': '["gawi:3.1","gawi:2.2"]' },
    ];
    const out = io();
    expect(await main(['trace', '--learner', 'learner-a', '--day', '2026-09-22'], out, { fetch: ndjsonFetch(rows) })).toBe(0);
    const printed = out.stdout.write.mock.calls[0][0];
    expect(printed).toContain('── Sort · round 1 ──');
    expect(printed).toContain('sort:claimed — (3000ms) · why stream · via key:3');
    expect(printed).toContain('    ⇢ round r1: stream → quiz [gawi:3.1 gawi:2.2]');
  });

  it('quotes learnerId/sittingId/mode in the LogsQL query — VictoriaLogs tokenizes an unquoted value on . and -', async () => {
    const fetchImpl = ndjsonFetch([]);
    const out = io();
    const argv = ['trace', '--learner', 'learner-a', '--sitting', 'korean-vocab.abc.1', '--mode', 'live'];
    await main(argv, out, { fetch: fetchImpl });
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain('data.learnerId%3A%22learner-a%22');
    expect(body).toContain('data.sittingId%3A%22korean-vocab.abc.1%22');
    expect(body).toContain('data.mode%3A%22live%22');
  });

  it('warns on stderr when the store returns exactly the query limit (results may be truncated)', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row('school.card-ladder.sitting.opened', '2026-09-22T10:00:00Z', {
      traceId: 'tr1', sittingId: 'korean-vocab.abc.1', seq: i + 1, t: i, learnerId: 'learner-a', package: 'korean-vocab', mode: 'live',
    }));
    const out = io();
    const argv = ['trace', '--learner', 'learner-a', '--day', '2026-09-22'];
    expect(await main(argv, out, { fetch: ndjsonFetch(rows) })).toBe(0);
    expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/5000 rows.*truncated/i));
  });

  it('does not warn about truncation when the store returns fewer than the query limit', async () => {
    const out = io();
    expect(await main(['trace', '--learner', 'learner-a', '--day', '2026-09-22'], out, { fetch: ndjsonFetch(TRACE_ROWS) })).toBe(0);
    expect(out.stderr.write).not.toHaveBeenCalled();
  });

  it('rejects --mode outside live|test|all', async () => {
    const out = io();
    expect(await main(['trace', '--learner', 'learner-a', '--mode', 'nope'], out, { fetch: ndjsonFetch([]) })).toBe(1);
    expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/--mode must be/));
  });

  it('rejects --day together with --sitting', async () => {
    const out = io();
    const argv = ['trace', '--learner', 'learner-a', '--day', '2026-09-22', '--sitting', 'korean-vocab.abc.1'];
    expect(await main(argv, out, { fetch: ndjsonFetch([]) })).toBe(1);
    expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/not both/));
  });

  it('falls back to the day file when the store is unreachable, with the no-timing-detail header', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-trace-'));
    try {
      const dayFile = path.join(root, 'data/users/learner-a/apps/school/word-ladder/korean-vocab/days/2026-09-22.yml');
      await mkdir(path.dirname(dayFile), { recursive: true });
      await writeFile(dayFile, dump({
        items: { i1: { at: '2026-09-22T10:00:03-07:00', wordId: 'gawi', task: null, response: { typed: '가위' }, result: { correct: true } } },
      }));
      const argv = ['trace', '--learner', 'learner-a', '--day', '2026-09-22', ...dirs(root)];
      const out = io();
      const fetchImpl = ndjsonFetch([], false); // store rejects
      expect(await main(argv, out, { fetch: fetchImpl })).toBe(0);
      const printed = out.stdout.write.mock.calls[0][0];
      expect(printed).toContain('(from day file — no timing detail)');
      expect(printed).toContain('가위');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('falls back to the day file when the store returns nothing (empty result, not an error)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-trace-empty-'));
    try {
      const dayFile = path.join(root, 'data/users/learner-a/apps/school/word-ladder/korean-vocab/days/2026-09-22.yml');
      await mkdir(path.dirname(dayFile), { recursive: true });
      await writeFile(dayFile, dump({ items: { i1: { at: '2026-09-22T10:00:00-07:00', wordId: 'gawi', task: null, response: {}, result: { ok: true } } } }));
      const argv = ['trace', '--learner', 'learner-a', '--day', '2026-09-22', ...dirs(root)];
      const out = io();
      expect(await main(argv, out, { fetch: ndjsonFetch([]) })).toBe(0);
      expect(out.stdout.write.mock.calls[0][0]).toContain('(from day file — no timing detail)');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('fails with a clear message when neither the store nor a day file has anything', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-trace-missing-'));
    try {
      const argv = ['trace', '--learner', 'learner-a', '--day', '2026-09-22', ...dirs(root)];
      const out = io();
      expect(await main(argv, out, { fetch: ndjsonFetch([]) })).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/no trace found for learner-a/));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('a --sitting fallback scans every day file for the one whose sittings map has that id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'card-ladder-trace-sitting-'));
    try {
      const daysDir = path.join(root, 'data/users/learner-a/apps/school/word-ladder/korean-vocab/days');
      await mkdir(daysDir, { recursive: true });
      await writeFile(path.join(daysDir, '2026-09-20.yml'), dump({ sittings: {}, items: {} }));
      await writeFile(path.join(daysDir, '2026-09-22.yml'), dump({
        sittings: { 'korean-vocab.abc.1': { openedAt: '2026-09-22T10:00:00-07:00', closedAt: null, reason: null } },
        items: { i1: { at: '2026-09-22T10:00:00-07:00', wordId: 'gawi', task: null, response: {}, result: { ok: true } } },
      }));
      const argv = ['trace', '--learner', 'learner-a', '--sitting', 'korean-vocab.abc.1', ...dirs(root)];
      const out = io();
      expect(await main(argv, out, { fetch: ndjsonFetch([]) })).toBe(0);
      const printed = out.stdout.write.mock.calls[0][0];
      expect(printed).toContain('2026-09-22');
      expect(printed).toContain('gawi');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
