/**
 * CloseAcademicPeriod — freezes a `GetReportCard` snapshot into a durable
 * record a family can trust never silently changes under them.
 *
 * Frozen report cards are EVENTS, not documents: a plain re-close is refused
 * (`writeReportCard`'s own `REPORT_CARD_ALREADY_CLOSED` invariant, which the
 * router maps to a 409). The only way to replace a closed period is
 * `supersede: true`, which archives the current freeze to
 * `{periodId}.v<n>.yml` FIRST — the old record is preserved, never destroyed
 * — and only then writes the new one.
 *
 * Gated: only a grown-up may close a period (`GrownUpGate`, the same
 * parent-only-write rule as `SetAssignments`/`ResolveReviewItem`).
 */
export class CloseAcademicPeriod {
  #getReportCard; #datastore; #grownUps; #teacherGate; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('./GetReportCard.mjs').GetReportCard} deps.getReportCard
   * @param {object} deps.datastore - `YamlSchoolDatastore`-shaped:
   *   `writeReportCard`, `archiveReportCard`
   * @param {import('../GrownUpGate.mjs').GrownUpGate} deps.grownUps
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    getReportCard, datastore, grownUps, teacherGate = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!getReportCard) throw new Error('CloseAcademicPeriod requires getReportCard');
    if (!datastore) throw new Error('CloseAcademicPeriod requires datastore');
    if (!grownUps) throw new Error('CloseAcademicPeriod requires grownUps (a GrownUpGate)');
    this.#getReportCard = getReportCard;
    this.#datastore = datastore;
    this.#grownUps = grownUps;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} args.periodId
   * @param {string} args.closedBy - a roster id that must be a grown-up's
   * @param {boolean} [args.supersede]
   * @returns {Promise<object>} the frozen payload: the report plus
   *   `{closedBy, closedAt, supersededVersions}`
   * @throws {import('#domains/school/errors.mjs').GuestForbiddenError} not a grown-up
   * @throws {import('#domains/core/errors/index.mjs').DomainInvariantError}
   *   `REPORT_CARD_ALREADY_CLOSED` on a plain re-close
   */
  async execute({
    learnerId, periodId, closedBy, supersede = false, pin = null,
  } = {}) {
    if (this.#teacherGate) this.#teacherGate.assert({ userId: closedBy, pin, action: 'report-card.close', context: { learnerId, periodId } });
    else this.#grownUps.assert(closedBy, 'Only a grown-up can close a report card', {
      action: 'report-card.close', learnerId, periodId,
    });

    // Generate BEFORE archiving: a report-build failure must never leave a
    // period with NO current frozen record. If archive ran first and the
    // report build then threw, the old freeze would already be
    // archived-and-unlinked with nothing written in its place — the period
    // would 404 on `readReportCard` until someone retried. Building the
    // report first means a build failure leaves the ORIGINAL freeze fully
    // intact (never archived), so `readReportCard` keeps answering with it.
    //
    // RACE (accepted at household scale): generate -> archive -> write is
    // still not one atomic step; the failure window is now just the
    // archive -> write pair. Two concurrent `supersede: true` closes for the
    // SAME learner+period can interleave — worst case, whichever
    // `writeReportCard` lands SECOND simply refuses
    // (`REPORT_CARD_ALREADY_CLOSED`, 409): no freeze is ever silently
    // overwritten or destroyed, the archived copy(ies) already on disk are
    // untouched, and the loser just has to retry. A report card is closed by
    // one parent, rarely, and never from two devices at once in practice, so
    // this gap is left unlocked rather than adding cross-request
    // coordination for a scenario that does not happen.
    const report = await this.#getReportCard.execute({ learnerId, periodId });
    const supersededVersions = supersede
      ? await this.#datastore.archiveReportCard(learnerId, periodId)
      : 0;
    const frozen = {
      ...report, closedBy, closedAt: this.#clock().toISOString(), supersededVersions,
    };
    await this.#datastore.writeReportCard(learnerId, periodId, frozen);
    this.#logger.info?.('school.report-card.closed', {
      learnerId, periodId, closedBy, supersede, supersededVersions,
    });
    return frozen;
  }
}

export default CloseAcademicPeriod;
