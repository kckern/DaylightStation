/**
 * SchoolRetentionSweep — the one scheduled janitor for the household stores
 * that grew forever (admin advocacy A5): the only prune that existed ran
 * inside PrintService.deny() (so denied rows aged out only when someone
 * denied something else), the print log was a full read-modify-write on
 * every print with no archival, and settled (fulfilled) quiz-request rows
 * were labelled and kept for good.
 *
 * One pass, three moves, all conservative:
 *  - print-log entries older than `printLogDays` move to an append-only
 *    archive (the permanent record survives; the hot quota read shrinks);
 *  - denied print rows older than `deniedDays` drop (the child saw the
 *    outcome weeks ago); pending rows older than `pendingDays` drop too —
 *    a quota ask nobody answered for three months is dead, not pending;
 *  - quiz-request rows whose unit has an authored bank ("fulfilled") and
 *    that are older than `fulfilledDays` drop — the request was answered by
 *    authoring. Retakes/flags are NEVER swept: those are a child's voice,
 *    and only a teacher's gated dismissal (with its delivered reason) may
 *    clear them.
 *
 * Attempts and session events are deliberately untouched: append-only
 * forever is their design, not a leak.
 */
export class SchoolRetentionSweep {
  #ds; #schoolService; #now; #logger;

  constructor({ datastore, schoolService = null, now = () => Date.now(), logger = console } = {}) {
    if (!datastore) throw new Error('SchoolRetentionSweep requires datastore');
    this.#ds = datastore;
    this.#schoolService = schoolService;
    this.#now = now;
    this.#logger = logger;
  }

  async execute({ printLogDays = 180, deniedDays = 30, pendingDays = 90, fulfilledDays = 30 } = {}) {
    const nowMs = this.#now();
    const iso = (days) => new Date(nowMs - days * 86400000).toISOString();

    const archivedPrintLog = this.#ds.archivePrintLogBefore?.(iso(printLogDays)) ?? 0;

    let droppedPrintRows = 0;
    if (this.#ds.readPrintPending && this.#ds.savePrintPending) {
      const pending = this.#ds.readPrintPending();
      const keep = pending.filter((r) => {
        if (r.status === 'denied') return !(r.deniedAt && r.deniedAt < iso(deniedDays));
        if (r.status === 'pending') return !(r.at && r.at < iso(pendingDays));
        return true;
      });
      droppedPrintRows = pending.length - keep.length;
      if (droppedPrintRows) this.#ds.savePrintPending(keep);
    }

    let droppedQuizRequests = 0;
    if (this.#schoolService && this.#ds.readQuizRequests && this.#ds.saveQuizRequests) {
      await this.#schoolService.warmBanks?.();
      // \u0000 join (house rule, 870a9725d): ids can carry ':' (web:kckern
      // is on the prod roster) — a raw colon key can collide.
      const key = (r) => `${r.userId}\u0000${r.unitId ?? ''}`;
      const fulfilled = new Set(
        this.#schoolService.listQuizRequests?.()
          ?.filter((r) => r.fulfilled)
          .map(key) ?? [],
      );
      const list = this.#ds.readQuizRequests();
      const keep = list.filter((r) => {
        if (r.kind) return true; // retakes/flags: a child's voice, never swept
        if (!fulfilled.has(key(r))) return true;
        return !(r.at && r.at < iso(fulfilledDays));
      });
      droppedQuizRequests = list.length - keep.length;
      if (droppedQuizRequests) this.#ds.saveQuizRequests(keep);
    }

    const result = { archivedPrintLog, droppedPrintRows, droppedQuizRequests };
    this.#logger.info?.('school.retention.swept', result);
    return result;
  }
}

export default SchoolRetentionSweep;
