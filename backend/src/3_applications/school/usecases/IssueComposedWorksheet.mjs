/**
 * IssueComposedWorksheet — one physical worksheet for several current lesson
 * sessions.  It deliberately reuses the ordinary immutable worksheet-instance
 * and allocation records: composition changes paper layout, never grading
 * ownership.
 */
import { reduceSession, createEvent, statesAccepting, transitionViolation } from '#domains/school/sessions/sessionEvents.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { createWorksheetInstance, worksheetInstanceDocument, composedWorksheetDocument } from '#domains/school/questionBankV2.mjs';
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { deriveLearnerName, deriveIssueDate } from '#apps/school/documents/reprintContext.mjs';
import { slugify } from '#domains/school/documents/receipts.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { lessonProgressRows } from '#domains/school/lessonProgress.mjs';
import { worksheetPresentation } from '#domains/school/curriculum/worksheetPresentation.mjs';

// Derived from the transition table, not hand-copied — see `IssueDocument`'s
// own ISSUABLE for why the answer is the union of these two events' states.
const ISSUE_FROM = statesAccepting('issued');
const REPRINT_FROM = statesAccepting('reprinted');
const ISSUABLE = new Set([...ISSUE_FROM, ...REPRINT_FROM]);

/**
 * Which event a section's session may take, decided by the SESSION'S STATE.
 *
 * This used to read `section.created ? 'issued' : 'reprinted'` — "did this call
 * mint a worksheet instance?" — which answers a different question entirely. The
 * instance is persisted before the print, so a jammed printer left instances on
 * disk and the retry then emitted `reprinted` for sessions still sitting in
 * `created`; conversely a session already issued a solo sheet has no composed
 * instance yet and got a second `issued`. Both are illegal edges the datastore
 * now refuses — after the composite sheet has already printed.
 *
 * @param {string|null} state
 * @returns {'issued'|'reprinted'|null} null when the session can take neither
 */
function composedEventTypeFor(state) {
  if (ISSUE_FROM.has(state)) return 'issued';
  if (REPRINT_FROM.has(state)) return 'reprinted';
  return null;
}

function answerSheetPolicy(raw) {
  const reuse = raw?.reuse ?? 'after_scan';
  const capacity = raw?.capacity ?? 50;
  if (!['never', 'after_scan', 'school_day', 'until_full'].includes(reuse)) throw new Error(`unknown answer-sheet reuse policy '${reuse}'`);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) throw new Error('answer-sheet capacity must be 1..50');
  return { reuse, capacity };
}

function chunksForCard(sections, capacity) {
  const chunks = [];
  let current = [];
  let count = 0;
  for (const section of sections) {
    const size = section.instance.questions.length;
    if (size > capacity) throw new Error(`lesson '${section.instance.lessonId}' exceeds one answer card`);
    if (current.length && count + size > capacity) { chunks.push(current); current = []; count = 0; }
    current.push(section); count += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export class IssueComposedWorksheet {
  #curriculum; #sessions; #assignments; #worksheetInstances; #bankReader;
  #printDocuments; #render; #allocations; #publish; #printer; #issuedArtifacts; #teacherGate; #clock; #logger; #policy;

  constructor({
    curriculum, sessions, assignments, worksheetInstances, bankReader,
    printDocuments, renderPrintDocument, allocationStore, printer,
    publishPrintDocument = null, issuedArtifacts = null, answerSheetPolicy: policy = null,
    teacherGate = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!curriculum || !sessions || !assignments || !worksheetInstances || !bankReader
      || !printDocuments || !renderPrintDocument || !allocationStore || !printer) {
      throw new Error('IssueComposedWorksheet requires curriculum, sessions, assignments, worksheetInstances, bankReader, printDocuments, renderPrintDocument, allocationStore, and printer');
    }
    this.#curriculum = curriculum; this.#sessions = sessions; this.#assignments = assignments;
    this.#worksheetInstances = worksheetInstances; this.#bankReader = bankReader;
    this.#printDocuments = printDocuments; this.#render = renderPrintDocument; this.#allocations = allocationStore;
    this.#publish = publishPrintDocument ?? new PublishPrintDocument({ repository: printDocuments });
    this.#printer = printer; this.#issuedArtifacts = issuedArtifacts; this.#teacherGate = teacherGate;
    this.#clock = clock; this.#logger = logger; this.#policy = answerSheetPolicy(policy);
  }

  async execute({ sessionIds, issuedBy = null, pin = null } = {}) {
    const ids = [...new Set(Array.isArray(sessionIds) ? sessionIds : [])];
    if (!ids.length) throw new Error('IssueComposedWorksheet requires one or more sessionIds');
    // A combined paper handout is a teacher decision: it changes what is
    // physically issued and can cause a printer dispatch.  Keep the server
    // as the authority even when a console supplies a claimed teacher stamp.
    this.#teacherGate?.assert({
      userId: issuedBy, pin, action: 'worksheet.compose', context: { sessionIds: ids },
    });
    const nowIso = this.#clock().toISOString();
    const works = await this.#curriculum.listWorks?.() ?? [];
    const prepared = [];
    for (const sessionId of ids) {
      // eslint-disable-next-line no-await-in-loop
      prepared.push(await this.#prepareSection({ sessionId, nowIso, works }));
    }
    const learnerId = prepared[0].state.learnerId;
    if (!learnerId || prepared.some((entry) => entry.state.learnerId !== learnerId)) {
      throw new Error('a composed worksheet must contain sessions for one learner');
    }
    const outputs = [];
    const chunks = chunksForCard(prepared, this.#policy.capacity);
    for (let index = 0; index < chunks.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      outputs.push(await this.#issueChunk({
        sections: chunks[index], learnerId, nowIso, part: index + 1, parts: chunks.length,
      }));
    }
    return { learnerId, parts: outputs, sessionIds: ids };
  }

  async #prepareSection({ sessionId, nowIso, works }) {
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId || !ISSUABLE.has(state.state)) throw new Error(`session '${sessionId}' is not issuable`);
    const unit = await this.#curriculum.getUnit(state.unitId);
    if (!unit?.bank || unit.document) throw new Error(`session '${sessionId}' is not a bank-only lesson`);
    // A COMPOSED SHEET HAS NO GATE ROW TO GIVE.
    //
    // The gate row is minted in `IssueDocument#prepareCompanion`, which is
    // called from the SOLO bank-worksheet path and nowhere else. Nothing here
    // prepares a companion, so before this refusal a grown-up who selected two
    // open sessions and pressed "print together" got one sheet with NO gate row
    // for a `participation: required` lesson — and a sheet with no gate row
    // passes on score alone, silently, which is exactly what the gate exists to
    // stop.
    //
    // A gate row PER SECTION is a feature, not a fix: `COMPANION_GATE_ITEM_ID`
    // is one fixed constant ("a worksheet has exactly one gate"), so two gated
    // sections would mint two extra items sharing one id, collide in
    // `mergeBank`, and `ResolveCardScan`'s single
    // `find(row => row.itemType === 'companion_code')` would return only the
    // first — the second lesson's gate vanishing without a word.
    //
    // Refusing HERE, rather than later, is what keeps it cheap: this runs
    // before this section publishes anything, before any card is allocated, and
    // before the printer is touched, so the batch costs nothing and every
    // session keeps the state it had.
    if (unit.companion?.enabled !== false && unit.companion?.participation === 'required') {
      this.#logger.warn?.('school.composed-worksheet.companion-gate-unsupported', {
        sessionId, lessonId: unit.unitId, learnerId: state.learnerId,
      });
      throw new Error(`lesson '${unit.unitId}' has a required read-along, so it has to be printed on its own`);
    }
    const assignment = await this.#assignments.get(state.learnerId);
    const course = (assignment?.courses ?? []).find((entry) => entry.courseId === unit.courseId
      || Object.values(entry.enrollment?.lessonOrder ?? {}).flat().includes(unit.unitId));
    const enrollmentId = course?.enrollment?.enrollmentId;
    const profile = course?.profile ?? course?.enrollment?.profile;
    if (!enrollmentId || !profile) throw new Error(`session '${sessionId}' has no active enrollment`);
    const work = (works ?? []).find((candidate) => candidate?.work === unit.courseId) ?? null;
    const presentation = worksheetPresentation({ unit, work, enrollment: course?.enrollment });

    let instance = await this.#worksheetInstances.findBySession(sessionId);
    let created = false;
    if (!instance) {
      const bank = this.#bankReader.getBank(unit.bank);
      if (!bank) throw new Error(`lesson '${unit.unitId}' has no question bank`);
      instance = createWorksheetInstance({
        id: `${slugify(unit.subject ?? 'school')}/${slugify(course.courseId ?? unit.courseId ?? 'course')}/ws-${slugify(sessionId)}`,
        sessionId, bank, learnerId: state.learnerId, enrollmentId, lessonId: unit.unitId,
        profile, seed: `${sessionId}:${state.variant ?? 0}`, issuedAt: nowIso,
        itemIds: state.remediationOf && state.remediationItemIds?.length ? state.remediationItemIds : null,
      });
      const published = await this.#publish.execute({ source: worksheetInstanceDocument(instance, {
        title: unit.title, description: unit.description ?? null,
        printedPages: unit.provenance?.printed_pages ?? [],
      }) });
      instance = { ...instance, documentId: published.id, documentRevision: published.rev };
      created = true;
    }
    return {
      id: `section-${slugify(sessionId)}`, instance, created, state, unit,
      // Decided here, from the state this section was READ at, and re-checked
      // once more before the printer is touched (see #issueChunk).
      eventType: composedEventTypeFor(state.state),
      subjectId: unit.subject ?? 'school', courseId: unit.courseId ?? null,
      subject: unit.subject ?? 'School', course: work?.title ?? unit.courseTitle ?? unit.courseId ?? null,
      breadcrumb: presentation.breadcrumb,
      title: unit.title, reading: presentation.reading, citation: presentation.citation,
      sourceTitle: presentation.sourceTitle, passPercent: unit.passing?.percent ?? null,
      printedPages: presentation.printedPages,
    };
  }

  async #issueChunk({ sections, learnerId, nowIso, part, parts }) {
    const sectionsWithProgress = await Promise.all(sections.map(async (section) => ({
      ...section,
      progress: await this.#lessonProgress({ section, nowIso }),
    })));
    const compositionId = `composed/${slugify(learnerId)}/ws-${shortId(10)}-${part}`;
    const composition = composedWorksheetDocument({
      id: compositionId, seed: `${nowIso}:${compositionId}`, title: 'Worksheet',
      subtitle: parts > 1 ? `Part ${part} of ${parts}` : null, sections: sectionsWithProgress,
    });
    const published = await this.#publish.execute({ source: composition.source });
    const document = await this.#printDocuments.getPublished(published.id, published.rev);
    const learnerName = deriveLearnerName(learnerId);
    const issueDate = deriveIssueDate(nowIso);
    const rowsNeeded = sections.reduce((sum, section) => sum + section.instance.questions.length, 0);
    const reusable = parts === 1 && typeof this.#allocations.findReusableCard === 'function'
      ? await this.#allocations.findReusableCard({ learnerId, rowsNeeded, capacity: this.#policy.capacity, reuse: this.#policy.reuse })
      : null;
    let rendered;
    try {
      rendered = await this.#render.execute({
        document,
        context: {
          ...(reusable ?? { freshCard: true }), learnerId, learnerName, date: issueDate,
          sectionAttribution: composition.sections,
        },
      });
    } catch (err) {
      if (err.details?.allocation?.cardId) await this.#allocations.release({ cardId: err.details.allocation.cardId });
      throw err;
    }
    const records = await this.#allocations.findByCard(rendered.allocation.cardId);
    const allocation = records.find((record) => record.recordId === rendered.allocation.recordId);
    const bySectionId = new Map((allocation?.sections ?? []).map((section) => [section.id, section]));
    const newlyCreated = sections.filter((section) => section.created);
    for (const section of newlyCreated) {
      const owned = bySectionId.get(section.id);
      if (!owned) throw new Error(`allocation did not retain section '${section.id}'`);
      const instance = {
        ...section.instance,
        omr: { cardId: rendered.allocation.cardId, recordId: rendered.allocation.recordId, rowRange: owned.rowRange },
      };
      // eslint-disable-next-line no-await-in-loop
      await this.#worksheetInstances.put(instance);
      section.instance = instance;
    }
    // A composition is one physical paper artifact shared by all of its
    // sessions. Retain it before dispatch; history must never substitute the
    // individual source worksheets for the combined handout a learner held.
    if (this.#issuedArtifacts) {
      await this.#issuedArtifacts.put({
        artifactId: compositionId,
        bytes: Buffer.isBuffer(rendered.bytes) ? rendered.bytes : Buffer.from(rendered.bytes),
        pageCount: rendered.pageCount ?? null,
        issuedAt: nowIso,
        sessionIds: sections.map((section) => section.state.sessionId),
        learnerId,
        kind: 'worksheet-composition',
        captureKind: 'original',
        document: { id: published.id, rev: published.rev, title: document.title ?? composition.source.title },
        allocation: rendered.allocation,
        renderContext: {
          learnerId, learnerName, date: issueDate, duplex: rendered.duplex ?? null,
          compositionId, part, parts,
          sections: sections.map((section) => ({
            sessionId: section.state.sessionId, worksheetInstanceId: section.instance.id,
            lessonId: section.instance.lessonId, title: section.title,
          })),
        },
      });
    }
    // ALL-OR-NOTHING, and the gate stands BEFORE the printer.
    //
    // The loop below has no rollback: it appends one event per session against a
    // single composite sheet that is already in the teacher's hand by then. If a
    // section turns out to have nowhere legal to record its issue, aborting
    // mid-loop leaves half the batch recorded and a piece of paper the record
    // disagrees with — the one outcome a parent reading this log can never
    // reconstruct. So every section's event is proved legal here, while the only
    // thing that has to be undone is a card allocation.
    const illegal = sections
      .map((section) => ({
        sessionId: section.state.sessionId, from: section.state.state,
        reason: section.eventType
          ? transitionViolation(section.state.state, section.eventType)
          : `session cannot be issued from state ${section.state.state}`,
      }))
      .filter((row) => row.reason);
    if (illegal.length) {
      this.#logger.warn?.('school.composed-worksheet.refused', { compositionId, learnerId, illegal });
      await this.#allocations.release({ cardId: rendered.allocation.cardId });
      throw new DomainInvariantError(
        `composed worksheet cannot be recorded for ${illegal.map((row) => row.sessionId).join(', ')}`,
        { code: 'COMPOSED_ISSUE_NOT_RECORDABLE', details: { compositionId, sessions: illegal } },
      );
    }
    let printResult;
    try {
      printResult = await this.#printer.printPdf(rendered.bytes, {
        jobName: `school-${compositionId}`, user: learnerId, duplex: rendered.duplex ?? undefined,
      });
    } catch (err) {
      await this.#allocations.release({ cardId: rendered.allocation.cardId });
      throw err;
    }
    for (const section of sections) {
      const { errors, event } = createEvent({
        type: section.eventType, at: nowIso, sessionId: section.state.sessionId, artifactId: compositionId,
        // Preview/capture printers can explicitly say no physical paper was
        // dispatched.  Preserve the issue lineage but do not arm the real
        // print cooldown from a sheet that never reached the tray.
        confirmed: printResult?.confirmed !== false,
      });
      if (errors.length) throw new Error(`could not record composed issue: ${errors.join('; ')}`);
      // eslint-disable-next-line no-await-in-loop
      await this.#sessions.appendEvent(section.state.sessionId, event);
    }
    this.#logger.info?.('school.composed-worksheet.printed', {
      compositionId, learnerId, sessionIds: sections.map((section) => section.state.sessionId),
      cardId: rendered.allocation.cardId,
    });
    return {
      compositionId, documentId: published.id, revision: published.rev,
      allocation: rendered.allocation, pageCount: rendered.pageCount,
      sessionIds: sections.map((section) => section.state.sessionId),
    };
  }

  async #lessonProgress({ section, nowIso }) {
    if (!section.unit?.courseId || typeof this.#curriculum.listUnits !== 'function'
      || typeof this.#sessions.listForLearner !== 'function') return null;
    const [assignment, units, sessions, works] = await Promise.all([
      this.#assignments.get(section.state.learnerId), this.#curriculum.listUnits(),
      this.#sessions.listForLearner(section.state.learnerId), this.#curriculum.listWorks?.() ?? [],
    ]);
    return lessonProgressRows({
      learnerId: section.state.learnerId, unit: section.unit, assignment, units, sessions, works, now: nowIso,
    });
  }
}

export default IssueComposedWorksheet;
