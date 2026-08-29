/**
 * Teacher day projections. `/teacher/today` keeps the original array contract;
 * `/teacher/day?studyDay=YYYY-MM-DD` uses the truthful v2 projection where a
 * session stays on the day it was opened/issued and later scans are reported in
 * a separate processedToday lane.
 */
import {
  studyDayForInstant, studyDayWindow, studyDayWindowForDate, withinStudyWindow,
} from '#domains/school/studyDay.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { curriculumPosterRef, schoolArtifactRef } from '#apps/common/resources/publicResourceRefs.mjs';

const DEFAULT_BOUNDARY_HOUR = 4;
// A session has something reviewable only once it has been submitted; before
// that there is no verdict to report, and reporting one invites a reader to
// act on it. Kept next to PROCESSED_TYPES because both encode the same
// question: how far has this session actually got?
const REVIEWABLE_STATES = new Set([
  'submitted', 'graded', 'outcome_recorded', 'rewarded',
  'media_completed', 'external_activity_assessed',
]);
function reviewStatusFor(state, pending, sessionId) {
  if (pending.some((item) => item.sessionId === sessionId)) return 'pending';
  return REVIEWABLE_STATES.has(state) ? 'complete' : null;
}

const PROCESSED_TYPES = new Set(['submitted', 'graded', 'grade_adjusted', 'grade_adjustment_retracted']);

function daysTouchedBy({ startAtMs, endAtMs }) {
  const fromDay = new Date(startAtMs).toISOString().slice(0, 10);
  const toDay = new Date(endAtMs - 1).toISOString().slice(0, 10);
  return fromDay === toDay ? [fromDay] : [fromDay, toDay];
}

const latestAt = (events) => events.reduce((latest, event) => (
  String(event?.at ?? '') > latest ? String(event.at) : latest
), '');

/**
 * Per-session paper-record references for the dashboard drill-in.
 *
 * The reduced session state already carries every archived artifact id, and
 * the artifact routes are deterministic functions of those ids — the same
 * URLs GetTeacherSession emits. Deriving them here costs no store read and
 * spares the dashboard the per-session document fetch (the audited N+1) it
 * once paid to show these. An id only enters the event log when a capture
 * archived the bytes, so a link here is live by construction; a legacy
 * session with no archived print simply carries nulls.
 *
 * Worksheet: the FIRST issued artifact — reprints reuse the original bytes.
 * Receipt: the LATEST capture — a regrade re-captures, and the newest
 * receipt states the standing result the family actually saw last.
 */
function artifactRefs(state) {
  const worksheetId = state.issuedArtifacts?.[0] ?? null;
  const receipt = (state.resultReceiptArtifacts ?? []).at(-1) ?? null;
  return {
    worksheet: worksheetId ? {
      artifactId: worksheetId,
      originalPdfUrl: schoolArtifactRef(worksheetId, 'original.pdf'),
      thumbnailUrl: schoolArtifactRef(worksheetId, 'thumbnail.png'),
    } : null,
    receipt: receipt ? {
      artifactId: receipt.artifactId,
      originalUrl: schoolArtifactRef(receipt.artifactId, 'original'),
    } : null,
  };
}

function uniqueAttempts(attempts) {
  const seen = new Set();
  return attempts.filter((attempt) => {
    const scanIdentity = attempt?.provenance?.scanKey ?? attempt?.provenance?.recordId ?? attempt?.id ?? '';
    const key = `${attempt?.sessionId ?? 'orphan'}:${attempt?.itemId ?? ''}:${scanIdentity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class GetTeacherToday {
  #learnerDirectory; #datastore; #sessions; #reviewQueue; #evidence; #curriculum;
  #timezone; #boundaryHour; #clock; #logger;

  constructor({
    learnerDirectory, datastore, sessions, reviewQueue = null, evidenceRepository = null,
    curriculum = null, timezone = null, boundaryHour = DEFAULT_BOUNDARY_HOUR,
    clock = () => new Date(), logger = console,
  } = {}) {
    if (!learnerDirectory) throw new Error('GetTeacherToday requires learnerDirectory');
    if (!datastore) throw new Error('GetTeacherToday requires datastore');
    if (!sessions) throw new Error('GetTeacherToday requires sessions');
    this.#learnerDirectory = learnerDirectory;
    this.#datastore = datastore;
    this.#sessions = sessions;
    this.#reviewQueue = reviewQueue;
    this.#evidence = evidenceRepository;
    this.#curriculum = curriculum;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ studyDay = null, version = 'v1' } = {}) {
    const nowMs = this.#clock().getTime();
    const selectedStudyDay = studyDay ?? studyDayForInstant(nowMs, {
      timezone: this.#timezone, boundaryHour: this.#boundaryHour,
    });
    const window = studyDay
      ? studyDayWindowForDate(studyDay, { timezone: this.#timezone, boundaryHour: this.#boundaryHour })
      : studyDayWindow(nowMs, { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
    if (!window) throw new ValidationError('studyDay must be a real date in YYYY-MM-DD form');

    const [learners, pending, units, works] = await Promise.all([
      this.#learnerDirectory.listLearners(),
      this.#reviewQueue ? this.#reviewQueue.listPending() : [],
      this.#curriculum?.listUnits?.() ?? [],
      this.#curriculum?.listWorks?.() ?? [],
    ]);
    const unitsById = new Map(units.map((unit) => [unit.unitId, unit]));
    const worksById = new Map();
    works.forEach((work) => {
      worksById.set(work.work, work);
      worksById.set(`${work.subject}/${work.work}`, work);
    });
    const days = daysTouchedBy(window);
    const rows = [];

    for (const learner of learners) {
      // eslint-disable-next-line no-await-in-loop
      const indexRows = await this.#sessions.listForLearner(learner.id);
      const attempts = uniqueAttempts(days.flatMap((day) => this.#datastore.readAttemptDay(learner.id, day) ?? [])
        .filter((attempt) => withinStudyWindow(attempt.processedAt ?? attempt.at, window)));
      const sessions = [];
      const processedToday = [];

      for (const row of indexRows) {
        // eslint-disable-next-line no-await-in-loop
        const events = await this.#sessions.readEvents(row.sessionId);
        if (!events.length) continue;
        const state = reduceSession(events);
        const createdAt = events.find((event) => event.type === 'created')?.at ?? null;
        const originalAt = state.firstIssuedAt ?? createdAt ?? row.updatedAt ?? null;
        const originalStudyDay = state.studyDay ?? studyDayForInstant(Date.parse(originalAt), {
          timezone: this.#timezone, boundaryHour: this.#boundaryHour,
        });
        const unit = unitsById.get(state.unitId) ?? null;
        const courseId = unit?.courseId ?? null;
        const work = worksById.get(courseId) ?? null;
        const module = work?.modules?.find((entry) => entry.module === unit?.module) ?? null;
        const summary = {
          sessionId: row.sessionId,
          learnerId: state.learnerId,
          unitId: state.unitId,
          lessonId: state.unitId,
          lessonTitle: unit?.title ?? 'Lesson title unavailable',
          subject: unit?.subject ?? work?.subject ?? null,
          subjectIcon: unit?.subject ?? work?.subject ?? 'school',
          courseId,
          courseTitle: work?.title ?? 'Course title unavailable',
          moduleId: unit?.module ?? null,
          moduleTitle: module?.title ?? 'Unit title unavailable',
          posterUrl: courseId ? curriculumPosterRef('teacher', courseId) : null,
          studyDay: originalStudyDay,
          createdAt,
          issuedAt: state.firstIssuedAt,
          updatedAt: latestAt(events) || row.updatedAt,
          processedAt: latestAt(events.filter((event) => PROCESSED_TYPES.has(event.type))) || null,
          state: state.state,
          machineScore: state.machineGrade,
          effectiveScore: state.gradedPercent == null ? null : {
            percent: state.gradedPercent, correctCount: state.gradedCorrectCount,
            totalCount: state.gradedTotalCount,
          },
          // 'pending' | 'complete' | null. The field answers "is this session
          // in the review queue", so the old two-way form called a session
          // that had never been worked 'complete' — a REVIEW verdict on work
          // nobody had done, which is what made a reader treat "complete" as
          // meaningful and led a card to ask for a grade on an untouched
          // lesson. Null until there is something reviewable.
          reviewStatus: reviewStatusFor(state.state, pending, row.sessionId),
          outcome: state.outcome,
          artifacts: artifactRefs(state),
        };
        if (originalStudyDay === selectedStudyDay) sessions.push(summary);
        const processedEvents = events.filter((event) => PROCESSED_TYPES.has(event.type) && withinStudyWindow(event.at, window));
        if (processedEvents.length && originalStudyDay !== selectedStudyDay) {
          processedToday.push({ ...summary, processedAt: latestAt(processedEvents), processedEventTypes: [...new Set(processedEvents.map((event) => event.type))] });
        }
      }

      let reflections = [];
      if (this.#evidence) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const entries = await this.#evidence.listEvidence({ learnerIds: [learner.id] });
          reflections = entries.filter((entry) => entry.kind === 'reflection' && withinStudyWindow(entry.occurredAt, window))
            .map((entry) => ({
              selfAssessment: entry.selfRegulation?.selfAssessment ?? null,
              confidence: entry.selfRegulation?.confidence ?? null,
              note: entry.selfRegulation?.note ?? null,
              at: entry.occurredAt,
            }));
        } catch (error) {
          this.#logger.warn?.('school.teacher-day.reflections-failed', { learnerId: learner.id, error: error?.message });
        }
      }
      const scoreSessions = sessions.filter((session) => session.effectiveScore?.totalCount > 0);
      const correct = scoreSessions.reduce((sum, session) => sum + session.effectiveScore.correctCount, 0);
      const total = scoreSessions.reduce((sum, session) => sum + session.effectiveScore.totalCount, 0);
      rows.push({
        learnerId: learner.id,
        learnerName: learner.name ?? learner.id,
        sessions,
        processedToday,
        effectiveScoreTotals: { correct, total, percent: total ? Math.round((correct / total) * 10000) / 100 : null },
        pendingReview: pending.filter((item) => item.learnerId === learner.id).length,
        reflections,
        // v1 compatibility fields. Attempt rows stay as the old count until all
        // historical attempts have a reliable work-session identity.
        attemptsToday: attempts.length,
        correctToday: attempts.filter((attempt) => attempt.correct === true).length,
        sessionsToday: sessions.map((session) => ({
          sessionId: session.sessionId, unitId: session.unitId, state: session.state,
          title: session.lessonTitle, studyDay: session.studyDay,
        })),
        reflectionsToday: reflections,
      });
    }
    this.#logger.debug?.('school.teacher-day.built', { studyDay: selectedStudyDay, learners: rows.length });
    if (version === 'v2' || studyDay !== null) {
      return { schema: 'school.teacher-day/v2', studyDay: selectedStudyDay, generatedAt: this.#clock().toISOString(), learners: rows };
    }
    return rows;
  }
}

export default GetTeacherToday;
