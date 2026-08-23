#!/usr/bin/env node
/**
 * `school sim` — a file-only, end-to-end proof of the school worksheet
 * lifecycle for ANY course.
 *
 * Runs the real use cases — agenda, QR scan, IssueDocument, RenderPrintDocument,
 * ResolveCardScan, RecordCardScanOutcome, CloseSessionOutcome, remediation —
 * against a throwaway state directory that is deleted when it finishes. It
 * never constructs a printer adapter and never writes to the household tree,
 * so card ids and student numbers minted here are simulation-only and are NOT
 * scannable on real hardware. That is the point: the whole grading workflow
 * can be exercised without consuming a physical card or touching a learner's
 * real record.
 *
 * Reads the live content and assignment tree (read-only) so the proof runs
 * against real curriculum rather than fixtures.
 */
import fs from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { ResolvePersonalCard } from '#apps/school/usecases/ResolvePersonalCard.mjs';
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

  /**
   * The collision surface a panel-code mint draws against. Live means what
   * `getByAccessCode` would resolve: unexpired, unrevoked, `subject_next`.
   * Needed for `--self-service`; without it `BuildAgenda` refuses to construct.
   */
  async liveAccessCodes() {
    const at = Date.now();
    const live = new Set();
    for (const record of this.records.values()) {
      if (record.tokenClass !== 'subject_next') continue;
      if (record.revokedAt) continue;
      if (!record.accessCode) continue;
      if (record.accessCodeExpiresAt && Date.parse(record.accessCodeExpiresAt) <= at) continue;
      live.add(record.accessCode);
    }
    return live;
  }

  /** The reverse lookup a typed code resolves through. */
  async getByAccessCode(code) {
    for (const record of this.records.values()) {
      if (record.accessCode === code && !record.revokedAt) return record;
    }
    return null;
  }
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

// The data dir comes from the environment, like every other school CLI
// (`omr.mjs`, `docs.mjs`). It used to be a hardcoded macOS Dropbox path, which
// made this command unusable on any other machine — including the production
// host, where it failed with ENOENT on a `/Users/...` directory that has never
// existed there. A tool for proving the lifecycle is worth nothing if it only
// runs on one laptop.
dotenv.config({ path: join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
const DEFAULT_DATA = process.env.DAYLIGHT_BASE_PATH
  ? join(process.env.DAYLIGHT_BASE_PATH, 'data')
  : null;
let ARGV = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = ARGV.indexOf(`--${name}`);
  return at >= 0 ? ARGV[at + 1] : fallback;
};
export async function main(argv = process.argv.slice(2)) {
  ARGV = argv;
  const dataDirArg = arg('data-dir', DEFAULT_DATA);
  if (!dataDirArg) {
    throw new Error('no data dir: pass --data-dir or set DAYLIGHT_BASE_PATH in .env');
  }
  const dataDir = path.resolve(dataDirArg);

  // Which course, which lesson, which two learners — all supplied. Nothing here
  // is specific to any one course; the Atlas was simply the first one proved.
  const SUBJECT = arg('subject', null);
  const COURSE = arg('course', null);
  const LESSON = arg('lesson', null);
  const LOWER_ID = arg('lower', null);
  const UPPER_ID = arg('upper', null);
  if (!SUBJECT || !COURSE || !LOWER_ID) {
    throw new Error('usage: school sim --subject <s> --course <c> [--lesson <unit/lesson>] '
      + '--lower <learnerId> [--upper <learnerId>] [--outcome pass|fail] [--out <dir>]');
  }
  const courseRoot = path.resolve(arg('course-root', path.join(
    dataDir, 'content/school', SUBJECT, COURSE,
  )));
  const output = path.resolve(arg('out', path.join(os.tmpdir(), `daylight-school-sim-${COURSE}`)));
  const outcomeMode = arg('outcome', 'pass');
  if (!['pass', 'fail'].includes(outcomeMode)) throw new Error('--outcome must be pass or fail');
  // Self-service is what mints the six-digit panel code beside each QR. Off by
  // default (matching an install that has not turned it on), but exercisable —
  // without this flag the "every printed QR carries its own code" property
  // simply could not be checked from this CLI at all.
  const selfService = ARGV.includes('--self-service') ? { enabled: true } : null;
  const BUBBLE_MODE = ARGV.includes('--triple-bubble') ? 'triple'
    : (ARGV.includes('--double-bubble') ? 'double' : null);

  // Default to the course's first lesson in sequence, so a caller who only
  // names a course still gets a runnable proof.
  //
  // COURSE LAYOUT, as it actually is on disk. This used to walk
  // `units/<unit>/lessons/<lesson>/index.yml` — a shape no course in the tree
  // uses any more, so the command failed with ENOENT on `units` for every one
  // of them. A `school.course/v2` course is `<NN-module>/<lesson>.yml`, with
  // `_index.yml` at the root describing the course itself. The old shape is
  // still accepted first, so a course that has not been migrated keeps working.
  function firstLesson(root) {
    const legacyUnits = path.join(root, 'units');
    if (fs.existsSync(legacyUnits)) {
      for (const unit of fs.readdirSync(legacyUnits).sort()) {
        const lessonsRoot = path.join(legacyUnits, unit, 'lessons');
        if (!fs.existsSync(lessonsRoot)) continue;
        for (const dir of fs.readdirSync(lessonsRoot).sort()) {
          if (fs.existsSync(path.join(lessonsRoot, dir, 'index.yml'))) return path.join('units', unit, 'lessons', dir);
        }
      }
    }
    // `_index.yml` is the COURSE, not a lesson, and a leading `_` marks every
    // non-lesson file in this tree — skip the lot rather than name them.
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const moduleRoot = path.join(root, entry.name);
      for (const file of fs.readdirSync(moduleRoot).sort()) {
        if (file.startsWith('_') || !file.endsWith('.yml')) continue;
        return path.join(entry.name, file);
      }
    }
    throw new Error(`no lesson found under ${root}`);
  }
  const lessonRel = LESSON ?? firstLesson(courseRoot);
  const lessonPath = path.join(courseRoot, lessonRel);
  // v2 lessons are a single YAML file; the legacy shape was a directory with
  // an `index.yml` inside it. Accept either, so this runs against both.
  const lessonFile = fs.existsSync(lessonPath) && fs.statSync(lessonPath).isDirectory()
    ? path.join(lessonPath, 'index.yml')
    : lessonPath;
  const lessonRoot = path.dirname(lessonFile);
  const lessonRaw = yaml.load(fs.readFileSync(lessonFile, 'utf8'));
  // A v2 lesson file is a QUESTION BANK (`school.question-bank/v2`) and carries
  // neither `courseId` nor `unitId` — the legacy shape carried both. The course
  // is the one the caller named (the same id the enrollment uses), and the unit
  // is the bank's own `unit`. Legacy keys still win when present, so an
  // unmigrated course behaves exactly as before.
  const lesson = {
    ...lessonRaw,
    courseId: lessonRaw.courseId ?? COURSE,
    unitId: lessonRaw.unitId ?? lessonRaw.unit ?? null,
  };
  if (!lesson.unitId) throw new Error(`lesson ${lessonRel} names no unit`);
  const assignment = yaml.load(fs.readFileSync(
    path.join(dataDir, 'household/school/plans/learners', `${LOWER_ID}.yml`), 'utf8',
  ));
  // `enrollments` is the on-disk key; `courses` is what `YamlAssignmentStore`
  // normalizes it to. This reads the file directly rather than through the
  // store, so it has to know both — it used to know only `courses` and threw
  // "Cannot read properties of undefined" on every real learner file.
  const enrolments = assignment.enrollments ?? assignment.courses ?? [];
  const course = enrolments.find((entry) => entry.courseId === lesson.courseId);
  if (!course?.enrollment?.enrollmentId || course.profile !== 'lower') {
    throw new Error(`${LOWER_ID} has no 'lower' enrollment in course ${lesson.courseId}`);
  }

  fs.mkdirSync(output, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-school-sim-state-'));
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
      selfService,
      clock: () => new Date('2026-08-13T06:00:00.000Z'),
      rng: () => ((++tokenDraw * 0.61803398875) % 1),
      newSessionId: () => `virtual-sim-${++sessionNumber}`,
      logger: { warn() {}, info() {} },
    });
    // --tap: the CARD-TAP cooldown, proved without paper or a real child's
    // print history. Three taps through the REAL use case against this run's
    // throwaway state and a receipts double that only counts calls:
    //   1. cold      -> prints
    //   2. immediate -> suppressed, but still ANSWERS (a tap that gets nothing
    //                   at all teaches a child to tap harder)
    //   3. after new work is assigned -> prints again, cooldown notwithstanding,
    //                   because the agenda fingerprint changed
    if (ARGV.includes('--tap')) {
      const cooldownState = new Map();
      let printCount = 0;
      let tapClock = new Date('2026-08-13T06:00:00.000Z');
      const tapCard = new ResolvePersonalCard({
        buildAgenda: agendaBuilder,
        receipts: { async print() { printCount += 1; return { printed: true }; } },
        // The port is `get(learnerId)` + `put(record)`. `put`, not `set`:
        // a wrong method here fails silently, because `#armCooldown` catches
        // its own write errors so a cooldown-store hiccup can never stop a
        // child's agenda printing.
        cooldown: {
          async get(id) { return cooldownState.get(id) ?? null; },
          async put(record) { cooldownState.set(record.learnerId, record); return record; },
        },
        cooldownMinutes: 30,
        clock: () => tapClock,
        logger: { warn() {}, info() {} },
      });

      const cold = await tapCard.execute({ learnerId: LOWER_ID });
      const beforeSecond = printCount;
      tapClock = new Date('2026-08-13T06:05:00.000Z');
      const repeat = await tapCard.execute({ learnerId: LOWER_ID });
      const suppressedPrinted = printCount - beforeSecond;

      // Rule 4: new work bypasses the window entirely. Forge a DIFFERENT prior
      // fingerprint rather than mutate the curriculum — the property under test
      // is "content changed", and this is the smallest honest way to say so.
      cooldownState.set(LOWER_ID, {
        ...cooldownState.get(LOWER_ID), contentHash: 'a-different-agenda-entirely',
      });
      const beforeThird = printCount;
      const afterNewWork = await tapCard.execute({ learnerId: LOWER_ID });
      const newWorkPrinted = printCount - beforeThird;

      const report = {
        coldTap: { status: cold.status, printed: cold.printed },
        repeatTapInsideCooldown: {
          status: repeat.status,
          printed: repeat.printed,
          paperProduced: suppressedPrinted,
          message: repeat.message ?? null,
          sinceMinutes: repeat.sinceMinutes ?? null,
        },
        tapAfterNewWork: { status: afterNewWork.status, printed: afterNewWork.printed, paperProduced: newWorkPrinted },
      };
      fs.writeFileSync(path.join(output, 'tap-cooldown.yml'), yaml.dump(report, { lineWidth: -1, noRefs: true }));
      if (repeat.status !== 'agenda_suppressed' || suppressedPrinted !== 0 || !repeat.message) {
        throw new Error('cooldown did not suppress-with-acknowledgement on the second tap');
      }
      if (afterNewWork.status !== 'agenda_printed' || newWorkPrinted !== 1) {
        throw new Error('new work did not bypass the cooldown');
      }
      console.log(JSON.stringify(report, null, 2));
    }

    const [lowerAgenda, upperAgenda] = await Promise.all([
      agendaBuilder.execute({ learnerId: LOWER_ID, learnerName: LOWER_ID }),
      UPPER_ID
        ? agendaBuilder.execute({ learnerId: UPPER_ID, learnerName: UPPER_ID })
        : Promise.resolve({ offers: [] }),
    ]);
    const lowerOffer = lowerAgenda.offers.find((offer) => offer.subject === SUBJECT);
    const upperOffer = upperAgenda.offers.find((offer) => offer.subject === SUBJECT);
    if (lowerOffer?.unitId !== lesson.unitId || (UPPER_ID && upperOffer?.unitId !== lesson.unitId)) {
      throw new Error(`real agendas did not offer ${lesson.unitId} for subject ${SUBJECT}`);
    }
    const agendaTokenRecord = await tokens.get(lowerOffer.token);
    if (agendaTokenRecord?.subject?.learnerId !== LOWER_ID || agendaTokenRecord?.subject?.subject !== SUBJECT) {
      throw new Error(`${LOWER_ID}'s agenda QR is not bound to ${LOWER_ID}/${SUBJECT}`);
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
      newSessionId: () => `virtual-sim-${++sessionNumber}`, logger: { warn() {}, info() {} },
    });
    const scanRouter = new ResolveScanAction({
      tokens, sessions, curriculum, issueDocument, resolveSubjectNext: subjectResolver,
      resolvePersonalCard: { async execute() { throw new Error('personal-card path should not run'); } },
      dispatchMedia: { async execute() { throw new Error('media path should not run'); } },
      openRemediation: new OpenRemediation({
        curriculum, sessions, clock: () => new Date('2026-08-13T06:07:00.000Z'),
        newSessionId: () => `virtual-sim-${++sessionNumber}`, logger: { warn() {}, info() {} },
      }),
      receipts: { async print() { return { printed: false }; } },
      clock: () => new Date('2026-08-13T06:00:00.000Z'), logger: { warn() {}, info() {} },
    });
    const scanIssue = await scanRouter.execute({ code: lowerOffer.token, device: 'virtual-agenda-scanner' });
    if (scanIssue.status !== 'issued' || scanIssue.physical !== 'worksheet' || !worksheetPdf) {
      throw new Error(`agenda QR did not issue the worksheet: ${JSON.stringify(scanIssue)}`);
    }
    const complete = await worksheetInstances.findBySession(lowerOffer.sessionId);
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
      let given = question.type === 'multi_select' ? letters : letters[0];

      // MULTI-MARK ROWS, the two cases the paper pipeline has to tell apart
      // and which nothing could exercise from this CLI before:
      //
      //   --double-bubble  one wrong option marked ALONGSIDE the correct one.
      //                    The eraser signature: a child changed their mind and
      //                    the rubber left a readable mark. Bounded leniency
      //                    (`ambiguityLeniency`) credits it with no human step.
      //   --triple-bubble  three marked. Past any eraser story, so it must
      //                    still be held for a person rather than credited.
      //
      // Applied to the FIRST row only, so the rest of the sheet stays a clean
      // control and the receipt shows one marked box among correct ones.
      const extras = (BUBBLE_MODE && index === 0)
        ? question.options.filter((option) => !option.correct).map((option) => option.letter)
        : [];
      if (extras.length) {
        const wanted = BUBBLE_MODE === 'triple' ? 2 : 1;
        given = [...(Array.isArray(given) ? given : [given]), ...extras.slice(0, wanted)];
      }
      answers[complete.omr.rowRange.start + index] = given;
    });
    const grade = await new ResolveCardScan({ allocationStore, repository }).execute({
      testId: complete.omr.cardId, answers,
    });
    const card = grade.results[0];
    // A multi-mark run is PROVING what the grader does with an ambiguous row,
    // so it must not also assert a clean-sheet score — that is the very thing
    // under test. The outcome is reported instead, and the caller reads it.
    if (!BUBBLE_MODE) {
      const expectedCorrect = outcomeMode === 'pass' ? card?.totalPoints : Math.floor(card?.totalPoints / 2);
      if (!card || card.earnedPoints !== expectedCorrect) throw new Error(`virtual OMR grade did not produce ${expectedCorrect} correct`);
    }
    fs.writeFileSync(path.join(output, 'omr-result.yml'), yaml.dump(grade, { lineWidth: -1, noRefs: true }));

    const receiptRenderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
    const agendaCanvas = await receiptRenderer.createCanvas(lowerAgenda.document);
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
      selfService,
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
    if (continuationToken === lowerOffer.token) throw new Error('result QR reused the agenda token');
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
      learnerId: LOWER_ID, profile: course.profile, enrollmentId: course.enrollment.enrollmentId,
      lessonId: lesson.unitId, worksheetInstanceId: complete.id,
      documentId: complete.documentId, documentRevision: complete.documentRevision,
      cardId: complete.omr.cardId, rows: complete.omr.rowRange,
      score: `${card.earnedPoints}/${card.totalPoints}`,
      // `--upper` is optional (see the usage string), so the second learner
      // may genuinely be absent. It used to be read unconditionally here and
      // threw "Cannot read properties of undefined" on every single-learner
      // run — i.e. on the documented default way to invoke this command.
      agenda: {
        [LOWER_ID]: { profile: 'lower', unitId: lowerOffer.unitId, tokenClass: lowerOffer.tokenClass },
        ...(UPPER_ID && upperOffer
          ? { [UPPER_ID]: { profile: 'upper', unitId: upperOffer.unitId, tokenClass: upperOffer.tokenClass } }
          : {}),
      },
      agendaQr: lowerOffer.token,
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
  return 0;
}

const ENTRYPOINT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  });
}
