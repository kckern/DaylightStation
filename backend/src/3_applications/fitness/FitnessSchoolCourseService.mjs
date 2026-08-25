/**
 * Fitness side of the School/Fitness contract. School freezes the requested
 * plan here before dispatch; Fitness later derives attributed observations from
 * its own session records, stores an immutable assessment, and publishes only
 * the normalized verdict/pointer back to School.
 */
import { evaluateSchoolFitnessAttempt } from '#domains/fitness/schoolCourseAssessment.mjs';
import { revisionFor } from '#domains/school/fitnessCourse.mjs';

export const FITNESS_SCHOOL_ASSESSED_TOPIC = 'fitness.school-attempt.assessed';
export const FITNESS_SCHOOL_ACCEPTED_TOPIC = 'fitness.school-attempt.accepted';

export class FitnessSchoolCourseService {
  #store; #sessions; #eventBus; #clock; #logger;
  constructor({ attemptStore, sessionService, eventBus = null, clock = () => new Date(), logger = console } = {}) {
    if (!attemptStore) throw new Error('FitnessSchoolCourseService requires attemptStore');
    this.#store = attemptStore;
    this.#sessions = sessionService;
    this.#eventBus = eventBus;
    this.#clock = clock;
    this.#logger = logger;
  }

  async prepare({ workSessionId, learnerId, unitId, activity, householdId = null }) {
    const existing = await this.#store.get(workSessionId, householdId);
    if (existing) return existing;
    const now = this.#now();
    const record = {
      schema: 'fitness.school-attempt/v1', workSessionId, learnerId, unitId,
      provider: 'fitness', courseRevision: activity.courseRevision,
      policyRevision: activity.policyRevision, source: structuredClone(activity.source ?? null),
      segments: structuredClone(activity.segments), successPolicy: structuredClone(activity.successPolicy),
      status: 'prepared', preparedAt: now, acceptedAt: null, declinedAt: null,
      fitnessSessionIds: [], assessment: null,
    };
    await this.#store.put(record, householdId);
    this.#logger.info?.('fitness.school-attempt.prepared', { workSessionId, learnerId, unitId, courseRevision: activity.courseRevision });
    return record;
  }

  get(workSessionId, householdId = null) { return this.#store.get(workSessionId, householdId); }

  async accept({ workSessionId, learnerId, householdId = null }) {
    const record = await this.#required(workSessionId, householdId);
    if (record.learnerId !== learnerId) throw new Error('learner does not own this School attempt');
    if (record.assessment) return record;
    const updated = { ...record, status: 'accepted', acceptedAt: record.acceptedAt ?? this.#now(), declinedAt: null };
    await this.#store.put(updated, householdId);
    this.#eventBus?.publish?.(FITNESS_SCHOOL_ACCEPTED_TOPIC, {
      workSessionId, learnerId, unitId: record.unitId, provider: 'fitness',
      courseRevision: record.courseRevision, policyRevision: record.policyRevision,
      acceptedAt: updated.acceptedAt,
    });
    this.#logger.info?.('fitness.school-attempt.accepted', { workSessionId, learnerId });
    return updated;
  }

  async decline({ workSessionId, learnerId, householdId = null }) {
    const record = await this.#required(workSessionId, householdId);
    if (record.learnerId !== learnerId) throw new Error('learner does not own this School attempt');
    if (record.assessment) return record;
    const updated = { ...record, status: 'declined', declinedAt: this.#now() };
    await this.#store.put(updated, householdId);
    this.#logger.info?.('fitness.school-attempt.declined', { workSessionId, learnerId });
    return updated;
  }

  async assess({ workSessionId, learnerId, fitnessSessionIds = [], clientObservations = {}, householdId = null }) {
    const record = await this.#required(workSessionId, householdId);
    if (record.learnerId !== learnerId) throw new Error('learner does not own this School attempt');
    if (record.assessment) return record;
    if (record.status !== 'accepted') throw new Error('School attempt has not been accepted');
    const ids = [...new Set(fitnessSessionIds.map((id) => String(id).replace(/^fs_/, '')).filter(Boolean))];
    const sessions = [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const session = await this.#sessions?.getSession?.(id, householdId, { decodeTimeline: true });
      if (session) sessions.push(session.toJSON());
    }
    const trusted = deriveObservations({ record, learnerId, sessions });
    // Only media/segment observations may come from the coordinator. Sensor,
    // strength and memo evidence are always re-derived from Fitness records.
    const observations = mergeClientPlaybackObservations(trusted, clientObservations);
    const evaluated = evaluateSchoolFitnessAttempt({ policy: record.successPolicy, observations });
    const assessedAt = this.#now();
    const assessment = {
      assessmentId: `fitness-assessment:${workSessionId}:${record.policyRevision}`,
      assessedAt, result: evaluated.result, criteria: evaluated.criteria,
      observations, sourceRefs: ids.map((sessionId) => ({ kind: 'fitness-session', sessionId })),
      evidenceRevision: revisionFor({ ids, observations }),
    };
    const updated = { ...record, status: 'assessed', fitnessSessionIds: ids, assessment };
    await this.#store.put(updated, householdId);
    const payload = {
      workSessionId, learnerId, unitId: record.unitId, provider: 'fitness',
      courseRevision: record.courseRevision, policyRevision: record.policyRevision,
      assessmentId: assessment.assessmentId, assessedAt, result: assessment.result,
      criteria: assessment.criteria, observations: normalizedSchoolMeasures(observations),
    };
    this.#eventBus?.publish?.(FITNESS_SCHOOL_ASSESSED_TOPIC, payload);
    this.#logger.info?.('fitness.school-attempt.assessed', { workSessionId, learnerId, result: assessment.result, assessmentId: assessment.assessmentId });
    return updated;
  }

  async #required(id, householdId) {
    const record = await this.#store.get(id, householdId);
    if (!record) throw new Error('School Fitness attempt not found');
    return record;
  }
  #now() { return this.#clock().toISOString(); }
}

export function deriveObservations({ record, learnerId, sessions }) {
  let totalTicks = 0; let hrTicks = 0; let cadenceTicks = 0;
  const hr = []; const rpm = []; const zoneSeconds = {}; const ranges = [];
  let voiceCount = 0; let voiceDuration = 0; let completedSteps = 0; let plannedSteps = 0;
  let mediaSeconds = 0;
  for (const session of sessions) {
    const participant = session.participants?.[learnerId] ?? null;
    const summaryParticipant = session.summary?.participants?.[learnerId] ?? null;
    const interval = Number(session.timeline?.interval_seconds ?? session.timeline?.timebase?.intervalSeconds
      ?? ((session.timeline?.timebase?.intervalMs ?? 5000) / 1000)) || 5;
    const tickCount = Number(session.timeline?.tick_count ?? session.timeline?.timebase?.tickCount ?? 0);
    totalTicks += tickCount;
    const hrSeries = decodedMetric(session, learnerId, 'heart_rate', 'hr');
    const rpmSeries = decodedMetric(session, learnerId, 'rpm', 'rpm');
    hr.push(...hrSeries.filter(Number.isFinite));
    rpm.push(...rpmSeries.filter(Number.isFinite));
    hrTicks += hrSeries.filter(Number.isFinite).length || Math.round((participant?.active_seconds ?? 0) / interval);
    cadenceTicks += rpmSeries.filter(Number.isFinite).length;
    for (const [zone, seconds] of Object.entries(participant?.zone_time_seconds ?? {})) zoneSeconds[zone] = (zoneSeconds[zone] ?? 0) + Number(seconds || 0);
    const memos = session.summary?.voiceMemos ?? session.events?.voice_memos ?? [];
    voiceCount += memos.length;
    voiceDuration += memos.reduce((sum, memo) => sum + Number(memo.durationSeconds ?? memo.duration_seconds ?? 0), 0);
    for (const run of session.strength?.runs ?? []) {
      completedSteps += Number(run.completedCount ?? run.completed_steps?.length ?? run.completedSteps?.length ?? 0);
      plannedSteps += Number(run.plannedCount ?? run.planned_steps?.length ?? run.plannedSteps?.length ?? 0);
    }
    mediaSeconds += (session.summary?.media ?? []).reduce((sum, media) => sum + Number(media.durationMs ?? 0) / 1000, 0);
    if (!hr.length && Number.isFinite(summaryParticipant?.hr_avg)) hr.push(summaryParticipant.hr_avg);
  }
  const plannedMedia = record.segments.filter((segment) => segment.kind === 'plex-video' && segment.required !== false)
    .reduce((sum, segment) => sum + Number(segment.durationSeconds ?? 0), 0);
  return {
    segments: { completed: sessions.length ? record.segments.length : 0, in_order: sessions.length > 0 },
    media: { elapsed_seconds: mediaSeconds, completion_ratio: plannedMedia > 0 ? Math.min(1, mediaSeconds / plannedMedia) : 0 },
    heart_rate: {
      coverage_ratio: totalTicks > 0 ? Math.min(1, hrTicks / totalTicks) : 0,
      average_bpm: average(hr), max_bpm: maximum(hr), seconds_in_range: ranges,
      seconds_in_zone: zoneSeconds,
    },
    cadence: {
      coverage_ratio: totalTicks > 0 ? Math.min(1, cadenceTicks / totalTicks) : 0,
      average_rpm: average(rpm), max_rpm: maximum(rpm), seconds_in_range: [],
    },
    strength: { completed_steps: completedSteps, planned_steps: plannedSteps },
    voice_memo: { count: voiceCount, duration_seconds: voiceDuration },
  };
}

function mergeClientPlaybackObservations(trusted, client) {
  const ratio = Number(client?.media?.completion_ratio);
  const elapsed = Number(client?.media?.elapsed_seconds);
  const completed = Number(client?.segments?.completed);
  return {
    ...trusted,
    media: {
      elapsed_seconds: Number.isFinite(elapsed) ? Math.max(trusted.media.elapsed_seconds, elapsed) : trusted.media.elapsed_seconds,
      completion_ratio: Number.isFinite(ratio) ? Math.max(trusted.media.completion_ratio, Math.min(1, ratio)) : trusted.media.completion_ratio,
    },
    segments: {
      completed: Number.isFinite(completed) ? Math.max(trusted.segments.completed, completed) : trusted.segments.completed,
      in_order: trusted.segments.in_order && client?.segments?.in_order !== false,
    },
  };
}

function decodedMetric(session, learnerId, metric, compact) {
  const series = session.timeline?.series ?? session.timeline?.participants?.[learnerId] ?? {};
  const value = series[`user:${learnerId}:${metric}`] ?? series[`${learnerId}:${compact}`] ?? series[metric] ?? [];
  return Array.isArray(value) ? value : [];
}
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const maximum = (values) => values.length ? Math.max(...values) : null;
function normalizedSchoolMeasures(observations) {
  return {
    engagements: 1,
    completions: observations.segments.completed,
    durationMs: Math.round(observations.media.elapsed_seconds * 1000),
  };
}

export default FitnessSchoolCourseService;
