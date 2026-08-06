/**
 * Status-aware fetch client for /api/v1/school. NOT DaylightAPI: the runners
 * must distinguish 403 (guest/assigned), 410 (session gone), and 500 (attempt
 * unrecorded — spec §8), and DaylightAPI hides status codes. Never throws.
 */
const BASE = '/api/v1/school';

async function req(path, body, method) {
  try {
    const opts = body === undefined
      ? { method: method || 'GET' }
      : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const r = await fetch(BASE + path, opts);
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const schoolApi = {
  roster: () => req('/roster'),
  // Fail-closed surface resolution (spec §4.2): 404 -> {ok:false}, same as any
  // other unresolved-resource response — the caller never treats a missing
  // profile as "everything allowed".
  surfaceProfile: (screenId) => req(`/surfaces/profile?screen=${encodeURIComponent(screenId)}`),
  certification: ({ address, surface }) => {
    const p = new URLSearchParams();
    if (address) p.set('address', address);
    if (surface) p.set('surface', surface);
    return req(`/certification?${p}`);
  },
  banks: (audience) => req(`/banks${audience ? `?audience=${encodeURIComponent(audience)}` : ''}`),
  bank: (id) => req(`/banks/${encodeURIComponent(id)}`),
  learningCatalogs: (learnerId = null) => req(`/catalogs${learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : ''}`),
  learningLesson: ({ catalogId, subjectId, courseId, unitId, lessonId }, learnerId = null) => req(
    `/catalogs/${encodeURIComponent(catalogId)}`
    + `/subjects/${encodeURIComponent(subjectId)}`
    + `/courses/${encodeURIComponent(courseId)}`
    + `/units/${encodeURIComponent(unitId)}`
    + `/lessons/${encodeURIComponent(lessonId)}`
    + (learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : ''),
  ),
  continuationCode: ({ learnerId, moduleCode }) => req(
    `/continuation-code?learnerId=${encodeURIComponent(learnerId)}&moduleCode=${encodeURIComponent(moduleCode)}`,
  ),
  geoDecks: () => req('/geography/decks'),
  openSession: ({ userId = null, bankId, mode, learning = null }) => req('/sessions', {
    userId, bankId, mode, ...(learning ? { learning } : {}),
  }),
  answer: (sessionId, body = {}) => req(`/sessions/${encodeURIComponent(sessionId)}/answer`, body),
  results: (userId, bankId) => req(`/users/${encodeURIComponent(userId)}/results${bankId ? `?bankId=${encodeURIComponent(bankId)}` : ''}`),
  materials: () => req('/materials'),
  // `audience` filters metrics SERVER-SIDE: a learner request never receives
  // parent instrumentation, so a child's device cannot render it by accident.
  report: (userId, audience) => {
    const p = new URLSearchParams();
    if (userId) p.set('userId', userId);
    if (audience) p.set('audience', audience);
    const qs = p.toString();
    return req(`/report${qs ? `?${qs}` : ''}`);
  },
  // The teacher's one-glance "today" digest (Task 6, `GetTeacherToday`):
  // a plain array, one row per roster learner — NOT wrapped in `{learners}`.
  teacherToday: () => req('/teacher/today'),
  // Teacher console reads (teacher-console spec §4.3). `teachers` answers
  // `{configured, teachers: [{id, name}]}` — configured:false means the
  // school.yml `teachers:` key is absent entirely.
  teachers: () => req('/teachers'),
  reportCardFrozen: ({ learnerId, periodId = null }) => {
    const p = new URLSearchParams({ learnerId });
    if (periodId) p.set('periodId', periodId);
    return req(`/report-card/frozen?${p}`);
  },
  lifecycleReview: () => req('/lifecycle/review'),
  learnerSessions: (learnerId, { window = null } = {}) => req(
    `/lifecycle/learners/${encodeURIComponent(learnerId)}/sessions${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  ),
  assignments: (learnerId) => req(`/lifecycle/assignments/${encodeURIComponent(learnerId)}`),
  curriculumUnits: () => req('/lifecycle/curriculum/units'),
  // Teacher console writes (wave 2): every body carries the teacher stamp and
  // the console pin; the server's TeacherGate is the enforcer.
  resolveReview: (sessionId, itemId, body) => req(
    `/lifecycle/sessions/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(itemId)}`, body,
  ),
  printApprove: (requestId, body) => req(`/print/${encodeURIComponent(requestId)}/approve`, body),
  printDeny: (requestId, body) => req(`/print/${encodeURIComponent(requestId)}/deny`, body),
  quizRequestDismiss: (body) => req('/quiz-requests/dismiss', body),
  // Wave-3 planning domains.
  putAssignments: (learnerId, body) => req(`/lifecycle/assignments/${encodeURIComponent(learnerId)}`, body, 'PUT'),
  putPeriods: (body) => req('/periods', body, 'PUT'),
  passOverrides: () => req('/pass-overrides'),
  putPassOverride: (unitId, body) => req(`/pass-overrides/${encodeURIComponent(unitId)}`, body, 'PUT'),
  milestones: (learnerId) => req(`/milestones?learnerId=${encodeURIComponent(learnerId)}`),
  putMilestones: (body) => req('/milestones', body, 'PUT'),
  enrichment: (learnerId = null) => req(`/enrichment${learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : ''}`),
  postEnrichment: (body) => req('/enrichment', body),
  // Wave-4 records.
  closePeriod: (body) => req('/report-card/close', body),
  // Wave-5 repair.
  attestations: (learnerId) => req(`/attestations?learnerId=${encodeURIComponent(learnerId)}`),
  postAttestation: (body) => req('/attestations', body),
  teacherNotes: (learnerId) => req(`/teacher-notes?learnerId=${encodeURIComponent(learnerId)}`),
  postTeacherNote: (body) => req('/teacher-notes', body),
  attemptsSummary: (learnerId, day) => req(
    `/attempts-summary?learnerId=${encodeURIComponent(learnerId)}&day=${encodeURIComponent(day)}`,
  ),
  reassign: (body) => req('/reassign', body),
  progressReport: ({ learnerId, periodId }) => req(
    `/progress-report?learnerId=${encodeURIComponent(learnerId)}&periodId=${encodeURIComponent(periodId)}`,
  ),
  // A period-scoped snapshot of one learner's schooling (Task 6, `GetReportCard`).
  reportCard: ({ learnerId, periodId }) => req(
    `/report-card?learnerId=${encodeURIComponent(learnerId)}&periodId=${encodeURIComponent(periodId)}`,
  ),
  // The configured academic calendar (Task 9) — a plain array, so a
  // child-facing surface can resolve "the current period" for itself.
  periods: () => req('/periods'),
  // A learner's own RESOLVED review items, newest first (Task 9, spec R7) —
  // the feedback a child can see. Never a pending item.
  reviewLearner: (learnerId, { limit = 20 } = {}) => req(
    `/review/learner/${encodeURIComponent(learnerId)}?limit=${encodeURIComponent(limit)}`,
  ),
  progressOptions: () => req('/progress/options'),
  progress: (query = {}) => {
    const p = new URLSearchParams();
    const scalar = {
      learnerId: query.learnerId,
      scopeType: query.scopeType,
      scopeId: query.scopeId,
      periodId: query.periodId,
      from: query.from,
      to: query.to,
      recentLimit: query.recentLimit,
    };
    Object.entries(scalar).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') p.set(key, String(value));
    });
    const lists = {
      subject: query.subjectIds,
      area: query.areaIds,
      course: query.courseIds,
      unit: query.unitIds,
      lesson: query.lessonIds,
      module: query.moduleIds,
      concept: query.conceptIds,
      activityKind: query.activityKinds,
      surface: query.surfaceIds,
      classification: query.includeClassifications,
      excludeClassification: query.excludeClassifications,
      tag: query.includeTags,
      excludeTag: query.excludeTags,
      verification: query.verifications,
      groupBy: query.groupBy,
    };
    Object.entries(lists).forEach(([key, values]) => {
      if (Array.isArray(values) && values.length) p.set(key, values.join(','));
    });
    const qs = p.toString();
    return req(`/progress${qs ? `?${qs}` : ''}`);
  },
  instructionalInsights: (query = {}) => {
    const p = new URLSearchParams();
    for (const key of ['scopeType', 'scopeId', 'from', 'to']) {
      const value = query[key];
      if (value !== undefined && value !== null && value !== '') p.set(key, String(value));
    }
    const qs = p.toString();
    return req(`/progress/insights${qs ? `?${qs}` : ''}`);
  },
  recordReflection: (body) => req('/progress/reflections', body),
  recordProbeInteraction: (body) => req('/learning-probes/interactions', body),
  remediationSessions: (learnerId) => req(`/remediation?learnerId=${encodeURIComponent(learnerId)}`),
  remediationSession: (sessionId, learnerId, { after = 0, limit = 20 } = {}) => {
    const p = new URLSearchParams({ learnerId, after: String(after), limit: String(limit) });
    return req(`/remediation/${encodeURIComponent(sessionId)}?${p}`);
  },
  remediationAction: (sessionId, body) => req(`/remediation/${encodeURIComponent(sessionId)}/actions`, body),
  materialWorks: (materialId) => req(`/materials/${encodeURIComponent(materialId)}/works`),
  materialUnits: (materialId, userId) => req(`/materials/${encodeURIComponent(materialId)}/units${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  materialProgress: (userId, subject) => req(`/users/${encodeURIComponent(userId)}/material-progress${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`),
  quizRequests: (materialId) => req(`/quiz-requests${materialId ? `?materialId=${encodeURIComponent(materialId)}` : ''}`),
  requestQuiz: (body) => req('/quiz-requests', body),
  printables: () => req('/print/printables'),
  printQuota: (userId) => req(`/print/quota${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  requestPrint: (body) => req('/print/request', body),
  printPending: () => req('/print/pending'),
  approvePrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/approve`, { approver }),
  denyPrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/deny`, { approver }),
  unitProgress: (materialId, unitId, body = {}) => req(`/materials/${encodeURIComponent(materialId)}/units/${encodeURIComponent(unitId)}/progress`, body, 'PUT'),
};

export default schoolApi;
