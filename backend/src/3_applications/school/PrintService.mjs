/**
 * PrintService — a child prints their own worksheets, gated by a rolling page
 * quota with grown-up approval for anything over it (spec: the print feature).
 *
 * Orchestration only: the quota decision is the domain policy
 * (evaluatePrintQuota), the PDF bytes come from the worksheet renderer or a
 * PDF file, and the bytes go to the network printer via LaserPrinterAdapter.
 * This service wires those together and owns the log + pending queue.
 *
 * A "printable" is config-declared (school.yml `printables:`):
 *   { id, label, type: 'bank'|'pdf', bankId?|file?, subject? }
 * A `bank` printable renders an existing quiz bank as a worksheet; a `pdf`
 * printable prints a file from the data volume. Both resolve to {pdf, pageCount}.
 */
import { evaluatePrintQuota, DEFAULT_PRINT_POLICY, isAdult } from '#domains/school/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

export class PrintService {
  #config; #ds; #printer; #worksheet; #bankReader; #pdfReader; #userService; #logger; #now; #paperCertifyBank; #teacherGate;

  constructor({
    config, datastore, printerAdapter, worksheetRenderer, bankReader, pdfReader, userService,
    logger = console, now = () => Date.now(),
    // Optional paper-certification gate (spec §9/§11): async|sync
    // (bank) => {verdict, reasons}. Null (the default) leaves listPrintables
    // byte-for-byte unchanged — the legacy path the spec exempts.
    paperCertifyBank = null,
    // Optional console write gate (teacher-console spec §1): when present it
    // subsumes the plain adult check on approve/deny (role + pin).
    teacherGate = null,
  }) {
    this.#config = config || {};
    this.#ds = datastore;
    this.#teacherGate = teacherGate;
    this.#printer = printerAdapter;
    this.#worksheet = worksheetRenderer;
    this.#bankReader = bankReader;
    this.#pdfReader = pdfReader;
    this.#userService = userService;
    this.#logger = logger;
    this.#now = now;
    this.#paperCertifyBank = paperCertifyBank;
  }

  get #policy() {
    return { ...DEFAULT_PRINT_POLICY, ...(this.#config.printing || {}) };
  }

  #printableDefs() {
    return Array.isArray(this.#config.printables) ? this.#config.printables : [];
  }

  #findPrintable(id) {
    return this.#printableDefs().find((p) => p.id === id) || null;
  }

  // The rule itself is `#domains/school/people.mjs` — the SAME predicate the
  // lifecycle sign-off and planning writes apply. It used to be written out
  // here, which is how the lifecycle routes came to ship without any copy of it.
  #isAdult(userId) {
    return isAdult({ roster: this.#userService.getHouseholdRoster(), userId, now: this.#now() });
  }

  /** Resolve a printable definition to {pdf, pageCount} for a student. */
  async #resolve(def, { studentName = null } = {}) {
    if (def.type === 'bank') {
      const bank = this.#bankReader.getBank(def.bankId);
      if (!bank) throw new EntityNotFoundError('bank', def.bankId);
      return this.#worksheet.renderBankWorksheet(bank, { studentName });
    }
    if (def.type === 'pdf') {
      const out = this.#pdfReader.read(def.file);
      if (!out?.pdf) throw new EntityNotFoundError('printable-file', def.file);
      return out;
    }
    throw new ValidationError(`unknown printable type: ${def.type}`);
  }

  /** Every printable with its resolved page count (for the picker). */
  async listPrintables() {
    const out = [];
    for (const def of this.#printableDefs()) {
      let pages = null;
      try { pages = (await this.#resolve(def)).pageCount; } catch { pages = null; }

      // Paper-certification gate (spec §9/§11): a `bank` printable whose bank
      // resolves but is incompatible with paper is excluded from the listing
      // and logged once. Only wired when a `paperCertifyBank` was injected;
      // `pdf` defs and banks that fail to resolve are untouched either way.
      if (def.type === 'bank' && this.#paperCertifyBank) {
        const bank = this.#bankReader.getBank(def.bankId);
        if (bank) {
          const result = await this.#paperCertifyBank(bank);
          if (result?.verdict === 'incompatible') {
            this.#logger.warn?.('print.printable-excluded', { printableId: def.id, bankId: def.bankId, reasons: result.reasons });
            continue;
          }
        }
      }

      out.push({ id: def.id, label: def.label, type: def.type, subject: def.subject ?? null, pages });
    }
    return out;
  }

  /** A user's rolling-window usage (for the quota banner). */
  getQuota(userId) {
    const jobs = this.#ds.readPrintLog().filter((j) => j.userId === userId);
    const policy = this.#policy;
    const cutoff = this.#now() - policy.windowMinutes * 60000;
    const pagesInWindow = jobs.reduce((s, j) => {
      const at = Date.parse(j.at);
      return Number.isFinite(at) && at > cutoff ? s + (Number(j.pages) || 0) : s;
    }, 0);
    return {
      pagesInWindow,
      remaining: Math.max(0, policy.pagesPerWindow - pagesInWindow),
      pagesPerWindow: policy.pagesPerWindow,
      windowMinutes: policy.windowMinutes,
    };
  }

  #studentName(userId) {
    return this.#userService.getHouseholdRoster().find((r) => r.id === userId)?.name ?? null;
  }

  async #print(pdf, { jobName, user, copies }) {
    return this.#printer.printPdf(pdf, { jobName, user, copies });
  }

  /**
   * Request a print. Under quota → prints and logs; over quota → files a
   * pending approval request; oversized → denied. Guests cannot print.
   *
   * @returns {Promise<{decision:'printed'|'approval'|'deny', pages:number, remaining?:number, requestId?:string, reason?:string}>}
   */
  async requestPrint({ userId = null, printableId, copies = 1 }) {
    if (!userId) throw new GuestForbiddenError('Sign in to print');
    const def = this.#findPrintable(printableId);
    if (!def) throw new EntityNotFoundError('printable', printableId);

    const nCopies = Math.max(1, Math.min(10, Number(copies) || 1));
    const { pdf, pageCount } = await this.#resolve(def, { studentName: this.#studentName(userId) });
    const pages = pageCount * nCopies;

    const recentJobs = this.#ds.readPrintLog().filter((j) => j.userId === userId);
    const verdict = evaluatePrintQuota({ recentJobs, pages, now: this.#now(), policy: this.#policy });

    if (verdict.decision === 'deny') {
      this.#logger.warn?.('school.print.denied', { userId, printableId, pages, reason: verdict.reason });
      return { decision: 'deny', pages, reason: verdict.reason };
    }

    if (verdict.decision === 'approval') {
      const req = {
        id: `pr_${shortId(8)}`,
        at: new Date(this.#now()).toISOString(),
        userId, printableId, copies: nCopies, pages,
        label: def.label,
        status: 'pending',
      };
      this.#ds.savePrintPending([...this.#ds.readPrintPending(), req]);
      this.#logger.info?.('school.print.approval-requested', { requestId: req.id, userId, printableId, pages });
      return { decision: 'approval', pages, requestId: req.id, reason: verdict.reason };
    }

    await this.#print(pdf, { jobName: `${def.label} — ${this.#studentName(userId) || userId}`, user: userId, copies: nCopies });
    this.#ds.appendPrintLog({ at: new Date(this.#now()).toISOString(), userId, printableId, pages, label: def.label });
    this.#logger.info?.('school.print.printed', { userId, printableId, pages });
    return { decision: 'printed', pages, remaining: Math.max(0, this.#policy.pagesPerWindow - verdict.pagesInWindow - pages) };
  }

  /** Pending approval requests (for the parent surface). */
  listPending() {
    return this.#ds.readPrintPending().filter((r) => r.status === 'pending');
  }

  /** A grown-up approves a pending request: print it, log it, drop it from pending. */
  async approve({ requestId, approver, pin = null }) {
    if (this.#teacherGate) this.#teacherGate.assert({ userId: approver, pin, action: 'print.approve', context: { requestId } });
    else if (!this.#isAdult(approver)) throw new GuestForbiddenError('Only a grown-up can approve a print');
    const pending = this.#ds.readPrintPending();
    const req = pending.find((r) => r.id === requestId && r.status === 'pending');
    if (!req) throw new EntityNotFoundError('print-request', requestId);

    const def = this.#findPrintable(req.printableId);
    if (!def) throw new EntityNotFoundError('printable', req.printableId);
    const { pdf } = await this.#resolve(def, { studentName: this.#studentName(req.userId) });
    await this.#print(pdf, { jobName: `${def.label} — ${this.#studentName(req.userId) || req.userId} (approved)`, user: req.userId, copies: req.copies });

    this.#ds.savePrintPending(pending.filter((r) => r.id !== requestId));
    this.#ds.appendPrintLog({ at: new Date(this.#now()).toISOString(), userId: req.userId, printableId: req.printableId, pages: req.pages, label: def.label, approvedBy: approver });
    this.#logger.info?.('school.print.approved', { requestId, approver, userId: req.userId, pages: req.pages });
    return { decision: 'printed', pages: req.pages };
  }

  /**
   * A grown-up denies a pending request: print nothing, but KEEP the row as
   * a `denied` record (advocacy: the child who asked must be able to see the
   * outcome — a vanished request reads as "lost", not "answered"). Denied
   * rows older than 30 days are pruned on the same write.
   */
  async deny({ requestId, approver, pin = null }) {
    if (this.#teacherGate) this.#teacherGate.assert({ userId: approver, pin, action: 'print.deny', context: { requestId } });
    else if (!this.#isAdult(approver)) throw new GuestForbiddenError('Only a grown-up can deny a print');
    const pending = this.#ds.readPrintPending();
    const req = pending.find((r) => r.id === requestId && r.status === 'pending');
    if (!req) throw new EntityNotFoundError('print-request', requestId);
    const deniedAt = new Date(this.#now()).toISOString();
    const cutoff = this.#now() - 30 * 86400000;
    const next = pending
      .map((r) => (r.id === requestId ? { ...r, status: 'denied', deniedBy: approver, deniedAt } : r))
      .filter((r) => r.status !== 'denied' || Date.parse(r.deniedAt ?? deniedAt) >= cutoff);
    this.#ds.savePrintPending(next);
    this.#logger.info?.('school.print.denied-by-parent', { requestId, approver, userId: req.userId });
    return { decision: 'denied' };
  }

  /**
   * One learner's own requests — pending and denied — newest first, so the
   * child's Print Center can answer "what happened to my ask?".
   */
  listRequestsFor(userId) {
    return this.#ds.readPrintPending()
      .filter((r) => r.userId === userId)
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  }
}

export default PrintService;
