/**
 * Teacher day projections. `/teacher/today` keeps the original array contract;
 * `/teacher/day?studyDay=YYYY-MM-DD` uses the truthful v2 projection where a
 * session stays on the day it was opened/issued and later scans are reported in
 * a separate processedToday lane.
 */
import {
  studyDayForInstant, studyDayWindow, studyDayWindowForDate, withinStudyWindow,
} from "../../domain/studyDay.mjs";
import { reduceSession } from "../../domain/sessions/sessionEvents.mjs";
import { ValidationError } from '#domains/core/errors/index.mjs';
import { projectReadingActivity } from "../../domain/readingActivity.mjs";
import { projectFitnessActivity } from "../../domain/fitnessActivity.mjs";
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

/** Calendar-day arithmetic on a YYYY-MM-DD study day, for range queries. */
function addStudyDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * 86_400_000)
    .toISOString().slice(0, 10);
}

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
      printed: receipt.printed,
      printReason: receipt.printReason ?? null,
      capturedAt: receipt.at ?? null,
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

/**
 * Units a child can no longer move on alone — a TEACHER HOLD, either because
 * the open failure is past the remediation cap (`remediation-cap`) or because
 * it has sat unretried for days (`remediation-stale`). The agenda has stopped
 * owing it; nothing else puts it in front of a grown-up, so it is named here,
 * on the screen the grown-up actually reads.
 *
 * Read off the PLAN, not re-derived: the planner already keeps only the
 * newest open session per unit, never holds a unit that is `completed`, and
 * counts idle days by the learner's own school calendar. Asking it is the one
 * way this list cannot disagree with the paper the child is holding.
 */
function remediationHoldItems(entries, { learnerId, statesById }) {
  return (entries ?? [])
    .filter((entry) => entry?.remediation?.held === true)
    .map((entry) => {
      const hold = entry.remediation;
      const state = statesById.get(entry.sessionId) ?? null;
      return {
        kind: hold.reason === 'cap' ? 'remediation-cap' : 'remediation-stale',
        learnerId,
        sessionId: entry.sessionId,
        unitId: entry.unitId,
        unitTitle: entry.title ?? entry.unitId,
        depth: hold.depth,
        maxRounds: hold.maxRounds,
        idleStudyDays: hold.idleStudyDays ?? null,
        lastScore: state?.gradedPercent == null ? null : {
          percent: state.gradedPercent, correctCount: state.gradedCorrectCount, totalCount: state.gradedTotalCount,
        },
        since: state?.outcome?.at ?? null,
      };
    });
}

export class GetTeacherToday {
  #learnerDirectory; #datastore; #sessions; #reviewQueue; #evidence; #curriculum; #bookLog;
  #fitnessSessions; #timezone; #boundaryHour; #clock; #logger; #planProjection;

  constructor({
    learnerDirectory, datastore, sessions, reviewQueue = null, evidenceRepository = null,
    curriculum = null, bookLog = null, fitnessSessions = null,
    timezone = null, boundaryHour = DEFAULT_BOUNDARY_HOUR,
    // The agenda's own `PlanProjection`, asked for teacher holds. Null: the
    // digest carries an empty `attention` list.
    planProjection = null,
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
    this.#bookLog = bookLog;
    this.#fitnessSessions = fitnessSessions;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
    this.#planProjection = planProjection;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ studyDay = null, version = 'v1' } = {}) {
    const isV2 = version === 'v2' || studyDay !== null;
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

    // ONE roster-wide fitness read, before the per-learner loop. Fitness
    // sessions are stored by DATE, not by learner, so asking per child would
    // re-read the same day four times. The range spans the calendar day and
    // its successor because a session filed under tomorrow's folder can still
    // have STARTED inside today's study window; `projectFitnessActivity`
    // re-dates each one by its start and drops the rest.
    let fitnessSessionsToday = null;
    if (isV2 && this.#fitnessSessions) {
      try {
        fitnessSessionsToday = await this.#fitnessSessions.listSessionsInRange(
          selectedStudyDay, addStudyDays(selectedStudyDay, 1),
        );
      } catch (error) {
        this.#logger.warn?.('school.teacher-day.fitness-activity-failed', { error: error?.message });
      }
    }

    const rows = [];

    for (const learner of learners) {
      // eslint-disable-next-line no-await-in-loop
      const indexRows = await this.#sessions.listForLearner(learner.id);
      const attempts = uniqueAttempts(days.flatMap((day) => this.#datastore.readAttemptDay(learner.id, day) ?? [])
        .filter((attempt) => withinStudyWindow(attempt.processedAt ?? attempt.at, window)));
      const sessions = [];
      const processedToday = [];
      const reduced = [];

      for (const row of indexRows) {
        // eslint-disable-next-line no-await-in-loop
        const events = await this.#sessions.readEvents(row.sessionId);
        if (!events.length) continue;
        const state = reduceSession(events);
        reduced.push(state);
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
          remediation: {
            ofSessionId: state.remediationOf ?? null,
            activeSessionId: state.remediation?.newSessionId ?? null,
            variant: Number.isInteger(state.variant) ? state.variant : null,
          },
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
      let readingActivity = { status: 'unavailable', studyDay: selectedStudyDay, hasActivity: null };
      if (isV2 && this.#bookLog) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const items = await this.#bookLog.listForLearner(learner.id);
          readingActivity = {
            status: 'ok',
            ...projectReadingActivity(items, {
              studyDay: selectedStudyDay,
              dayOf: (iso) => studyDayForInstant(Date.parse(iso), {
                timezone: this.#timezone, boundaryHour: this.#boundaryHour,
              }),
            }),
          };
        } catch (error) {
          this.#logger.warn?.('school.teacher-day.reading-activity-failed', {
            learnerId: learner.id, error: error?.message,
          });
        }
      }
      // Physical education is on nobody's plan, so this is pure evidence: a
      // learner who earned rings today gets one supplemental green disc on the
      // status board. `unavailable` (no port wired, or the read threw above)
      // renders nothing at all rather than an unearned or a scolding disc.
      let fitnessActivity = { status: 'unavailable', studyDay: selectedStudyDay, hasActivity: null };
      if (fitnessSessionsToday) {
        fitnessActivity = {
          status: 'ok',
          ...projectFitnessActivity(fitnessSessionsToday, {
            learnerId: learner.id,
            studyDay: selectedStudyDay,
            dayOf: (ms) => studyDayForInstant(ms, {
              timezone: this.#timezone, boundaryHour: this.#boundaryHour,
            }),
          }),
        };
      }
      let attention = [];
      if (this.#planProjection) {
        try {
          // Curriculum only, no launchers: holds live on curriculum units, and
          // a teacher screen must not fan out to every program's status.
          // A named study day is read AS OF that day — evidence before its
          // window closes, idle days counted to its midpoint — so a past
          // board never shows a hold that only formed later.
          // eslint-disable-next-line no-await-in-loop
          const { plan } = await this.#planProjection.project({
            learnerId: learner.id, assignedPrograms: false, programStatuses: {},
            ...(studyDay ? {
              now: new Date((window.startAtMs + window.endAtMs) / 2).toISOString(),
              historyUntil: new Date(window.endAtMs).toISOString(),
            } : {}),
          });
          attention = remediationHoldItems(plan?.entries, {
            learnerId: learner.id, statesById: new Map(reduced.map((state) => [state.sessionId, state])),
          });
        } catch (error) {
          this.#logger.warn?.('school.teacher-day.holds-failed', { learnerId: learner.id, error: error?.message });
        }
      }
      rows.push({
        learnerId: learner.id,
        learnerName: learner.name ?? learner.id,
        sessions,
        processedToday,
        // The holds standing on the day viewed (today, unless a study day was
        // named): a hold stays listed until a grown-up opens another round or
        // the work is settled some other way.
        attention,
        effectiveScoreTotals: { correct, total, percent: total ? Math.round((correct / total) * 10000) / 100 : null },
        pendingReview: pending.filter((item) => item.learnerId === learner.id).length,
        reflections,
        ...(isV2 ? { readingActivity, fitnessActivity } : {}),
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
    if (isV2) {
      return { schema: 'school.teacher-day/v2', studyDay: selectedStudyDay, generatedAt: this.#clock().toISOString(), learners: rows };
    }
    return rows;
  }
}

export default GetTeacherToday;
