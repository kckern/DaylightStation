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
import { evaluatePrintQuota, DEFAULT_PRINT_POLICY } from '#domains/school/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

export class PrintService {
  #config; #ds; #printer; #worksheet; #bankReader; #pdfReader; #userService; #logger; #now;

  constructor({ config, datastore, printerAdapter, worksheetRenderer, bankReader, pdfReader, userService, logger = console, now = () => Date.now() }) {
    this.#config = config || {};
    this.#ds = datastore;
    this.#printer = printerAdapter;
    this.#worksheet = worksheetRenderer;
    this.#bankReader = bankReader;
    this.#pdfReader = pdfReader;
    this.#userService = userService;
    this.#logger = logger;
    this.#now = now;
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

  #isAdult(userId) {
    const u = this.#userService.getHouseholdRoster().find((r) => r.id === userId);
    if (!u) return false;
    if (!u.birthyear) return false; // unknown age can't approve — fail closed for approval only
    return new Date(this.#now()).getUTCFullYear() - u.birthyear >= 18;
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
  async approve({ requestId, approver }) {
    if (!this.#isAdult(approver)) throw new GuestForbiddenError('Only a grown-up can approve a print');
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

  /** A grown-up denies a pending request: drop it, print nothing. */
  async deny({ requestId, approver }) {
    if (!this.#isAdult(approver)) throw new GuestForbiddenError('Only a grown-up can deny a print');
    const pending = this.#ds.readPrintPending();
    const req = pending.find((r) => r.id === requestId && r.status === 'pending');
    if (!req) throw new EntityNotFoundError('print-request', requestId);
    this.#ds.savePrintPending(pending.filter((r) => r.id !== requestId));
    this.#logger.info?.('school.print.denied-by-parent', { requestId, approver, userId: req.userId });
    return { decision: 'denied' };
  }
}

export default PrintService;
