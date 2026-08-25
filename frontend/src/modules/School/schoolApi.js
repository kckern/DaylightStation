/**
 * Status-aware fetch client for /api/v1/school. NOT DaylightAPI: the runners
 * must distinguish 403 (guest/assigned), 410 (session gone), and 500 (attempt
 * unrecorded — spec §8), and DaylightAPI hides status codes. Never throws.
 */
const BASE = '/api/v1/school';

async function req(path, body, method, headers = {}) {
  try {
    const opts = body === undefined
      ? { method: method || 'GET', credentials: 'same-origin', headers }
      : { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
    const r = await fetch(BASE + path, opts);
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const schoolApi = {
  rubiksCubePreview: () => req('/rubiks-cube/preview'),
  rubiksCubeOpen: ({ userId, courseId, grant, lessonId = null }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}${lessonId ? '/open' : ''}`,
    lessonId ? { lessonId } : undefined,
    lessonId ? 'POST' : 'GET', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubeTurn: ({ userId, courseId, grant, lessonId, move, expectedRevision }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/turn`, { lessonId, move, expectedRevision }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubeRestart: ({ userId, courseId, grant, lessonId }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/restart`, { lessonId }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubeDemo: ({ userId, courseId, grant, lessonId }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/demo`, { lessonId }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubeHint: ({ userId, courseId, grant, lessonId }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/hint`, { lessonId }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubeAnswer: ({ userId, courseId, grant, lessonId, answers }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/answer`, { lessonId, answers }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubePhysicalImport: ({ userId, courseId, grant, faces }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/physical/import`, { faces }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubePhysicalCoach: ({ userId, courseId, grant, lessonId }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/physical/coach`, { lessonId }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubePhysicalCoachAdvance: ({ userId, courseId, grant }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/physical/coach/advance`, {}, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubePhysicalVerify: ({ userId, courseId, grant, lessonId, faces }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/physical/verify`, { lessonId, faces }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubePacket: ({ userId, courseId, grant, lessonId }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/packets`, { lessonId }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
  rubiksCubePacketVerify: ({ userId, courseId, grant, packetId, faces }) => req(
    `/rubiks-cube/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/packets/${encodeURIComponent(packetId)}/verify`, { faces }, 'POST', { 'X-School-Cube-Grant': grant },
  ),
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
  // `fresh: true` is the deliberate-restart flag (Task 17): the server wipes
  // any persisted mid-quiz sitting before opening, so the run starts at q1.
  openSession: ({ userId = null, bankId, mode, learning = null, purpose = null, deckId = null, testPlan = null, fresh = false }) => req('/sessions', {
    userId, bankId, mode, ...(learning ? { learning } : {}), ...(purpose ? { purpose } : {}), ...(deckId ? { deckId } : {}), ...(testPlan ? { testPlan } : {}), ...(fresh ? { fresh: true } : {}),
  }),
  answer: (sessionId, body = {}) => req(`/sessions/${encodeURIComponent(sessionId)}/answer`, body),
  flashcardOpen: ({ userId, deckId, learning = null }) => req('/flashcards/open', { userId, deckId, ...(learning ? { learning } : {}) }),
  flashcardDecks: () => req('/flashcards'),
  flashcardAssetUrl: (assetId) => `/api/v1/school/flashcards/assets/${String(assetId).split('/').map(encodeURIComponent).join('/')}`,
  flashcardSummary: (deckId, userId) => req(`/flashcards/${encodeURIComponent(deckId)}/summary?userId=${encodeURIComponent(userId)}`),
  flashcardReport: (userId) => req(`/flashcards/report?userId=${encodeURIComponent(userId)}`),
  flashcardDeck: (deckId) => req(`/flashcards/${encodeURIComponent(deckId)}`),
  flashcardAssessment: (deckId, { userId, testPlan = null, learning = null } = {}) => req(`/flashcards/${encodeURIComponent(deckId)}/assessment`, { userId, ...(testPlan ? { testPlan } : {}), ...(learning ? { learning } : {}) }),
  flashcardReview: (sessionId, { userId, cardId, rating, mode, direction }) => req(`/flashcards/${encodeURIComponent(sessionId)}/review`, { userId, cardId, rating, mode, direction }),
  flashcardPreview: (sessionId, { userId, cardId }) => req(`/flashcards/${encodeURIComponent(sessionId)}/preview`, { userId, cardId }),
  flashcardTeacherReport: ({ learnerId, actorId, pin = null }) => req('/flashcards/teacher-report', { learnerId, actorId, ...(pin ? { pin } : {}) }),
  flashcardRepair: (deckId, body) => req(`/flashcards/${encodeURIComponent(deckId)}/repair`, body),
  flashcardMigrateProfile: (deckId, body) => req(`/flashcards/${encodeURIComponent(deckId)}/migrate-profile`, body),
  flashcardHeartbeat: (sessionId, { userId, seconds }) => req(`/flashcards/${encodeURIComponent(sessionId)}/heartbeat`, { userId, seconds }),
  remediationOffer: (sessionId, learnerId) => req(
    `/sessions/${encodeURIComponent(sessionId)}/remediation-offer`, { learnerId },
  ),
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
  // An omitted day means "today" to the server. Never serialize it as the
  // literal string `undefined`, which is rightly rejected as a malformed date.
  teacherDay: (studyDay = null) => req(`/teacher/day${studyDay ? `?${new URLSearchParams({ studyDay })}` : ''}`),
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
  allAssignments: () => req('/lifecycle/assignments'),
  staleSessions: () => req('/lifecycle/sessions/stale'),
  abandonSession: (sessionId, body) => req(`/lifecycle/sessions/${encodeURIComponent(sessionId)}/abandon`, body),
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
  syllabi: () => req('/lifecycle/syllabi'),
  syllabus: (id) => req(`/lifecycle/syllabi/${encodeURIComponent(id)}`),
  putSyllabus: (id, body) => req(`/lifecycle/syllabi/${encodeURIComponent(id)}`, body, 'PUT'),
  archiveSyllabus: (id, body) => req(`/lifecycle/syllabi/${encodeURIComponent(id)}/archive`, body, 'POST'),
  enroll: (learnerId, body) => req(`/lifecycle/enrollments/${encodeURIComponent(learnerId)}`, body, 'POST'),
  unenroll: (learnerId, courseId, body) => req(
    `/lifecycle/enrollments/${encodeURIComponent(learnerId)}/${encodeURIComponent(courseId)}`, body, 'DELETE',
  ),
  putPeriods: (body) => req('/periods', body, 'PUT'),
  passOverrides: () => req('/pass-overrides'),
  putPassOverride: (unitId, body) => req(`/pass-overrides/${encodeURIComponent(unitId)}`, body, 'PUT'),
  milestones: (learnerId) => req(`/milestones?learnerId=${encodeURIComponent(learnerId)}`),
  putMilestones: (body) => req('/milestones', body, 'PUT'),
  enrichment: (learnerId = null) => req(`/enrichment${learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : ''}`),
  postEnrichment: (body) => req('/enrichment', body),
  // Wave-4 records.
  closePeriod: (body, grantToken = null) => req('/report-card/close', body, 'POST',
    grantToken ? { 'X-Teacher-Step-Up': grantToken } : {}),
  regradeAttempts: (body, grantToken = null) => req('/attempts/regrade', body, 'POST',
    grantToken ? { 'X-Teacher-Step-Up': grantToken } : {}),
  // Wave-5 repair.
  attestations: (learnerId) => req(learnerId ? `/attestations?learnerId=${encodeURIComponent(learnerId)}` : '/attestations'),
  postAttestation: (body) => req('/attestations', body),
  teacherNotes: (learnerId) => req(`/teacher-notes?learnerId=${encodeURIComponent(learnerId)}`),
  postTeacherNote: (body) => req('/teacher-notes', body),
  attemptsSummary: (learnerId, day) => req(
    `/attempts-summary?learnerId=${encodeURIComponent(learnerId)}&day=${encodeURIComponent(day)}`,
  ),
  reassign: (body) => req('/reassign', body),
  // The dry-run daily plan as data (advocacy A3) — no side effects.
  agendaPreview: (learnerId, studyDay = null) => req(`/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda/preview?${new URLSearchParams({
    format: 'json', ...(studyDay ? { studyDay } : {}),
  })}`),
  retract: (body) => req('/retract', body),
  transcript: (learnerId) => req(`/transcript?learnerId=${encodeURIComponent(learnerId)}`),
  periodsMeta: () => req('/periods-meta'),
  attemptDays: (learnerId) => req(`/attempt-days?learnerId=${encodeURIComponent(learnerId)}`),
  offerRetake: (sessionId, body) => req(`/teacher/sessions/${encodeURIComponent(sessionId)}/remediation`, body),
  requestRetake: (body) => req('/retake-requests', body),
  flagConcern: (body) => req('/flags', body),
  // --- Self-service access codes (design §4) -------------------------------
  // `/resolve` NEVER answers with an error status for a bad code: an unknown,
  // expired or revoked code is a 200 carrying `{ ok: false, sentence }`. So a
  // non-2xx here means the backend itself is unwell (down, lifecycle disabled
  // → 404, or 500) and the panel shows its degraded message instead of "Try
  // again" — the two must not be confused.
  selfServiceResolve: (code) => req('/self-service/resolve', { code }),
  // `action` is the Action's `kind` (`print` | `play` | `launch` | `screen` |
  // `program` | `retry`); `exit` never reaches the wire.
  selfServiceAct: ({ code, action }) => req('/self-service/act', { code, action }),
  companionProgress: (id, body) => req(`/self-service/companions/${encodeURIComponent(id)}/progress`, body),
  // "Can the printer print right now?" — polled ONLY while the panel is asking
  // a child "Did it print?", so it can name a jam or an empty tray instead of
  // making them adjudicate one. Answers `{ ok, healthy, state, reasons,
  // sentence }`, where `healthy: null` means "cannot tell" (no printer wired,
  // or the status read failed). The caller must treat ONLY an explicit
  // `healthy === false` as a fault: this endpoint is an ENHANCEMENT to the
  // question, never a precondition for it, and a broken status check must
  // leave a child exactly where they were.
  selfServicePrinterStatus: () => req('/self-service/printer-status'),
  // The mounted screen's own config (`/api/v1/screens/<id>`), which is where
  // lock mode lives (D6: per-screen, so a parent's browser stays browsable).
  // Different base to BASE, hence the raw fetch — same never-throws contract.
  screenSchoolConfig: async (screenId) => {
    try {
      const r = await fetch(`/api/v1/screens/${encodeURIComponent(screenId)}`);
      const data = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: null }; }
  },
  // The coin balance lives on the economy API (different base) — same
  // never-throws contract as req().
  wallet: async (userId) => {
    try {
      const r = await fetch(`/api/v1/economy/users/${encodeURIComponent(userId)}/wallet`);
      const data = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: null }; }
  },
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
  printRequests: (userId) => req(`/print/requests?userId=${encodeURIComponent(userId)}`),
  printPending: () => req('/print/pending'),
  approvePrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/approve`, { approver }),
  denyPrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/deny`, { approver }),
  unitProgress: (materialId, unitId, body = {}) => req(`/materials/${encodeURIComponent(materialId)}/units/${encodeURIComponent(unitId)}/progress`, body, 'PUT'),
};

export default schoolApi;
