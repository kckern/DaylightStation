/**
 * Reader for the 2016–2020 `glossika` MySQL dump — an anti-corruption layer
 * over a dead schema (design §6).
 *
 * This is the ONLY place that knows the original app's vocabulary. It
 * translates that vocabulary into the domain's on the way out:
 *
 *   MySQL                       domain
 *   ---------------------       ------------------------------
 *   user_log.action             rung
 *   user_log.data               given   (the learner's typed response)
 *   user_log.sentence_id        seq
 *   user_log.day                day     (real study day, 1-based)
 *   sentences.eng / .val        text[sourceCode] / text[targetCode]
 *   user.daily_limit            dailyLimit
 *   user.user                   a household user id, via `userMap`
 *
 * Nothing downstream should ever see `action`, `val`, or `ekern`.
 *
 * The dump is parsed rather than replayed into a database: it is 1MB of
 * INSERT statements and standing up MySQL to read four tables once would be a
 * heavier dependency than the parsing it saves.
 */

/** Column order as dumped, i.e. the physical schema. */
const COLUMNS = {
  sentences: ['id', 'lang', 'seq', 'eng', 'val'],
  user: ['user', 'a', 'b', 'daily_limit', 'fullname'],
  user_log: ['timestamp', 'user', 'action', 'data', 'sentence_id', 'day'],
};

/** `action` values map 1:1 onto ladder rungs; anything else is not a rung. */
const ACTION_TO_RUNG = {
  repetition: 'repetition',
  dictation: 'dictation',
  recording: 'recording',
  interpretation: 'interpretation',
};

/**
 * mysqldump renders a longblob column as `_binary '…'`. The learner's typed
 * answer is plain UTF-8 text that happened to live in a blob column, so the
 * marker is dump syntax and must not survive into the record.
 */
const BINARY_PREFIX = /^_binary\s+/;

const SQL_ESCAPES = { n: '\n', t: '\t', r: '\r', 0: '\0', b: '\b', Z: '\x1a' };

/**
 * Split a VALUES blob into its top-level `(...)` tuples, respecting quoting and
 * backslash escapes. A naive split on `),(` corrupts any row whose text
 * contains those characters — and this corpus is full of punctuation.
 */
function splitTuples(blob) {
  const tuples = [];
  let current = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (const ch of blob) {
    if (escaped) { current.push(ch); escaped = false; continue; }
    if (ch === '\\') { current.push(ch); escaped = true; continue; }
    if (ch === "'") { quoted = !quoted; current.push(ch); continue; }
    if (!quoted) {
      if (ch === '(') {
        depth += 1;
        if (depth === 1) { current = []; continue; }
      } else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { tuples.push(current.join('')); continue; }
      }
    }
    current.push(ch);
  }
  return tuples;
}

/** Split one tuple into its fields, unescaping as MySQL escaped them. */
function splitFields(tuple) {
  const fields = [];
  let current = [];
  let quoted = false;
  let escaped = false;

  for (const ch of tuple) {
    if (escaped) { current.push(SQL_ESCAPES[ch] ?? ch); escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === "'") { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { fields.push(current.join('')); current = []; continue; }
    current.push(ch);
  }
  fields.push(current.join(''));
  return fields.map((f) => f.trim());
}

/** All rows of one table, as objects keyed by the physical column names. */
export function readTable(sql, table) {
  const columns = COLUMNS[table];
  if (!columns) throw new Error(`unknown table: ${table}`);
  const match = new RegExp(`INSERT INTO \`${table}\` VALUES (.*?);\\n`, 's').exec(sql);
  if (!match) return [];
  return splitTuples(match[1]).map((tuple) => {
    const values = splitFields(tuple);
    return Object.fromEntries(columns.map((col, i) => [col, values[i] ?? '']));
  });
}

/**
 * The corpus is two sources sharing one sequence. Sentences up to this number
 * are the commercial course, read by native speakers. Everything above it was
 * appended later by the original `import.php`, which started at `max(seq) + 1`
 * and pulled vocabulary from a scraped wordbook whose audio was **TTS**.
 *
 * Recorded as provenance rather than flattened away, because the two do not
 * sound alike and only the TTS half is regenerable — which is also why most of
 * the missing audio sits above this line rather than being a real loss.
 *
 * They stay in ONE corpus deliberately. The 2016 app drove both up a single
 * ladder with one continuous sequence and one day counter; splitting them now
 * would invent a division the study history never had. That the ladder was
 * always supplier-agnostic is exactly why the pedagogy is domain code and the
 * supplier is this file.
 */
export const NATIVE_AUDIO_MAX_SEQ = 3000;

/**
 * Sentences, in domain shape.
 *
 * `hasAudio` is supplied by the caller rather than inferred, because whether a
 * recording was ever split is a fact about the media tree, not about the dump.
 *
 * @param {string} sql
 * @param {{source: string, target: string}} languages
 * @param {(seq: number) => boolean} hasAudio
 */
export function readSentences(sql, languages, hasAudio = () => true) {
  return readTable(sql, 'sentences')
    .map((row) => ({
      seq: Number(row.seq),
      text: { [languages.source]: row.eng, [languages.target]: row.val },
      audio: hasAudio(Number(row.seq)),
      origin: Number(row.seq) <= NATIVE_AUDIO_MAX_SEQ ? 'glossika' : 'naver-tts',
    }))
    .filter((s) => Number.isInteger(s.seq) && s.seq > 0)
    .filter((s) => s.text[languages.source]?.trim() && s.text[languages.target]?.trim())
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Learners, in domain shape. `userMap` translates the original account name to
 * a household user id; an account with no mapping is skipped rather than
 * guessed, since a wrong mapping would attribute one person's study to another.
 */
export function readLearners(sql, userMap) {
  return readTable(sql, 'user')
    .filter((row) => userMap[row.user])
    .map((row) => ({
      legacyUser: row.user,
      userId: userMap[row.user],
      dailyLimit: Number(row.daily_limit) || null,
      name: row.fullname,
    }));
}

/**
 * Attempt events per household user id, in domain shape and chronological
 * order.
 *
 * Rows are emitted as-is rather than deduplicated: the log is append-only
 * evidence, and the queue builder already resolves a repeated rung by taking
 * the earliest clearing. Collapsing them here would discard the record that a
 * sentence was drilled more than once.
 *
 * Rows the dump cannot place are counted and returned rather than dropped in
 * silence. The original app really did write repetitions with an empty
 * `sentence_id` (its `loadSeq` could yield null and still POST), so a nonzero
 * skip count here is expected — but an unexplained jump in it means this
 * reader has stopped understanding the dump, and that must be visible.
 *
 * @returns {{byUser: Object<string, Array>, skipped: object}}
 */
export function readAttempts(sql, userMap, { source = 'legacy-db' } = {}) {
  const byUser = {};
  const skipped = { unmappedUser: 0, unknownAction: 0, noSentence: 0, badTimestamp: 0 };

  for (const row of readTable(sql, 'user_log')) {
    const userId = userMap[row.user];
    if (!userId) { skipped.unmappedUser += 1; continue; }

    const rung = ACTION_TO_RUNG[row.action];
    if (!rung) { skipped.unknownAction += 1; continue; }

    const seq = Number(row.sentence_id);
    const day = Number(row.day);
    if (!Number.isInteger(seq) || seq <= 0) { skipped.noSentence += 1; continue; }

    const at = toIso(row.timestamp);
    if (!at) { skipped.badTimestamp += 1; continue; }

    const event = { at, seq, rung, attributedTo: userId, source };
    if (Number.isInteger(day) && day > 0) event.day = day;

    const given = String(row.data ?? '').replace(BINARY_PREFIX, '').trim();
    if (given) event.given = given;

    (byUser[userId] ??= []).push(event);
  }

  for (const events of Object.values(byUser)) events.sort((a, b) => a.at.localeCompare(b.at));
  return { byUser, skipped };
}

/**
 * `YYYY-MM-DD HH:MM:SS` as dumped. The original server ran Europe/London while
 * the learners were in Asia/Seoul, but the dump records no zone, so the value
 * is taken at face value and marked UTC. An invented offset would be a guess
 * presented as fact; the day number, which the app itself assigned, is the
 * authoritative ordering and it is carried through separately.
 */
function toIso(timestamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(timestamp ?? ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (`${y}-${mo}-${d}` === '0000-00-00') return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

export default { readTable, readSentences, readLearners, readAttempts };
