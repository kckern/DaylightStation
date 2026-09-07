/**
 * A stand-in for `YamlBookLogStore` that keeps the parts of its contract the
 * teacher verbs actually lean on: shelves keyed by learner, minted ids, a
 * revision pushed onto the reading it belongs to, and a move that writes the
 * destination before it touches the source.
 *
 * Deliberately NOT a `vi.fn()` bag. Nine use cases in a row read a reading,
 * write it, and read it back; a mock that answers whatever it was told to
 * would pass while the revision it appended went nowhere.
 */
export function fakeBookLog(seed = {}) {
  const shelves = new Map(Object.entries(seed).map(([learnerId, readings]) => [
    learnerId, readings.map((reading) => structuredClone(reading)),
  ]));
  let minted = 0;
  const mint = (prefix) => { minted += 1; return `${prefix}_${String(minted).padStart(3, '0')}`; };
  const shelf = (learnerId) => {
    if (!shelves.has(learnerId)) shelves.set(learnerId, []);
    return shelves.get(learnerId);
  };
  const find = (learnerId, readingId) => {
    const reading = shelf(learnerId).find((row) => row.id === readingId);
    if (!reading) throw new Error(`no reading ${readingId} for ${learnerId}`);
    return reading;
  };
  return {
    shelves,
    async listForLearner(learnerId) { return structuredClone(shelf(learnerId)); },
    async openReading({ learnerId, isbn, progressMode = 'page', pageCount = null, openedOn = null, idempotencyKey }) {
      if (!idempotencyKey) throw new Error('idempotencyKey is required to open a reading');
      const existing = shelf(learnerId).find((row) => row.idempotencyKey === idempotencyKey);
      if (existing) return structuredClone(existing);
      const stored = {
        id: mint('rdg'), learnerId, book: { isbn, pageCount }, progressMode,
        status: 'reading', openedOn, finishedOn: null, idempotencyKey, entries: [], revisions: [],
      };
      shelf(learnerId).push(stored);
      return structuredClone(stored);
    },
    async appendEntry({ learnerId, readingId, on, at = null, page = null, minutes = null, source = 'panel', idempotencyKey = null, ...rest }) {
      const reading = find(learnerId, readingId);
      const duplicate = idempotencyKey && reading.entries.find((row) => row.idempotencyKey === idempotencyKey);
      if (duplicate) return structuredClone(duplicate);
      const stored = {
        id: mint('ent'), on, at: at ?? '2026-09-06T18:00:00.000Z',
        ...(page !== null ? { page } : {}), ...(minutes !== null ? { minutes } : {}),
        ...(rest.note ? { note: rest.note } : {}),
        source, idempotencyKey,
      };
      reading.entries.push(stored);
      return structuredClone(stored);
    },
    async updateReading({ learnerId, readingId, patch = {}, revision = null }) {
      if (!patch || Object.keys(patch).length === 0) throw new Error('patch is empty');
      const reading = find(learnerId, readingId);
      for (const [field, value] of Object.entries(patch)) {
        reading[field] = field === 'book' ? { ...reading.book, ...value } : value;
      }
      if (revision) reading.revisions.push(structuredClone(revision));
      return structuredClone(reading);
    },
    async updateEntry({ learnerId, readingId, entryId, patch = {}, revision = null }) {
      const reading = find(learnerId, readingId);
      const row = reading.entries.find((entry) => entry.id === entryId);
      if (!row) throw new Error(`no entry ${entryId} on reading ${readingId}`);
      Object.assign(row, patch);
      if (revision) reading.revisions.push(structuredClone(revision));
      return structuredClone(row);
    },
    async deleteEntry({ learnerId, readingId, entryId, revision = null }) {
      const reading = find(learnerId, readingId);
      const index = reading.entries.findIndex((entry) => entry.id === entryId);
      if (index < 0) throw new Error(`no entry ${entryId} on reading ${readingId}`);
      const [removed] = reading.entries.splice(index, 1);
      if (revision) reading.revisions.push(structuredClone(revision));
      return removed;
    },
    async deleteReading({ learnerId, readingId }) {
      const rows = shelf(learnerId);
      const index = rows.findIndex((row) => row.id === readingId);
      if (index < 0) throw new Error(`no reading ${readingId} for ${learnerId}`);
      const [removed] = rows.splice(index, 1);
      return removed;
    },
    async moveReading({ learnerId, readingId, toLearnerId, revision = null }) {
      if (learnerId === toLearnerId) throw new Error('a reading cannot move to the shelf it is already on');
      const rows = shelf(learnerId);
      const index = rows.findIndex((row) => row.id === readingId);
      if (index < 0) throw new Error(`no reading ${readingId} for ${learnerId}`);
      const moved = { ...structuredClone(rows[index]), learnerId: toLearnerId };
      if (revision) moved.revisions = [...moved.revisions, structuredClone(revision)];
      shelf(toLearnerId).push(moved);
      rows.splice(index, 1);
      return structuredClone(moved);
    },
  };
}

/** One reading with two logged days, ready to be corrected. */
export function seedReading(overrides = {}) {
  return {
    id: 'rdg_a', learnerId: 'learner_a',
    book: { isbn: '9780000000001', pageCount: 184 },
    progressMode: 'page', status: 'reading',
    openedOn: '2026-09-01', finishedOn: null, idempotencyKey: 'seed',
    entries: [
      { id: 'ent_a', on: '2026-09-02', at: '2026-09-02T18:00:00.000Z', page: 48, source: 'panel', idempotencyKey: 'k1' },
      { id: 'ent_b', on: '2026-09-03', at: '2026-09-03T18:00:00.000Z', page: 84, source: 'panel', idempotencyKey: 'k2' },
    ],
    revisions: [],
    ...overrides,
  };
}

/** A launcher stub: a weekly obligation whose window ends on the study day. */
export function fakeLauncher({ per = 'week', studyDay = '2026-09-06' } = {}) {
  return {
    studyDay: () => studyDay,
    dayOf: (iso) => String(iso ?? '').slice(0, 10),
    status: async () => ({ enrolled: true, obligationProgress: per ? { per, met: false, actual: 4, target: 7, metric: 'checkins' } : null }),
  };
}

export default fakeBookLog;
