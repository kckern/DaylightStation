/**
 * Legacy dump reader tests.
 *
 * The parsing is the risk here: this is 1MB of mysqldump INSERT statements
 * containing Korean punctuation, apostrophes and escaped quotes, and a naive
 * split corrupts rows silently — producing a corpus that looks fine until a
 * sentence turns out truncated years later.
 */
import { describe, it, expect } from 'vitest';
import {
  readTable, readSentences, readLearners, readAttempts, NATIVE_AUDIO_MAX_SEQ,
} from './LegacyDumpReader.mjs';

const LANGUAGES = { source: 'EN', target: 'KR' };
const USER_MAP = { kckern: 'kckern', ekern: 'elizabeth' };

const dump = (table, values) => `INSERT INTO \`${table}\` VALUES ${values};\n`;

describe('readTable', () => {
  it('parses tuples containing commas and parentheses inside quoted text', () => {
    // A split on `),(` would tear this row in half.
    const sql = dump('sentences', "('KR-1','KR','1','Well, (yes) — no.','네, (그래요).')");
    expect(readTable(sql, 'sentences')[0]).toMatchObject({
      eng: 'Well, (yes) — no.', val: '네, (그래요).',
    });
  });

  it('unescapes quotes rather than truncating at them', () => {
    const sql = dump('sentences', "('KR-1','KR','1','It\\'s fine.','괜찮아요.')");
    expect(readTable(sql, 'sentences')[0].eng).toBe("It's fine.");
  });

  it('unescapes newlines and tabs', () => {
    const sql = dump('sentences', "('KR-1','KR','1','a\\nb\\tc','한')");
    expect(readTable(sql, 'sentences')[0].eng).toBe('a\nb\tc');
  });

  it('returns nothing for a table with no INSERT', () => {
    expect(readTable('-- empty dump\n', 'user_log')).toEqual([]);
  });

  it('refuses a table it has no column map for', () => {
    expect(() => readTable('', 'nope')).toThrow(/unknown table/);
  });
});

describe('readSentences', () => {
  const sql = dump('sentences',
    "('KR-2','KR','2','Second.','둘.'),('KR-1','KR','1','First.','하나.')");

  it('maps eng/val onto language codes and sorts by sequence', () => {
    const out = readSentences(sql, LANGUAGES);
    expect(out.map((s) => s.seq)).toEqual([1, 2]);
    expect(out[0].text).toEqual({ EN: 'First.', KR: '하나.' });
  });

  it('takes audio availability from the caller, not from the dump', () => {
    const out = readSentences(sql, LANGUAGES, (seq) => seq === 1);
    expect(out.find((s) => s.seq === 1).audio).toBe(true);
    expect(out.find((s) => s.seq === 2).audio).toBe(false);
  });

  it('marks provenance at the import boundary', () => {
    // Everything above the boundary came from the later wordbook import, whose
    // audio was TTS rather than a native reading.
    const high = NATIVE_AUDIO_MAX_SEQ + 1;
    const sql2 = dump('sentences',
      `('KR-1','KR','1','a','ㄱ'),('KR-x','KR','${high}','b','ㄴ')`);
    const out = readSentences(sql2, LANGUAGES);
    expect(out[0].origin).toBe('glossika');
    expect(out[1].origin).toBe('naver-tts');
  });

  it('drops rows with empty text rather than shipping a blank sentence', () => {
    const sql2 = dump('sentences', "('KR-1','KR','1','','')");
    expect(readSentences(sql2, LANGUAGES)).toEqual([]);
  });
});

describe('readLearners', () => {
  const sql = dump('user', "('kckern','','',2,'KC Kern'),('ekern','','',5,'Elizabeth')");

  it('translates the legacy account onto a household user id', () => {
    const out = readLearners(sql, USER_MAP);
    expect(out.map((l) => l.userId)).toEqual(['kckern', 'elizabeth']);
    expect(out[1]).toMatchObject({ legacyUser: 'ekern', dailyLimit: 5 });
  });

  it('skips an unmapped account rather than guessing who it was', () => {
    // A wrong guess attributes one person's study to another.
    expect(readLearners(sql, { kckern: 'kckern' })).toHaveLength(1);
  });
});

describe('readAttempts', () => {
  const row = (user, action, data, seq, day, ts = '2017-01-02 03:04:05') =>
    `('${ts}','${user}','${action}',${data},'${seq}',${day})`;

  it('maps action onto rung and strips the mysqldump _binary marker', () => {
    const sql = dump('user_log', row('ekern', 'dictation', "_binary '오늘 날씨가 좋아요'", '0001', 2));
    const { byUser } = readAttempts(sql, USER_MAP);
    expect(byUser.elizabeth[0]).toMatchObject({
      rung: 'dictation', seq: 1, day: 2, given: '오늘 날씨가 좋아요', attributedTo: 'elizabeth',
    });
  });

  it('carries the real day rather than inventing one', () => {
    const sql = dump('user_log', row('kckern', 'repetition', "''", '0042', 59));
    expect(readAttempts(sql, USER_MAP).byUser.kckern[0].day).toBe(59);
  });

  it('omits given when the response was empty', () => {
    const sql = dump('user_log', row('kckern', 'recording', "''", '0007', 3));
    expect(readAttempts(sql, USER_MAP).byUser.kckern[0].given).toBeUndefined();
  });

  it('COUNTS what it cannot place instead of dropping it in silence', () => {
    // The 2016 app really did POST repetitions with no sentence attached.
    const sql = dump('user_log', [
      row('kckern', 'repetition', "''", '', 2),
      row('kckern', 'nonsense', "''", '0001', 2),
      row('nobody', 'repetition', "''", '0001', 2),
    ].join(','));
    const { byUser, skipped } = readAttempts(sql, USER_MAP);
    expect(byUser.kckern).toBeUndefined();
    expect(skipped).toMatchObject({ noSentence: 1, unknownAction: 1, unmappedUser: 1 });
  });

  it('orders each learner chronologically', () => {
    const sql = dump('user_log', [
      row('kckern', 'repetition', "''", '0002', 2, '2017-03-01 00:00:00'),
      row('kckern', 'repetition', "''", '0001', 1, '2017-01-01 00:00:00'),
    ].join(','));
    expect(readAttempts(sql, USER_MAP).byUser.kckern.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('keeps a repeated rung rather than collapsing it', () => {
    // The log is append-only evidence; the queue builder resolves repeats by
    // taking the earliest clearing, so deduplicating here would destroy the
    // record that a sentence was drilled twice.
    const sql = dump('user_log', [
      row('kckern', 'repetition', "''", '0001', 1, '2017-01-01 00:00:00'),
      row('kckern', 'repetition', "''", '0001', 9, '2017-02-01 00:00:00'),
    ].join(','));
    expect(readAttempts(sql, USER_MAP).byUser.kckern).toHaveLength(2);
  });

  it('rejects a zero date instead of emitting an impossible timestamp', () => {
    const sql = dump('user_log', row('kckern', 'repetition', "''", '0001', 1, '0000-00-00 00:00:00'));
    const { byUser, skipped } = readAttempts(sql, USER_MAP);
    expect(byUser.kckern).toBeUndefined();
    expect(skipped.badTimestamp).toBe(1);
  });
});
