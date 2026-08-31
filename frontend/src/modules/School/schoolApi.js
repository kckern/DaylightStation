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

/**
 * Same never-throws `{ok, status, data}` contract as `req`, but for a path
 * OUTSIDE `/api/v1/school`. Weekly measures are not a school resource — they
 * are a view over what fitness recorded — so they live under `/api/v1/measures`
 * and the school board merely consumes them.
 */
async function reqAbsolute(path) {
  try {
    const r = await fetch(path, { method: 'GET', credentials: 'same-origin' });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const schoolApi = {
  /**
   * Roster-wide weekly measures. One request for the whole board — the same
   * shape as `teacherDay`, and for the same reason: four cards must not mean
   * four round trips on a panel that repaints every five minutes.
   */
  measuresWeekly: (week = null) => reqAbsolute(
    `/api/v1/measures/weekly${week ? `?${new URLSearchParams({ week })}` : ''}`,
  ),

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
  // Content health (admin advocacy #7): which banks failed to parse at the
  // last warm, by id. `{warmedAt, banks, failed}` — never consumed by any UI
  // until the System health panel.
  bankHealth: () => req('/banks/health'),
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
  // Superseded freeze versions (admin advocacy #5) — the archived
  // `{periodId}.v<n>.yml` copies a supersede-close preserves rather than
  // destroys. The route is learner+period scoped (400 without both), never a
  // household-wide list.
  reportCardFrozenVersions: ({ learnerId, periodId }) => req(
    `/report-card/frozen/versions?${new URLSearchParams({ learnerId, periodId })}`,
  ),
  lifecycleReview: () => req('/lifecycle/review'),
  // The HOUSEHOLD-WIDE review queue is `lifecycleReview` above. This is the
  // per-session read a stuck-session row needs before it can say why a
  // `submitted` session is still open: usually a mark nobody has made yet.
  sessionReview: (sessionId) => req(`/lifecycle/sessions/${encodeURIComponent(sessionId)}/review`),
  learnerSessions: (learnerId, { window = null } = {}) => req(
    `/lifecycle/learners/${encodeURIComponent(learnerId)}/sessions${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  ),
  assignments: (learnerId) => req(`/lifecycle/assignments/${encodeURIComponent(learnerId)}`),
  allAssignments: () => req('/lifecycle/assignments'),
  staleSessions: () => req('/lifecycle/sessions/stale'),
  abandonSession: (sessionId, body) => req(`/lifecycle/sessions/${encodeURIComponent(sessionId)}/abandon`, body),
  // Settling stuck work by hand (session inspector). Two calls because they
  // are two events — `submitted → graded → outcome_recorded` is the whole
  // legal path and the transition table offers no shortcut, however the
  // console presents it.
  //
  // The step-up grant rides the GRADE only. It is the half that writes a mark
  // no machine produced, and a grant is one-use: presenting the same token
  // twice spends it on the first call and fails the second. Closing a graded
  // session is open by contract (a scan does it unattended), so it needs
  // nothing beyond the capability cookie.
  gradeSession: (sessionId, body, grantToken = null) => req(
    `/lifecycle/sessions/${encodeURIComponent(sessionId)}/grade`, body, 'POST',
    grantToken ? { 'X-Teacher-Step-Up': grantToken } : {},
  ),
  closeSession: (sessionId, body) => req(`/lifecycle/sessions/${encodeURIComponent(sessionId)}/close`, body, 'POST'),
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
  // Study-day program excusals (the piano lesson gate's parent override).
  // `pianoLessonGate` is the same read the kiosk makes — the panel shows what
  // it is about to excuse rather than asking a parent to guess.
  programDayBypasses: (learnerId) => req(learnerId
    ? `/program-day-bypasses?learnerId=${encodeURIComponent(learnerId)}`
    : '/program-day-bypasses'),
  grantProgramDayBypass: (body) => req('/program-day-bypasses', body),
  retractProgramDayBypass: (bypassId, body) => req(
    `/program-day-bypasses/${encodeURIComponent(bypassId)}/retract`, body,
  ),
  pianoLessonGate: (learnerId) => req(
    `/lifecycle/learners/${encodeURIComponent(learnerId)}/piano-lesson-gate`,
  ),
  teacherNotes: (learnerId) => req(`/teacher-notes?learnerId=${encodeURIComponent(learnerId)}`),
  postTeacherNote: (body) => req('/teacher-notes', body),
  attemptsSummary: (learnerId, day) => req(
    `/attempts-summary?learnerId=${encodeURIComponent(learnerId)}&day=${encodeURIComponent(day)}`,
  ),
  reassign: (body) => req('/reassign', body),
  // The session-level repair, and a different verb from `reassign` above: that
  // one moves a day's attempt EVENTS between learners, this appends one
  // `reassigned` event to a work session, which is the only way to re-credit
  // work no machine recorded answers for. Reason is mandatory server-side.
  reassignSession: (body) => req('/reassign-session', body),
  // The dry-run daily plan as data (advocacy A3) — no side effects.
  agendaPreview: (learnerId, studyDay = null) => req(`/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda/preview?${new URLSearchParams({
    format: 'json', ...(studyDay ? { studyDay } : {}),
  })}`),
  retract: (body) => req('/retract', body),
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
  // Browser-camera QR capture. The opaque token stays in the POST body (never
  // a URL or log label) and resolves to the same read-only launch card as the
  // six-digit alias.
  selfServiceResolveToken: (token) => req('/self-service/resolve-token', { token }),
  // The same card, opened from a link a grown-up was handed instead of six
  // digits a child typed. Same never-errors-for-a-bad-input contract as
  // `/resolve`: an unreadable link is a 200 carrying `{ ok: false, sentence }`,
  // so a non-2xx here means the backend itself is unwell. `link` is opaque and
  // passed through untouched — decoding it is the backend's job, and a link
  // this client "repaired" would preview a different card than the one shared.
  selfServicePreview: (link) => req(`/self-service/preview/${encodeURIComponent(link)}`),
  // `action` is the Action's `kind` (`print` | `play` | `launch` | `screen` |
  // `program` | `retry`); `exit` never reaches the wire.
  selfServiceAct: ({ code = null, token = null, action }) => req('/self-service/act', {
    ...(code ? { code } : {}), ...(token ? { token } : {}), action,
  }),
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
  // Same resolve the print path uses, minus every side effect (§6 of the
  // teacher reference) — an approver can see the sheet before saying yes.
  // A URL builder, not a fetcher: opened directly in a new tab like the
  // sibling worksheet/receipt links, never routed through `req`.
  printablePreviewUrl: (printableId) => `${BASE}/print/printables/${encodeURIComponent(printableId)}/preview`,
  printQuota: (userId) => req(`/print/quota${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  requestPrint: (body) => req('/print/request', body),
  printRequests: (userId) => req(`/print/requests?userId=${encodeURIComponent(userId)}`),
  printPending: () => req('/print/pending'),
  approvePrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/approve`, { approver }),
  denyPrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/deny`, { approver }),
  unitProgress: (materialId, unitId, body = {}) => req(`/materials/${encodeURIComponent(materialId)}/units/${encodeURIComponent(unitId)}/progress`, body, 'PUT'),

  // ── Living-room reading session (backend/src/4_api/v1/routers/reading.mjs) ──
  // `readingPlaying` reports the first frame, NOT the countdown expiring: the
  // backend's session state cannot see playback, and until it is told, the
  // mid-story branch of the state machine never fires.
  readingSummary: (learnerId) => req(`/reading/summary?learnerId=${encodeURIComponent(learnerId)}`),
  readingSession: (location) => req(`/reading/session?location=${encodeURIComponent(location)}`),
  acknowledgeReadingSession: ({ location, sessionId }) => req('/reading/session/ack', { location, sessionId }),
  readingProgress: (body) => req('/reading/progress', body),
  readingReadStatus: ({ learnerId, studyDay, pickId }) => req(`/reading/read-status?${new URLSearchParams({ learnerId, studyDay, pickId })}`),
  readingPlaying: (body) => req('/reading/playing', body),
  // `pickId` is the idempotency key: the same one twice is ONE read.
  readingRead: (body) => req('/reading/read', body),

  // ── Media lesson with comprehension checkpoints ────────────────────────────
  // (backend/src/4_api/v1/routers/mediaLesson.mjs, mounted at .../school/lesson)
  //
  // These four back a HARD gate, which is why they live here on the
  // status-aware client rather than on DaylightAPI. `410 Gone` is the status
  // that matters: it means the server no longer has that session, so the child
  // is not paused waiting for a question — the lesson is over. It is passed
  // THROUGH untouched, exactly like every other status. Normalizing it here
  // (to an ok, or to a synthesized "ended" payload) would put the decision in
  // the one place that cannot make it: only the caller knows whether a gone
  // session means "close the overlay", "let the credits run", or "say nothing
  // and keep playing" — and this file exists precisely so that choice stays
  // with the caller.
  //
  // `sessionId` is server-minted and lands in a path segment, so it is encoded
  // the same way `surfaceProfile` encodes its screen id.
  lessonSession: (sessionId) => req(`/lesson/${encodeURIComponent(sessionId)}`),
  lessonAnswer: (sessionId, body = {}) => req(`/lesson/${encodeURIComponent(sessionId)}/answer`, body),
  // The playhead heartbeat (~15s while playing). It returns the same
  // `{ok, status, data}` as everything else and is NOT fire-and-forget:
  // `req()` already never throws, so the caller cannot be hurt by ignoring the
  // result, but a heartbeat is also the first thing to learn that the session
  // died (410) and the hook needs that to stop the timer. Discarding the
  // answer here would throw away the only signal a heartbeat carries. What a
  // caller must NOT do is surface a failed heartbeat as an error on screen.
  // `position` is passed through UNCONDITIONALLY, never `position ? ... : ...`:
  // a lesson resumed at the very start heartbeats at 0, and a truthiness test
  // would drop exactly that one — the first heartbeat of every fresh lesson —
  // while looking like a successful POST. It is also NOT defaulted: an omitted
  // position must reach the server as absent, not as a fabricated 0.
  lessonPosition: (sessionId, position) => req(`/lesson/${encodeURIComponent(sessionId)}/position`, { position }),
  // Player reported semantic natural completion. A body-less POST still needs
  // a body argument, for the same reason `answer()` defaults to `{}`.
  lessonEnded: (sessionId) => req(`/lesson/${encodeURIComponent(sessionId)}/ended`, {}),
};

export default schoolApi;
