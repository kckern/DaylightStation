#!/usr/bin/env node
/** File-only Atlas lifecycle proof. This module never constructs a printer adapter. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { ResolveSubjectNext } from '#apps/school/usecases/ResolveSubjectNext.mjs';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { OpenRemediation } from '#apps/school/usecases/OpenRemediation.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';
import { ResolveCardScan } from '#apps/school/documents/ResolveCardScan.mjs';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { YamlPrintDocumentRepository } from '#adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { YamlCurriculumDatastore } from '#adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { createDocumentReceiptRenderer } from '#rendering/school/documents/DocumentReceiptRenderer.mjs';

class MemorySessions {
  logs = new Map();
  async appendEvent(sessionId, event) {
    const events = this.logs.get(sessionId) ?? [];
    const stored = { ...event, sessionId, seq: events.length + 1 };
    events.push(stored); this.logs.set(sessionId, events); return stored;
  }
  async readEvents(sessionId) { return [...(this.logs.get(sessionId) ?? [])]; }
  async listForLearner(learnerId) {
    return [...this.logs.entries()].map(([sessionId, events]) => {
      const state = reduceSession(events);
      return { sessionId, learnerId: state.learnerId, unitId: state.unitId, state: state.state,
        terminal: state.terminal, outcome: state.outcome, updatedAt: events.at(-1)?.at ?? null };
    }).filter((row) => row.learnerId === learnerId);
  }
}

class MemoryTokens {
  records = new Map();
  async put(record) { this.records.set(record.token, record); return record; }
  async get(token) { return this.records.get(token) ?? null; }
}

class MemoryWorksheetInstances {
  records = new Map();
  async findBySession(sessionId) {
    return [...this.records.values()].find((record) => record.sessionId === sessionId) ?? null;
  }
  async put(record) { this.records.set(record.id, structuredClone(record)); return record; }
}

class MemoryAttempts {
  records = [];
  async appendAttempt(learnerId, attempt) { this.records.push({ ...attempt, learnerId }); return attempt; }
  readAllAttempts(learnerId) { return this.records.filter((record) => record.learnerId === learnerId); }
  readAttemptsInRange(learnerId) { return this.readAllAttempts(learnerId); }
}

const DEFAULT_DATA = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const dataDir = path.resolve(arg('data-dir', DEFAULT_DATA));
const courseRoot = path.resolve(arg('course-root', path.join(
  dataDir, 'content/school/curriculum/civilization/young-peoples-atlas-us',
)));
const output = path.resolve(arg('out', path.join(os.tmpdir(), 'daylight-atlas-milo-proof')));
const outcomeMode = arg('outcome', 'pass');
if (!['pass', 'fail'].includes(outcomeMode)) throw new Error('--outcome must be pass or fail');
const lessonRoot = path.join(courseRoot, 'units/00-united-states/lessons/atlas-us-p006-united-states');
const lesson = yaml.load(fs.readFileSync(path.join(lessonRoot, 'index.yml'), 'utf8'));
const assignment = yaml.load(fs.readFileSync(
  path.join(dataDir, 'household/apps/school/assignments/milo.yml'), 'utf8',
));
const course = assignment.courses.find((entry) => entry.courseId === lesson.courseId);
if (!course?.enrollment?.enrollmentId || course.profile !== 'lower') {
  throw new Error('Milo lower Atlas enrollment is missing');
}

fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-atlas-state-'));
try {
  const configService = {
    getDataDir: () => dataDir,
    getHouseholdPath: (relative) => path.join(dataDir, 'household', relative),
  };
  const catalog = new YamlCurriculumDatastore({ configService });
  const school = new YamlSchoolDatastore({ configService });
  const assignments = new YamlAssignmentStore({ configService });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => school.listBankIds(), clock: () => Date.parse('2026-08-13T06:00:00.000Z'),
    logger: { warn() {}, info() {} },
  });
  const sessions = new MemorySessions();
  const tokens = new MemoryTokens();
  let sessionNumber = 0;
  let tokenDraw = 0;
  const agendaBuilder = new BuildAgenda({
    curriculum, assignments, sessions, tokens, timezone: 'America/Los_Angeles',
    clock: () => new Date('2026-08-13T06:00:00.000Z'),
    rng: () => ((++tokenDraw * 0.61803398875) % 1),
    newSessionId: () => `virtual-atlas-${++sessionNumber}`,
    logger: { warn() {}, info() {} },
  });
  const [miloAgenda, felixAgenda] = await Promise.all([
    agendaBuilder.execute({ learnerId: 'milo', learnerName: 'Milo' }),
    agendaBuilder.execute({ learnerId: 'felix', learnerName: 'Felix' }),
  ]);
  const miloOffer = miloAgenda.offers.find((offer) => offer.subject === 'civilization');
  const felixOffer = felixAgenda.offers.find((offer) => offer.subject === 'civilization');
  if (miloOffer?.unitId !== lesson.unitId || felixOffer?.unitId !== lesson.unitId) {
    throw new Error('real agendas did not offer the Atlas opening lesson');
  }
  const agendaTokenRecord = await tokens.get(miloOffer.token);
  if (agendaTokenRecord?.subject?.learnerId !== 'milo' || agendaTokenRecord?.subject?.subject !== 'civilization') {
    throw new Error('Milo agenda QR is not bound to Milo civilization');
  }

  const repository = new YamlPrintDocumentRepository({ directory: scratch });
  const allocationStore = new YamlAllocationStore({ directory: scratch });
  const worksheetInstances = new MemoryWorksheetInstances();
  const renderPrintDocument = new RenderPrintDocument({ repository, allocationStore });
  let worksheetPdf = null;
  const issueDocument = new IssueDocument({
    curriculum, sessions, tokens,
    renderer: { async render() { throw new Error('legacy renderer should not run'); } },
    printer: { async printPdf(bytes) { worksheetPdf = bytes; return { printed: true }; } },
    formMaps: { async put() {} }, bankReader: { getBank: (id) => school.readBankRaw(id) },
    printDocuments: repository, renderPrintDocument, allocationStore,
    assignments, worksheetInstances,
    clock: () => new Date('2026-08-13T06:00:00.000Z'),
    rng: () => ((++tokenDraw * 0.61803398875) % 1),
    logger: { warn() {}, info() {} },
  });
  const subjectResolver = new ResolveSubjectNext({
    curriculum, assignments, sessions, timezone: 'America/Los_Angeles',
    clock: () => new Date('2026-08-13T06:00:00.000Z'),
    newSessionId: () => `virtual-atlas-${++sessionNumber}`, logger: { warn() {}, info() {} },
  });
  const scanRouter = new ResolveScanAction({
    tokens, sessions, curriculum, issueDocument, resolveSubjectNext: subjectResolver,
    resolvePersonalCard: { async execute() { throw new Error('personal-card path should not run'); } },
    dispatchMedia: { async execute() { throw new Error('media path should not run'); } },
    openRemediation: new OpenRemediation({
      curriculum, sessions, clock: () => new Date('2026-08-13T06:07:00.000Z'),
      newSessionId: () => `virtual-atlas-${++sessionNumber}`, logger: { warn() {}, info() {} },
    }),
    receipts: { async print() { return { printed: false }; } },
    clock: () => new Date('2026-08-13T06:00:00.000Z'), logger: { warn() {}, info() {} },
  });
  const scanIssue = await scanRouter.execute({ code: miloOffer.token, device: 'virtual-agenda-scanner' });
  if (scanIssue.status !== 'issued' || scanIssue.physical !== 'worksheet' || !worksheetPdf) {
    throw new Error(`agenda QR did not issue the worksheet: ${JSON.stringify(scanIssue)}`);
  }
  const complete = await worksheetInstances.findBySession(miloOffer.sessionId);
  if (!complete || complete.enrollmentId !== course.enrollment.enrollmentId) {
    throw new Error('issued worksheet instance is not bound to Milo enrollment');
  }
  const source = await repository.getPublished(complete.documentId, complete.documentRevision);
  fs.writeFileSync(path.join(output, 'worksheet-instance.yml'), yaml.dump(complete, { lineWidth: -1, noRefs: true }));
  fs.writeFileSync(path.join(output, 'worksheet-source.yml'), yaml.dump(source, { lineWidth: -1, noRefs: true }));
  fs.writeFileSync(path.join(output, 'worksheet.pdf'), worksheetPdf);

  const pdftoppm = spawnSync('pdftoppm', ['-png', '-f', '1', '-singlefile', path.join(output, 'worksheet.pdf'), path.join(output, 'worksheet')]);
  if (pdftoppm.status !== 0) throw new Error(`pdftoppm failed: ${pdftoppm.stderr}`);

  const answers = {};
  complete.questions.forEach((question, index) => {
    const shouldMiss = outcomeMode === 'fail' && index >= Math.floor(complete.questions.length / 2);
    const letters = question.options.filter((option) => (shouldMiss ? !option.correct : option.correct)).map((option) => option.letter);
    if (shouldMiss) letters.splice(1);
    answers[complete.omr.rowRange.start + index] = question.type === 'multi_select' ? letters : letters[0];
  });
  const grade = await new ResolveCardScan({ allocationStore, repository }).execute({
    testId: complete.omr.cardId, answers,
  });
  const card = grade.results[0];
  const expectedCorrect = outcomeMode === 'pass' ? card?.totalPoints : Math.floor(card?.totalPoints / 2);
  if (!card || card.earnedPoints !== expectedCorrect) throw new Error(`virtual OMR grade did not produce ${expectedCorrect} correct`);
  fs.writeFileSync(path.join(output, 'omr-result.yml'), yaml.dump(grade, { lineWidth: -1, noRefs: true }));

  const receiptRenderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
  const agendaCanvas = await receiptRenderer.createCanvas(miloAgenda.document);
  fs.writeFileSync(path.join(output, 'agenda.png'), agendaCanvas.canvas.toBuffer('image/png'));

  const attempts = new MemoryAttempts();
  const recorded = await new RecordCardScanOutcome({
    datastore: attempts, sessions, clock: () => new Date('2026-08-13T06:05:00.000Z'),
    logger: { warn() {}, info() {} },
  }).execute({ testId: complete.omr.cardId, card });
  if (recorded.session?.advancedTo !== 'graded') throw new Error('paper grade did not advance session to graded');
  let printedResultDocument = null;
  const closed = await new CloseSessionOutcome({
    curriculum, sessions, tokens, assignments, worksheetInstances, timezone: 'America/Los_Angeles', grownUps: { assert() {} },
    receipts: { async print(document) { printedResultDocument = document; return { printed: true }; } },
    clock: () => new Date('2026-08-13T06:06:00.000Z'),
    rng: () => ((++tokenDraw * 0.61803398875) % 1), logger: { warn() {}, info() {} },
  }).execute({ sessionId: complete.sessionId });
  const passed = outcomeMode === 'pass';
  const continuationToken = passed ? closed.nextSubjectToken : closed.retryToken;
  if (passed && (closed.result !== 'passed' || !continuationToken || !closed.unlocked)) {
    throw new Error(`passed paper grade did not mint the next-lesson QR: ${JSON.stringify(closed)}`);
  }
  if (!passed && (closed.result !== 'needs_remediation' || !continuationToken || closed.nextSubjectToken || closed.unlocked)) {
    throw new Error(`failed paper grade did not mint only a retry QR: ${JSON.stringify(closed)}`);
  }
  if (continuationToken === miloOffer.token) throw new Error('result QR reused the agenda token');
  const resultCanvas = await receiptRenderer.createCanvas(printedResultDocument ?? closed.document);
  fs.writeFileSync(path.join(output, 'result-receipt.png'), resultCanvas.canvas.toBuffer('image/png'));

  worksheetPdf = null;
  const nextScanIssue = await scanRouter.execute({
    code: continuationToken, device: 'virtual-result-receipt-scanner',
  });
  if (nextScanIssue.status !== 'issued' || nextScanIssue.physical !== 'worksheet' || !worksheetPdf) {
    throw new Error(`result QR did not issue the next worksheet: ${JSON.stringify(nextScanIssue)}`);
  }
  const nextInstance = await worksheetInstances.findBySession(nextScanIssue.sessionId);
  const expectedNextLesson = passed ? closed.unlocked.unitId : complete.lessonId;
  if (!nextInstance || nextInstance.lessonId !== expectedNextLesson) {
    throw new Error('result QR issued the wrong next lesson');
  }
  if (nextInstance.omr.cardId !== complete.omr.cardId
      || nextInstance.omr.rowRange.start !== complete.omr.rowRange.end + 1) {
    throw new Error('next worksheet did not reuse the answer sheet at its next free row');
  }
  if (!passed) {
    const missed = card.results.filter((row) => row.status !== 'correct').map((row) => row.itemId).sort();
    if (JSON.stringify([...nextInstance.itemIds].sort()) !== JSON.stringify(missed)) {
      throw new Error('retry worksheet did not contain exactly the missed item ids');
    }
  }
  const continuationName = passed ? 'next-worksheet' : 'retry-worksheet';
  fs.writeFileSync(path.join(output, `${continuationName}.pdf`), worksheetPdf);
  fs.writeFileSync(path.join(output, `${continuationName}-instance.yml`), yaml.dump(nextInstance, { lineWidth: -1, noRefs: true }));
  const nextPdfToPng = spawnSync('pdftoppm', [
    '-png', '-f', '1', '-singlefile', path.join(output, `${continuationName}.pdf`), path.join(output, continuationName),
  ]);
  if (nextPdfToPng.status !== 0) throw new Error(`next worksheet pdftoppm failed: ${nextPdfToPng.stderr}`);

  fs.writeFileSync(path.join(output, 'proof.yml'), yaml.dump({
    learnerId: 'milo', profile: course.profile, enrollmentId: course.enrollment.enrollmentId,
    lessonId: lesson.unitId, worksheetInstanceId: complete.id,
    documentId: complete.documentId, documentRevision: complete.documentRevision,
    cardId: complete.omr.cardId, rows: complete.omr.rowRange,
    score: `${card.earnedPoints}/${card.totalPoints}`,
    agenda: {
      milo: { profile: 'lower', unitId: miloOffer.unitId, tokenClass: miloOffer.tokenClass },
      felix: { profile: 'upper', unitId: felixOffer.unitId, tokenClass: felixOffer.tokenClass },
    },
    agendaQr: miloOffer.token,
    agendaScan: { status: scanIssue.status, physical: scanIssue.physical, enrollmentBound: true },
    result: { status: closed.status, outcome: closed.result, unlocked: closed.unlocked, nextQr: closed.nextSubjectToken, retryQr: closed.retryToken },
    nextQrScan: {
      kind: passed ? 'next_lesson' : 'retry', status: nextScanIssue.status, lessonId: nextInstance.lessonId,
      reusedCardId: nextInstance.omr.cardId, rows: nextInstance.omr.rowRange,
    },
    paperAttemptsRecorded: attempts.records.length,
    physicalPrintersInvoked: false, simulatedStateCleared: true,
  }, { lineWidth: -1, noRefs: true }));
  process.stdout.write(`${JSON.stringify({
    ok: true, output, worksheetInstanceId: complete.id, cardId: complete.omr.cardId,
  }, null, 2)}\n`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
