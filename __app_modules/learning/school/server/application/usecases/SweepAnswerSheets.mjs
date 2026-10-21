/**
 * SweepAnswerSheets — keeps every OMR card's rows accounted for.
 *
 * A failed attempt is supposed to `vacate` its window on the spot
 * (`IssueDocument#orphanAllocation`), which holds the rows for that unit's
 * regeneration. 2026-10-10 showed what happens when a path forgets: a print
 * timeout froze one session, and each of its retries left three `live` rows
 * on the child's card. Later sheets landed past them, so the card carried
 * blank stripes nobody could fill, and nothing noticed for ten days.
 *
 * This pass runs nightly beside the stale-session sweep, and on demand:
 *
 *   1. LEAKS — a session-bound window still `live`/`pending` after
 *      `leakAfterHours` (default 2) never reached paper unless an issued artifact of its
 *      session names it. Those are vacated, and each one is a code path that
 *      forgot to clean up, so it logs at `warn`. Session-less records (CLI
 *      renders) are never touched: their delivery is never confirmed, and some
 *      are cards in a child's hands.
 *   2. WRITE-OFFS — a vacated window whose unit the child has since passed,
 *      or whose session was abandoned with nothing open left for its unit,
 *      may be filled by a different sheet of the same size; one on a card the
 *      child has moved off can never be reclaimed at all.
 *   3. ACCEPTED GAPS — a stranded window below later sheets is a permanent
 *      blank stripe. It is logged once, when written off, so the rare
 *      perfect-storm case stays visible.
 *
 * `vacateSession` is the same leak rule for one session, used the moment a
 * session is abandoned so the next sheet never lands past its rows.
 */
const HOUR_MS = 3600000;
/**
 * A real reservation is `pending` only for the seconds a print takes, so two
 * hours is far past any live attempt, yet short enough that the 02:20 run
 * frees an evening's leaks before the next school day's first sheet.
 */
export const DEFAULT_LEAK_AFTER_HOURS = 2;

export class SweepAnswerSheets {
  #allocationStore; #sessions; #issuedArtifacts; #teacherGate; #clock; #logger;

  /**
   * @param {object} deps
   * @param {object} deps.allocationStore - `YamlAllocationStore`-shaped (listCardIds, findByCard,
   *   vacate, writeOff, currentCardIdFor)
   * @param {object} deps.sessions - `IWorkSessionRepository` (readEvents, listForLearner)
   * @param {{get: Function}} [deps.issuedArtifacts] - resolves which allocation an issued sheet used
   * @param {{assert: Function}} [deps.teacherGate] - required for a grown-up's non-dry run
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    allocationStore, sessions, issuedArtifacts = null, teacherGate = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!allocationStore?.vacate || !allocationStore?.writeOff) {
      throw new Error('SweepAnswerSheets requires an allocationStore with vacate and writeOff');
    }
    if (!sessions?.readEvents || !sessions?.listForLearner) {
      throw new Error('SweepAnswerSheets requires sessions with readEvents and listForLearner');
    }
    this.#allocationStore = allocationStore;
    this.#sessions = sessions;
    this.#issuedArtifacts = issuedArtifacts;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ dryRun = false, leakAfterHours = DEFAULT_LEAK_AFTER_HOURS } = {}) {
    const cutoff = this.#clock().getTime() - leakAfterHours * HOUR_MS;
    const cards = await this.#loadCards();
    const context = this.#context();
    const leaksRecovered = [];
    const writtenOff = [];
    const gapsAccepted = [];

    for (const card of cards) {
      for (const [index, record] of card.records.entries()) {
        if (!isPendingSessionWindow(record) || !(Date.parse(record.renderedAt) < cutoff)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await context.onPaper(record)) continue;
        // eslint-disable-next-line no-await-in-loop
        const unitId = record.unitId ?? (await context.sessionRow(record)).unitId ?? null;
        const entry = summary(record, { unitId, ageHours: Math.floor((this.#clock().getTime() - Date.parse(record.renderedAt)) / HOUR_MS) });
        if (!dryRun) {
          // eslint-disable-next-line no-await-in-loop
          await this.#allocationStore.vacate({ cardId: card.cardId, recordId: record.recordId, unitId, reason: 'leak' });
        }
        card.records[index] = { ...record, unitId, status: 'vacated', deliveryState: 'cancelled' };
        leaksRecovered.push(entry);
        this.#logger.warn?.('school.allocation.leak-recovered', { ...entry, dryRun });
      }
    }

    for (const card of cards) {
      for (const record of card.records) {
        if (record.status !== 'vacated' || record.writtenOffAt) continue;
        // eslint-disable-next-line no-await-in-loop
        const reason = await this.#writeOffReason(card, record, context);
        if (!reason) continue;
        const entry = summary(record, { reason });
        if (!dryRun) {
          // eslint-disable-next-line no-await-in-loop
          await this.#allocationStore.writeOff({ cardId: card.cardId, recordId: record.recordId, reason });
        }
        writtenOff.push(entry);
        this.#logger.info?.('school.allocation.written-off', { ...entry, dryRun });
        if (reason === 'card-moved-on' && hasLaterSheet(card.records, record)) {
          gapsAccepted.push(entry);
          this.#logger.warn?.('school.allocation.gap-accepted', { ...entry, dryRun });
        }
      }
    }

    const result = { dryRun, leaksRecovered, writtenOff, gapsAccepted };
    this.#logger.info?.('school.allocation.sweep-ran', {
      dryRun, leaksRecovered: leaksRecovered.length, writtenOff: writtenOff.length, gapsAccepted: gapsAccepted.length,
    });
    return result;
  }

  /**
   * The on-demand run (`school ops sweep`). Looking is open; writing is a
   * grown-up's decision, same as abandoning a session by hand.
   */
  async runForGrownUp({ decidedBy = null, pin = null, dryRun = true, leakAfterHours = DEFAULT_LEAK_AFTER_HOURS } = {}) {
    if (!dryRun) {
      if (!this.#teacherGate) throw new Error('SweepAnswerSheets has no teacher gate; only dry runs are allowed');
      this.#teacherGate.assert({ userId: decidedBy, pin, action: 'answer-sheets.sweep', context: {} });
    }
    return this.execute({ dryRun, leakAfterHours });
  }

  /**
   * Vacate every window of one session that is not on paper. Called when the
   * session is abandoned; never throws, because the abandon already happened.
   */
  async vacateSession({ sessionId, unitId = null, reason = 'abandoned' } = {}) {
    const vacated = [];
    try {
      const context = this.#context();
      for (const card of await this.#loadCards()) {
        for (const record of card.records) {
          if (!isPendingSessionWindow(record) || record.sessionId !== sessionId) continue;
          // eslint-disable-next-line no-await-in-loop
          if (await context.onPaper(record)) continue;
          // eslint-disable-next-line no-await-in-loop
          const done = await this.#allocationStore.vacate({
            cardId: card.cardId, recordId: record.recordId, unitId: record.unitId ?? unitId, reason,
          });
          if (done) vacated.push(summary(done, {}));
        }
      }
      if (vacated.length) this.#logger.info?.('school.allocation.session-vacated', { sessionId, reason, windows: vacated });
    } catch (error) {
      this.#logger.warn?.('school.allocation.session-vacate-failed', { sessionId, error: error?.message ?? String(error) });
    }
    return vacated;
  }

  async #writeOffReason(card, record, context) {
    const current = await context.currentCard(record.learnerId);
    if (current !== card.cardId) return 'card-moved-on';
    if (record.unitId && (await context.unitPassed(record.learnerId, record.unitId))) return 'unit-passed';
    // An abandoned session with nothing open for its unit will not be
    // regenerated (a dated lesson the agenda has moved past), so the rows go
    // to the next sheet of the same size. Should the unit come back after
    // all, its own windows still win: same-unit reclaim ignores write-offs.
    if (record.unitId && (await context.unitAbandoned(record))) return 'session-abandoned';
    return null;
  }

  async #loadCards() {
    const ids = await this.#allocationStore.listCardIds();
    const cards = [];
    for (const cardId of ids) {
      // eslint-disable-next-line no-await-in-loop
      cards.push({ cardId, records: await this.#allocationStore.findByCard(cardId) });
    }
    return cards;
  }

  /** Per-run memo of the session, artifact and card lookups the rules ask repeatedly. */
  #context() {
    const rowsByLearner = new Map();
    const paperBySession = new Map();
    const currentByLearner = new Map();
    const rowsFor = async (learnerId) => {
      if (!rowsByLearner.has(learnerId)) {
        rowsByLearner.set(learnerId, await this.#sessions.listForLearner(learnerId).catch(() => []));
      }
      return rowsByLearner.get(learnerId);
    };
    return {
      sessionRow: async (record) => (await rowsFor(record.learnerId)).find((row) => row.sessionId === record.sessionId) ?? {},
      unitPassed: async (learnerId, unitId) => (await rowsFor(learnerId))
        .some((row) => row.unitId === unitId && row.outcome?.result === 'passed'),
      unitAbandoned: async (record) => {
        const rows = await rowsFor(record.learnerId);
        const own = rows.find((row) => row.sessionId === record.sessionId);
        return own?.state === 'abandoned'
          && !rows.some((row) => row.unitId === record.unitId && !row.terminal);
      },
      currentCard: async (learnerId) => {
        if (!currentByLearner.has(learnerId)) {
          currentByLearner.set(learnerId, await this.#allocationStore.currentCardIdFor(learnerId));
        }
        return currentByLearner.get(learnerId);
      },
      onPaper: async (record) => {
        if (!paperBySession.has(record.sessionId)) {
          paperBySession.set(record.sessionId, await this.#issuedRecordIds(record.sessionId));
        }
        const issued = paperBySession.get(record.sessionId);
        // An unreadable session is never evidence of a leak.
        return issued === null || issued.has(record.recordId);
      },
    };
  }

  /** The allocation ids this session's issued sheets were printed on; null when that cannot be known. */
  async #issuedRecordIds(sessionId) {
    const events = await this.#sessions.readEvents(sessionId).catch(() => null);
    if (!Array.isArray(events)) return null;
    const artifactIds = events
      .filter((event) => (event.type === 'issued' || event.type === 'reprinted') && event.artifactId)
      .map((event) => event.artifactId);
    if (!artifactIds.length) return new Set();
    if (!this.#issuedArtifacts?.get) return null;
    const ids = new Set();
    for (const artifactId of artifactIds) {
      // eslint-disable-next-line no-await-in-loop
      const artifact = await this.#issuedArtifacts.get(artifactId).catch(() => undefined);
      if (artifact === undefined) return null;
      const recordId = artifact?.manifest?.allocation?.recordId;
      if (recordId) ids.add(recordId);
    }
    return ids;
  }
}

function isPendingSessionWindow(record) {
  return record.status === 'live' && record.deliveryState === 'pending' && typeof record.sessionId === 'string';
}

function hasLaterSheet(records, window) {
  return records.some((record) => record.deliveryState !== 'cancelled' && record.rowRange.start > window.rowRange.end);
}

function summary(record, extra) {
  return {
    cardId: record.cardId, recordId: record.recordId, rows: record.rowRange,
    learnerId: record.learnerId ?? null, sessionId: record.sessionId ?? null, unitId: record.unitId ?? null,
    ...extra,
  };
}

export default SweepAnswerSheets;
