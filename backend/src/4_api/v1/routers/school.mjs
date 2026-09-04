import { sendInternalError } from '#api/utils/internalError.mjs';
/**
 * /api/v1/school — thin HTTP shell over SchoolService (spec §5, §8).
 * All policy lives in the service; this file only maps errors to statuses.
 */
import express from 'express';
import { splatPath } from '#api/utils/wildcard.mjs';
import { sendLocalFileResource } from '#system/http/streamFile.mjs';
import { presentPublicResources } from '../presenters/publicResourceRefs.mjs';

export function createSchoolRouter({
  schoolErrors = {},
  coreErrors = {},
  slugify,
  schoolService,
  schoolApiSessions,
  flashcardStudy = null,
  schoolResourceService = null,
  schoolPrintAccess = null,
  schoolRecordsQuery = null,
  schoolReportDocuments = null,
  schoolCurriculumQuery = null,
  schoolArtifactService = null,
  sendFileResource = sendLocalFileResource,
  getMaterialCatalog = null,
  getMaterialUnits = null,
  getMaterialProgressSummary = null,
  getSchoolReport = null,
  getLearningProgress = null,
  getInstructionalInsights = null,
  recordLearningReflection = null,
  recordLearningProbeInteraction = null,
  remediationTutor = null,
  offerCatalogQuizRemediation = null,
  issueContinuationCode = null,
  printService = null,
  getLearnerRecord = null,
  regradeBankAttempts = null,
  getTeacherSession = null,
  getCompanionFinishCode = null,
  previewTeacherLessonMaterial = null,
  getLearnerTimeline = null,
  adjustSessionGrade = null,
  retractSessionGradeAdjustment = null,
  invalidateSessionEvidence = null,
  teacherAgendaDispatch = null,
  launchPreviewTokens = null,
  manageCurriculumException = null,
  teacherCapabilitySessions = null,
  teacherGate = null,
  openRemediation = null,
  schoolCalcRouter = null,
  surfaceCertification = null,
  // Report cards, period close, teacher digest (Task 6, spec R5b).
  getReportCard = null,
  closeAcademicPeriod = null,
  getTeacherToday = null,
  // Teacher console picker (teacher-console spec §4.7.1) — the config-declared
  // teacher roster, `{configured, teachers: [{id, name}]}`.
  getTeachers = null,
  // Feedback delivery + kid-visible standing (Task 9, spec R7 / adequacy).
  // Wave-3 planning domains (teacher-console W3-1..W3-4): all writes are
  // TeacherGate-checked inside their use cases; reads are open like the rest.
  setAcademicPeriods = null,
  getProgressReport = null,
  // Wave-5 repair (spec D1/D2/D3) — writes gated inside their use cases.
  recordAttestation = null,
  // Study-day program excusals (piano lesson gate) — same gated-inside rule.
  manageProgramDayBypass = null,
  recordTeacherNote = null,
  reassignEvidence = null,
  // The session-level twin of `reassignEvidence` (plan 4.1): re-credits work
  // that has no machine attempts to move. Mounted here rather than on the
  // lifecycle router because `/sessions` on this router already means quiz
  // sessions, not work sessions.
  reassignSession = null,
  // Task 12 (debt M5) — the reassignment audit trail, merged into GET /audit.
  // Advocacy wave 6.
  retractTeacherRecord = null,
  getTranscript = null,
  setPassOverride = null,
  milestoneStatuses = null,
  setMilestones = null,
  recordEnrichment = null,
  logger = console,
}) {
  // School error CLASSES arrive via the factory. A router may not import
  // 2_domains (api-layer-guidelines.md), but it does own the mapping from a
  // domain failure to an HTTP status, so it needs the types to match on.
  // Guarded at each use: an un-injected class would make `instanceof`
  // throw a TypeError mid-request, which reads as a hang rather than a
  // wiring mistake. Composition always supplies these.
  const { GuestForbiddenError, SessionGoneError } = schoolErrors;
  const { ValidationError, EntityNotFoundError, DomainInvariantError } = coreErrors;
  const router = express.Router();
  const cookieValue = (req, name) => {
    const raw = req.get('cookie') ?? '';
    for (const part of raw.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
    return null;
  };
  const capabilityProof = (req) => {
    const capabilityToken = cookieValue(req, 'daylight_teacher_session');
    return capabilityToken ? {
      capabilityToken,
      stepUpToken: req.get('X-Teacher-Step-Up') ?? null,
    } : null;
  };
  const teacherCookie = (req, value, maxAge) => {
    const secure = req.secure || String(req.get('X-Forwarded-Proto') ?? '').split(',')[0].trim() === 'https';
    return `daylight_teacher_session=${value}; Path=/api/v1/school; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  };
  // Cookie capabilities ride the existing `pin` argument into TeacherGate.
  // A literal body PIN always wins, preserving every deployed client/CLI.
  router.use((req, _res, next) => {
    if (!req.path.startsWith('/teacher/auth/')
        && req.body && typeof req.body === 'object' && req.body.pin == null) {
      const proof = capabilityProof(req);
      if (proof) req.body.pin = proof;
    }
    next();
  });
  let warnedMaterialsConfigMissing = false;
  const wrap = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (GuestForbiddenError && err instanceof GuestForbiddenError) return res.status(403).json({ error: err.message });
        if (SessionGoneError && err instanceof SessionGoneError) return res.status(410).json({ error: err.message });
        if (err instanceof EntityNotFoundError) return res.status(404).json({ error: err.message });
        if ([
          'REMEDIATION_ACTION_CONFLICT', 'REMEDIATION_ACTION_OUT_OF_ORDER',
          // A concurrent-edit refusal (SetAcademicPeriods, SetAssignments): the
          // CLIENT's base was stale, not malformed — 409, never this router's
          // by-instanceof 400 for a plain name='ValidationError' error.
          'STALE_SAVE',
        ].includes(err?.code)) {
          return res.status(err.status ?? 409).json({ error: err.message, code: err.code });
        }
        if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
        // A store/domain invariant refusal (allocation collision, illegal
        // status transition, …) is the CLIENT's conflict to resolve — a 409
        // carrying the invariant's own code, never an anonymous 500.
        if (err instanceof DomainInvariantError) {
          return res.status(409).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
        }
        if (err?.code === 'ADAPTIVE_TUTOR_UNAVAILABLE') {
          return res.status(503).json({ error: err.message, code: err.code });
        }
        logger.error?.('school.router.error', { path: req.path, error: err.message });
        return sendInternalError(res, { error: 'internal' });
      });
  };

  // Frontend contract: unlock sets the HttpOnly cookie; ordinary writes then
  // need no PIN body. Sensitive calls first POST /step-up and send the returned
  // one-use grant in X-Teacher-Step-Up. Raw PIN bodies remain valid everywhere.
  router.post('/teacher/auth/unlock', wrap(async (req, res) => {
    if (!teacherCapabilitySessions) throw new EntityNotFoundError('teacher authorization', 'not configured');
    const body = req.body || {};
    const unlocked = teacherCapabilitySessions.unlock({ userId: body.userId ?? body.actorId ?? null, pin: body.pin });
    res.set('Cache-Control', 'no-store');
    res.set('Set-Cookie', teacherCookie(req, encodeURIComponent(unlocked.capabilityToken), 1800));
    const { capabilityToken: _secret, ...status } = unlocked;
    res.json({ active: true, ...status });
  }));
  router.get('/teacher/auth/status', wrap(async (req, res) => {
    if (!teacherCapabilitySessions) return res.json({ active: false });
    res.set('Cache-Control', 'no-store').json(teacherCapabilitySessions.status(
      cookieValue(req, 'daylight_teacher_session'),
    ));
  }));
  router.post('/teacher/auth/step-up', wrap(async (req, res) => {
    if (!teacherCapabilitySessions) throw new EntityNotFoundError('teacher authorization', 'not configured');
    const body = req.body || {};
    res.set('Cache-Control', 'no-store').json(teacherCapabilitySessions.stepUp({
      capabilityToken: cookieValue(req, 'daylight_teacher_session'),
      pin: body.pin,
      action: body.action, resource: body.resource,
    }));
  }));
  router.post('/teacher/auth/lock', wrap(async (req, res) => {
    const locked = teacherCapabilitySessions?.lock(cookieValue(req, 'daylight_teacher_session')) ?? { locked: false };
    res.set('Set-Cookie', teacherCookie(req, '', 0));
    res.json(locked);
  }));

  router.get('/roster', wrap(async (req, res) => res.json(
    (await schoolResourceService?.listLearners?.()) ?? schoolService.getRoster(),
  )));
  // The teacher console's picker roster: config-declared teacher ids resolved
  // against the live household roster per request. Unwired serves the honest
  // "not configured" shape rather than 404ing a surface that can explain it.
  router.get('/teachers', wrap(async (req, res) => res.json(
    getTeachers ? await getTeachers.execute() : { configured: false, teachers: [] },
  )));
  // Await the (async, off-thread) warm so a cold cache returns the full list
  // rather than empty — without ever blocking the event loop on the file scan.
  // Content health (admin advocacy #7): banks that failed to parse at warm.
  router.get('/banks/health', wrap(async (req, res) => {
    res.json(await schoolApiSessions.bankHealth());
  }));
  router.get('/banks', wrap(async (req, res) => {
    res.json(await schoolApiSessions.listBanks({ audience: req.query.audience }));
  }));
  router.get('/banks/:bankId', wrap((req, res) => res.json(schoolService.getBank(req.params.bankId))));
  router.get('/catalogs', wrap(async (req, res) => {
    const catalogs = await schoolResourceService?.listCatalogs?.(textQuery(req.query.learnerId));
    if (catalogs === null || catalogs === undefined) return res.json({ schema: 'school.catalog-index/v1', catalogs: [] });
    return res.set('Cache-Control', 'no-store').json(catalogs);
  }));
  router.get('/catalogs/:catalogId/subjects/:subjectId/courses/:courseId/units/:unitId/lessons/:lessonId', wrap(async (req, res) => {
    if (!schoolResourceService) throw new EntityNotFoundError('School Catalog', 'not configured');
    const { catalogId, subjectId, courseId, unitId, lessonId } = req.params;
    const lesson = await schoolResourceService.getCatalogLesson({
      catalogId, subjectId, courseId, unitId, lessonId,
      learnerId: textQuery(req.query.learnerId),
    });
    if (lesson === null) throw new EntityNotFoundError('School Catalog', 'not configured');
    return res.set('Cache-Control', 'no-store').json(lesson);
  }));
  // A continuation code is a public convenience route, not a credential. The
  // application owns stable learner-slot policy and the reversible encoding;
  // HTTP merely validates the two text query fields and returns its DTO.
  router.get('/continuation-code', wrap(async (req, res) => {
    if (!issueContinuationCode) throw new EntityNotFoundError('School continuation codes', 'not configured');
    return res.set('Cache-Control', 'no-store').json(await issueContinuationCode.execute({
      learnerId: requiredTextQuery(req.query.learnerId, 'learnerId'),
      moduleCode: requiredTextQuery(req.query.moduleCode, 'moduleCode'),
    }));
  }));

  // Surface certification matrix (spec §4.2, §9): one row per registered
  // profile/codec-baseline for either a catalog lesson address or a
  // standalone bank, optionally filtered to one surface. `surfaceCertification`
  // is absent whenever the School Catalog/registry composition failed to wire
  // (e.g. missing surfaces content) — 503 rather than a misleading empty/404,
  // since the feature is simply not available, not "not found" (mirrors the
  // ADAPTIVE_TUTOR_UNAVAILABLE 503 convention already used below for the
  // remediation tutor's own unavailable dependency).
  router.get('/certification', wrap(async (req, res) => {
    if (!surfaceCertification) return res.status(503).json({ error: 'certification-unavailable' });
    const address = textQuery(req.query.address);
    const bankId = textQuery(req.query.bank);
    const surfaceId = textQuery(req.query.surface);
    if ((address === null) === (bankId === null)) {
      throw new ValidationError('certification requires exactly one of address or bank');
    }
    if (address !== null && !isLessonAddress(address)) {
      throw new ValidationError('address must be a 5-segment catalogId/subjectId/courseId/unitId/lessonId path');
    }
    let rows;
    try {
      rows = await surfaceCertification.select({ address, bankId, surfaceId });
    } catch {
      throw new EntityNotFoundError('School surface certification target', address ?? bankId);
    }
    return res.set('Cache-Control', 'no-store').json(rows);
  }));

  // Screen surface-profile resolution (spec §4.2 review finding 3): a
  // screen's config YAML may carry an optional top-level `surfaceProfile: <id>`
  // key (served today by screens.mjs); `?screen=browser` or an absent param
  // resolves the fixed 'screen-browser' id instead of reading any screen
  // config. Every step of the chain is fail-closed — a miss anywhere (no
  // registry, no screen config, no key, unknown id) is a 404, never a
  // synthesized default, because a wrong profile would misreport what a
  // surface can actually render.
  router.get('/surfaces/profile', wrap(async (req, res) => {
    const screenParam = textQuery(req.query.screen);
    const unresolved = (reason) => {
      logger.warn?.('school.surfaces.profile.unresolved', { screen: screenParam, reason });
      return res.status(404).json({ error: 'surface-profile-unresolved' });
    };
    const result = schoolResourceService
      ? await schoolResourceService.resolveSurfaceProfile(screenParam)
      : { kind: 'unresolved', reason: 'surface registry not configured' };
    if (result.kind === 'unresolved') return unresolved(result.reason);
    return res.set('Cache-Control', 'no-store').json(result.profile);
  }));

  // On-demand print rendering — the "printout is an app screen" contract over
  // HTTP. Two varieties:
  //   variety=omr  — card-attached: the sheet carries the card/sheet-ID strip
  //                  and questions numbered by card row. Requires freshCard=1
  //                  (mints a new card — deliberate, never on a bare refresh)
  //                  or card=<7 digits>[&startRow=<1..50>] to attach/extend an
  //                  existing card (idempotent reprint semantics apply).
  //   variety=hand — hand-graded: no card machinery, positional numbering;
  //                  the intentional "rendered without card allocation"
  //                  warning is filtered because hand grading is the point.
  // Common params: teacher=1 (answer-key render mode, identical shuffles),
  // learnerName (header prefill), learnerId (omr allocation attribution),
  // date, variant (per-kid shuffle variant — spread over the document exactly
  // as IssueDocument does; the variant never lives in the published artifact).
  // Warnings and the allocation result ride response headers so the body can
  // stay a plain PDF.
  //
  // Card-minting is a MUTATION (it allocates/consumes a card) and a teacher
  // pin is a secret — neither belongs on a GET, whose URL lands in browser
  // history, proxy access logs, and Referer headers. `POST /print/render`
  // (below, registered with the other fixed routes) carries card=/freshCard=
  // /teacherPin= — and everything else this handler reads — in the JSON
  // body instead. The GET splat stays a plain, repeatable proof render and
  // 400s if it sees any of those three query params, naming the POST route.
  // Both routes share the render body via the local `renderPrintResponse`
  // helper so the allocation semantics can't drift between them.
  // The FIXED /print routes must register BEFORE the /print/*id splat below —
  // Express matches in registration order, and the splat would otherwise
  // swallow them as document ids (it did, in production, until 2026-08-06:
  // /print/pending 404'd as "print document not found: pending"). No
  // reserved-name exclusion list on purpose — it would silently drift the
  // day a new fixed /print route is added; order is the one source of truth.
  // /print/render (added 2026-08-06) is a fixed route for the same reason.
  router.get('/print/printables', wrap(async (req, res) => {
    res.json(printService ? await printService.listPrintables() : []);
  }));
  router.get('/print/quota', wrap((req, res) => {
    if (!printService || !req.query.userId) return res.json(null);
    res.json(printService.getQuota(req.query.userId));
  }));
  router.get('/print/pending', wrap((req, res) => {
    res.json(printService ? printService.listPending() : []);
  }));
  // A learner's own asks (pending + denied) — the kid-facing outcome view.
  router.get('/print/requests', wrap((req, res) => {
    if (!printService || !req.query.userId) return res.json([]);
    res.json(printService.listRequestsFor(req.query.userId));
  }));
  // A read-only render of an authored printable (debt M6a) — an approver
  // should be able to see the sheet before saying yes. Deliberately bare:
  // PrintService.previewPrintable does NOT check quota, print, or log — it's
  // the same #resolve the print path uses, minus every side effect. Fixed
  // route registered here (with the other /print/* fixed routes, ABOVE the
  // /print/*id splat) so `:printableId` never collides with a document id —
  // same registration-order rule the comment above `/print/printables`
  // documents.
  router.get('/print/printables/:printableId/preview', wrap(async (req, res) => {
    if (!printService) return res.status(503).json({ error: 'print-unavailable' });
    const { pdf } = await printService.previewPrintable(req.params.printableId);
    res.set('Content-Disposition', `inline; filename="preview-${slugify(req.params.printableId)}.pdf"`);
    return res.type('application/pdf').send(pdf);
  }));
  // Card-minting render, moved off the GET splat (see the comment block
  // above). Body mirrors the query params the splat used to accept, plus
  // `teacherPin` — the GET's `pin=` name stays GET-only (a bare teacher-key
  // READ never mints and was never blocked here); a mutating render's pin
  // belongs in a body, never a URL.
  router.post('/print/render', wrap(async (req, res) => {
    if (!schoolPrintAccess?.isRenderable?.()) return res.status(503).json({ error: 'print-render-unavailable' });
    return renderPrintResponse(parsePrintRequest(req.body || {}, { jsonBody: true }), res);
  }));
  // Hierarchical taxonomy ids contain '/', so the id is a named wildcard
  // (Express 5 splat) rather than a single segment.
  router.get('/print/*id', wrap(async (req, res) => {
    if (!schoolPrintAccess?.isRenderable?.()) return res.status(503).json({ error: 'print-render-unavailable' });
    // card=/freshCard=/teacherPin= mint or spend a card, or carry a secret —
    // none belong in a GET query string. POST /print/render is the mutating
    // path now; a plain proof render (no card params) renders exactly as
    // before.
    if (req.query.card !== undefined || req.query.freshCard !== undefined || req.query.teacherPin !== undefined) {
      return res.status(400).json({ error: 'card-minting renders require POST /print/render' });
    }
    // `id` is explicitly LAST: the path segment is the id, always — a stray
    // `?id=` in the query string (there is no legitimate reason for one)
    // must never override it.
    return renderPrintResponse(parsePrintRequest(req.query, { id: splatPath(req, 'id') }), res);
  }));

  /**
   * Render a print document to a PDF response — the shared body of the
   * `/print/*id` proof-GET and `/print/render` card-minting POST (see the
   * comment block above `PRINT_DOC_ID`). `params` mirrors the query-string
   * shape both callers expose. The API parser converts GET strings and POST
   * JSON values to one typed semantic command before invoking the application.
   */
  async function renderPrintResponse(params, res) {
    const result = await schoolPrintAccess.renderRequest(params);
    if (result.kind === 'unconfigured') return res.status(503).json({ error: 'print-render-unavailable' });
    if (result.kind === 'card_not_found') {
      return res.status(404).json({
        error: `no sheet found for card ${result.cardId}`,
        ...(result.nearMissCardIds.length ? { nearMissCardIds: result.nearMissCardIds } : {}),
      });
    }
    if (result.kind === 'teacher_disabled') {
      return res.status(403).json({ error: 'teacher keys are disabled: set print.teacherPin in the school household config' });
    }
    if (result.kind === 'teacher_pin_required') {
      return res.status(403).json({ error: 'teacher key requires the correct pin=<value>' });
    }
    if (result.warnings.length) res.set('X-School-Print-Warnings', JSON.stringify(result.warnings));
    if (result.allocation) res.set('X-School-Print-Allocation', JSON.stringify(result.allocation));
    res.set('Cache-Control', 'no-store');
    const slug = result.id.split('/').pop();
    res.set('Content-Disposition', `inline; filename="${slug}${result.teacher ? '-key' : ''}.pdf"`);
    return res.type('application/pdf').send(Buffer.from(result.bytes));
  }

  function parsePrintRequest(raw, { jsonBody = false, id = undefined } = {}) {
    const value = (key) => {
      const input = key === 'id' && id !== undefined ? id : raw[key];
      return jsonBody ? toParamString(input) : input;
    };
    const boolean = (key) => {
      const input = textQuery(value(key));
      return input === '1' || input === 'true';
    };
    const optionalBoolean = (key) => value(key) === undefined ? undefined : boolean(key);
    const optionalInteger = (key, fallback, minimum, maximum) =>
      value(key) === undefined ? undefined
        : boundedIntegerQuery(value(key), fallback, minimum, maximum, key);
    return {
      id: textQuery(value('id')),
      variety: textQuery(value('variety')) ?? 'omr',
      learnerName: textQuery(value('learnerName')),
      date: textQuery(value('date')),
      teacher: boolean('teacher'),
      pin: textQuery(jsonBody ? toParamString(raw.teacherPin) : raw.pin),
      rev: textQuery(value('rev')),
      variant: optionalInteger('variant', 0, 0, 999),
      freshCard: optionalBoolean('freshCard'),
      // Presence is semantic for card parameters: `undefined` means omitted,
      // while an explicitly supplied empty value is still validated downstream.
      card: value('card') === undefined ? undefined : textQuery(value('card')),
      learnerId: textQuery(value('learnerId')),
      retake: optionalBoolean('retake'),
      startRow: optionalInteger('startRow', 1, 1, 50),
    };
  }


  router.get('/geography/decks', wrap((req, res) => {
    // Geography is an outer presentation here. The service/source expose only
    // generic collections and bank summaries.
    const decks = schoolService.listBankSourceSummaries({ collection: 'geography' })
      .map(({ summaryId, ...summary }) => ({ deckId: summaryId, ...summary }));
    res.json({ decks });
  }));
  router.post('/sessions', wrap(async (req, res) => {
    return res.json(await schoolApiSessions.open(req.body || {}));
  }));
  router.post('/sessions/:sessionId/answer', wrap((req, res) => {
    const {
      itemId, given, selfGrade, probeAttemptNumber = null, responseId = null,
    } = req.body || {};
    res.json(schoolService.answer({
      sessionId: req.params.sessionId, itemId, given, selfGrade,
      probeAttemptNumber, responseId,
    }));
  }));
  // Rich flashcard study is intentionally separate from question-bank sessions:
  // its ratings are formative scheduling data, never server-graded quiz evidence.
  router.post('/flashcards/open', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { userId, deckId, learning = null } = req.body || {};
    res.json(await flashcardStudy.open({ userId, deckId, learning }));
  }));
  router.post('/flashcards/:deckId/assessment', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { userId, testPlan = null, learning = null } = req.body || {};
    res.json(await flashcardStudy.assessment({ userId, deckId: req.params.deckId, testPlan, learning }));
  }));
  router.post('/flashcards/:sessionId/review', wrap((req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { userId, cardId, rating, mode, direction } = req.body || {};
    res.json(flashcardStudy.review({ userId, sessionId: req.params.sessionId, cardId, rating, mode, direction }));
  }));
  router.post('/flashcards/:sessionId/preview', wrap((req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { userId, cardId } = req.body || {};
    res.json(flashcardStudy.preview({ userId, sessionId: req.params.sessionId, cardId }));
  }));
  router.post('/flashcards/:deckId/repair', wrap((req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { learnerId, cardId, action, actorId, pin = null } = req.body || {};
    res.json(flashcardStudy.repair({ learnerId, deckId: req.params.deckId, cardId, action, actorId, pin }));
  }));
  router.post('/flashcards/:deckId/migrate-profile', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { learnerId, actorId, pin = null, dryRun = true } = req.body || {};
    res.json(await flashcardStudy.migrateProfile({ learnerId, deckId: req.params.deckId, actorId, pin, dryRun: dryRun !== false }));
  }));
  router.post('/flashcards/:sessionId/heartbeat', wrap((req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { userId, seconds } = req.body || {};
    res.json(flashcardStudy.heartbeat({ userId, sessionId: req.params.sessionId, seconds }));
  }));
  router.get('/flashcards', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    res.json({ decks: await flashcardStudy.listDecks() });
  }));
  router.get('/flashcards/assets/*assetId', wrap((req, res) => {
    if (!schoolResourceService) throw new EntityNotFoundError('flashcard assets', 'not configured');
    const asset = schoolResourceService.getFlashcardAsset(splatPath(req, 'assetId'));
    if (!asset) throw new EntityNotFoundError('flashcard asset', splatPath(req, 'assetId'));
    res.type(asset.contentType);
    return sendFileResource(req, res, asset.resource);
  }));
  router.get('/flashcards/report', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    res.json(await flashcardStudy.report({ userId: req.query.userId }));
  }));
  router.post('/flashcards/teacher-report', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    const { learnerId, actorId, pin = null } = req.body || {};
    res.json(await flashcardStudy.teacherReport({ learnerId, actorId, pin }));
  }));
  router.get('/flashcards/:deckId/summary', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    res.json(await flashcardStudy.summary({ userId: req.query.userId, deckId: req.params.deckId }));
  }));
  router.get('/flashcards/:deckId', wrap(async (req, res) => {
    if (!flashcardStudy) throw new EntityNotFoundError('flashcard study', 'not configured');
    res.json({ deck: await flashcardStudy.getDeck(req.params.deckId) });
  }));
  router.post('/sessions/:sessionId/remediation-offer', wrap(async (req, res) => {
    if (!offerCatalogQuizRemediation) {
      throw new EntityNotFoundError('adaptive remediation offer', 'not configured');
    }
    const learnerId = req.body?.learnerId;
    const result = await offerCatalogQuizRemediation.execute({
      sessionId: req.params.sessionId,
      learnerId,
    });
    return res.status(result.status === 'offered' ? 201 : 200).json(result);
  }));
  router.get('/users/:userId/results', wrap((req, res) => {
    res.json(schoolService.getResults(req.params.userId, { bankId: req.query.bankId }));
  }));

  // Quiz requests — the on-demand authoring backlog. POST records a child's
  // interest in a quiz for a bankless unit; GET lists the backlog (optionally
  // per material) for the requested-state UI and for whoever authors banks.
  router.post('/quiz-requests', wrap((req, res) => {
    const { userId = null, unitId, materialId, unitTitle = null, materialTitle = null } = req.body || {};
    res.json(schoolService.requestQuiz({ userId, unitId, materialId, unitTitle, materialTitle }));
  }));
  router.get('/quiz-requests', wrap(async (req, res) => {
    // Warm first so the `fulfilled` annotation answers from a real bank scan.
    res.json(await schoolApiSessions.listQuizRequests({ materialId: req.query.materialId || null }));
  }));
  router.post('/quiz-requests/dismiss', wrap(async (req, res) => {
    const { unitId = null, bankId = null, kind = null, sessionId = null, userId, dismissedBy = null, pin = null, reason } = req.body || {};
    res.json(await schoolService.dismissQuizRequest({ unitId, bankId, kind, sessionId, userId, dismissedBy, pin, reason }));
  }));
  // Kid-safe like /quiz-requests: a child asks for another go; the row lands
  // on the teacher's backlog (student-advocacy A2).
  router.post('/retake-requests', wrap((req, res) => {
    const { userId = null, bankId = null, unitId = null, title = null } = req.body || {};
    res.json(schoolService.requestRetake({ userId, bankId, unitId, title }));
  }));
  // Kid-safe "this seems wrong" flag — lands in the same teacher backlog.
  router.post('/flags', wrap((req, res) => {
    const { userId = null, bankId = null, sessionId = null, title = null, note = null } = req.body || {};
    res.json(schoolService.flagConcern({ userId, bankId, sessionId, title, note }));
  }));

  // Printing — a child prints their own worksheets, quota-gated with grown-up
  // approval over the limit. A missing printService (no printer/printables
  // configured) serves empty/inert rather than 500ing the whole app.
  // NOTE: the fixed GET routes (/print/printables, /print/quota,
  // /print/pending) are registered ABOVE the /print/*id splat, earlier in
  // this file — registration order is what keeps the splat from shadowing
  // them (school.print.routes.test.mjs pins both directions).
  router.post('/print/request', wrap(async (req, res) => {
    if (!printService) throw new EntityNotFoundError('printing', 'not configured');
    const { userId = null, printableId, copies = 1 } = req.body || {};
    res.json(await printService.requestPrint({ userId, printableId, copies }));
  }));
  router.post('/print/:requestId/approve', wrap(async (req, res) => {
    if (!printService) throw new EntityNotFoundError('printing', 'not configured');
    res.json(await printService.approve({ requestId: req.params.requestId, approver: req.body?.approver, pin: req.body?.pin ?? null }));
  }));
  router.post('/print/:requestId/deny', wrap(async (req, res) => {
    if (!printService) throw new EntityNotFoundError('printing', 'not configured');
    res.json(await printService.deny({ requestId: req.params.requestId, approver: req.body?.approver, pin: req.body?.pin ?? null }));
  }));

  // Materials framework (catalog + per-unit progress/quiz gates). The panel
  // must never 500 before materials.yml config ships — a missing config block
  // (getMaterialCatalog not wired) serves an empty catalog and logs once,
  // not per request.
  // Aggregate program report — every program x every learner in one shape.
  // Omit userId for the household board; pass it for one learner's own view.
  router.get('/report', wrap(async (req, res) => {
    if (!getSchoolReport) return res.json({ learners: [] });
    res.json(await getSchoolReport.execute({
      userId: req.query.userId || null,
      audience: req.query.audience === 'learner' ? 'learner' : 'parent',
    }));
  }));

  // Generic, evidence-backed progress: one endpoint for the School web app,
  // SchoolCalc projections, and future surfaces. Membership and academic
  // period names are resolved in the application; HTTP only parses fields.
  router.get('/progress/options', wrap(async (req, res) => {
    if (!getLearningProgress) return res.json({ learners: [], scopes: [], periods: [] });
    res.set('Cache-Control', 'no-store').json(await getLearningProgress.options());
  }));
  router.get('/progress', wrap(async (req, res) => {
    if (!getLearningProgress) return res.json(null);
    const learnerId = textQuery(req.query.learnerId);
    const scopeType = learnerId ? 'learner' : textQuery(req.query.scopeType) ?? 'household';
    const scopeId = learnerId ?? textQuery(req.query.scopeId) ?? 'household';
    const result = await getLearningProgress.execute({
      scopeType,
      scopeId,
      periodId: textQuery(req.query.periodId),
      from: textQuery(req.query.from),
      to: textQuery(req.query.to),
      filters: {
        subjectIds: csvQuery(req.query.subject),
        areaIds: csvQuery(req.query.area),
        courseIds: csvQuery(req.query.course),
        unitIds: csvQuery(req.query.unit),
        lessonIds: csvQuery(req.query.lesson),
        moduleIds: csvQuery(req.query.module),
        conceptIds: csvQuery(req.query.concept),
        activityKinds: csvQuery(req.query.activityKind),
        surfaceIds: csvQuery(req.query.surface),
        includeClassifications: csvQuery(req.query.classification),
        excludeClassifications: csvQuery(req.query.excludeClassification),
        includeTags: csvQuery(req.query.tag),
        excludeTags: csvQuery(req.query.excludeTag),
        verifications: csvQuery(req.query.verification),
      },
      groupBy: csvQuery(req.query.groupBy),
      recentLimit: boundedIntegerQuery(req.query.recentLimit, 10, 0, 100, 'recentLimit'),
      followUpContext: { surface: 'web' },
    });
    res.set('Cache-Control', 'no-store').json(result);
  }));

  // Adult-facing content and pacing signals. The application resolves cohort
  // membership; this projection never exposes rankings or ability labels.
  router.get('/progress/insights', wrap(async (req, res) => {
    if (!getInstructionalInsights) return res.json(null);
    const result = await getInstructionalInsights.execute({
      scopeType: textQuery(req.query.scopeType) ?? 'household',
      scopeId: textQuery(req.query.scopeId) ?? 'household',
      from: textQuery(req.query.from),
      to: textQuery(req.query.to),
    });
    return res.set('Cache-Control', 'no-store').json(result);
  }));

  // Optional metacognitive observation. Source identity is owned by this HTTP
  // adapter rather than accepted from a caller-supplied evidence envelope.
  router.post('/progress/reflections', wrap(async (req, res) => {
    if (!recordLearningReflection) throw new EntityNotFoundError('learning reflection', 'not configured');
    const { observationId, learnerId, activity, learning, selfRegulation } = req.body || {};
    const result = await recordLearningReflection.execute({
      observationId, learnerId, activity, learning, selfRegulation,
      source: { surface: 'web', transport: 'screen' },
    });
    return res.status(result.status === 'recorded' ? 201 : 200).json(result);
  }));

  // Feedback acknowledgement and the learner's next move remain distinct
  // from scored responses. Client observationId makes a network retry an
  // exact idempotent replay in the append-only evidence repository.
  router.post('/learning-probes/interactions', wrap(async (req, res) => {
    if (!recordLearningProbeInteraction) {
      throw new EntityNotFoundError('learning probe interaction', 'not configured');
    }
    const {
      observationId, learnerId, event, activity, learning,
      attemptNumber, continuation = null,
    } = req.body || {};
    const result = await recordLearningProbeInteraction.execute({
      observationId, learnerId, event, activity, learning,
      attemptNumber, continuation,
      source: { surface: 'web', transport: 'screen' },
    });
    return res.status(result.status === 'recorded' ? 201 : 200).json(result);
  }));

  // The adaptive learning loop is shared School behavior. Web identifies its
  // learner access scope here; calculator endpoints translate device access in
  // their own outer adapter while calling the same application service.
  router.get('/remediation', wrap(async (req, res) => {
    if (!remediationTutor) return res.json({ sessions: [] });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    return res.set('Cache-Control', 'no-store').json({
      sessions: await remediationTutor.listAvailable({ surface: 'web', learnerId }),
    });
  }));

  router.get('/remediation/:sessionId', wrap(async (req, res) => {
    if (!remediationTutor) throw new EntityNotFoundError('adaptive remediation', 'not configured');
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const session = await remediationTutor.get({
      sessionId: req.params.sessionId,
      access: { surface: 'web', learnerId },
      afterServerSequence: boundedIntegerQuery(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER, 'after'),
      maxTurns: boundedIntegerQuery(req.query.limit, 20, 1, 50, 'limit'),
    });
    return res.set('Cache-Control', 'no-store').json({ session });
  }));

  router.post('/remediation/:sessionId/actions', wrap(async (req, res) => {
    if (!remediationTutor) throw new EntityNotFoundError('adaptive remediation', 'not configured');
    const {
      learnerId, clientSequence, lastServerSequence, action,
      turnId = null, choiceId = null,
    } = req.body || {};
    const outcome = await remediationTutor.act({
      sessionId: req.params.sessionId,
      access: { surface: 'web', learnerId },
      clientSequence, lastServerSequence, action, turnId, choiceId,
    });
    return res.set('Cache-Control', 'no-store')
      .status(outcome.status === 'processing' ? 202 : 200).json(outcome);
  }));

  router.get('/materials', wrap(async (req, res) => {
    if (!getMaterialCatalog) {
      if (!warnedMaterialsConfigMissing) {
        warnedMaterialsConfigMissing = true;
        logger.warn?.('school.materials.config-missing');
      }
      return res.json({ sections: [], materials: [] });
    }
    res.json(await getMaterialCatalog.execute());
  }));

  // A collection's works (albums), for the collection browser. Empty for a
  // non-collection material, so the frontend can call it unconditionally.
  router.get('/materials/:materialId/works', wrap(async (req, res) => {
    if (!getMaterialCatalog?.listWorks) return res.json([]);
    res.json(await getMaterialCatalog.listWorks(req.params.materialId));
  }));

  router.get('/materials/:materialId/units', wrap(async (req, res) => {
    if (!getMaterialUnits) throw new EntityNotFoundError('material', req.params.materialId);
    const userId = req.query.userId || undefined;
    res.json(await getMaterialUnits.execute({ materialId: req.params.materialId, userId }));
  }));

  // Continue-rail data: the signed-in user's in-progress materials (newest
  // first). Not wired (no materials config) → empty rail, never an error.
  router.get('/users/:userId/material-progress', wrap(async (req, res) => {
    if (!getMaterialProgressSummary) return res.json([]);
    const subject = req.query.subject || undefined;
    res.json(await getMaterialProgressSummary.execute({ userId: req.params.userId, subject }));
  }));

  router.put('/materials/:materialId/units/:unitId/progress', wrap((req, res) => {
    const { userId, percent, playhead, durationMs } = req.body || {};
    const result = schoolResourceService?.recordMaterialProgress?.({
      userId, unitId: req.params.unitId, percent, playhead, durationMs,
    }) ?? { recorded: false };
    return res.json(result.recorded ? { ok: true } : { ok: true, recorded: false });
  }));

  // --- report cards, period close, teacher digest (Task 6, spec R5b) --------
  // LEAN by design: this feeds Task 7's PDF and Task 9's parent panel. It must
  // never grow dashboard extras of its own — those belong on `/progress`.
  router.get('/report-card', wrap(async (req, res) => {
    if (!getReportCard) return res.json(null);
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = requiredTextQuery(req.query.periodId, 'periodId');
    const report = await getReportCard.execute({ learnerId, periodId });
    if (wantsPdf(req)) return sendReportCardPdf(res, schoolReportDocuments, report, { learnerId, periodId, req });
    return res.set('Cache-Control', 'no-store').json(report);
  }));

  router.get('/report-card/frozen', wrap(async (req, res) => {
    if (!schoolReportDocuments?.hasFrozenReports?.()) return res.json(null);
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = textQuery(req.query.periodId);
    if (periodId) {
      const record = schoolReportDocuments.readFrozen(learnerId, periodId);
      if (!record) throw new EntityNotFoundError('Frozen report card', `${learnerId}/${periodId}`);
      if (wantsPdf(req)) return sendReportCardPdf(res, schoolReportDocuments, record, { learnerId, periodId, req });
      return res.set('Cache-Control', 'no-store').json(record);
    }
    // The list variety returns every frozen record for the learner — `format=pdf`
    // names exactly one document, so it does not apply here; served as JSON
    // regardless of the query param.
    const records = schoolReportDocuments.listFrozen(learnerId);
    return res.set('Cache-Control', 'no-store').json(records ?? []);
  }));

  router.post('/report-card/close', wrap(async (req, res) => {
    if (!closeAcademicPeriod) throw new EntityNotFoundError('report card close', 'not configured');
    const body = req.body || {};
    // Same required-text validation the GET route above uses — a missing
    // field is a 400 from THIS boundary, never a 500 surfaced from a use-case
    // guard several layers down.
    const learnerId = requiredTextQuery(body.learnerId, 'learnerId');
    const periodId = requiredTextQuery(body.periodId, 'periodId');
    const closedBy = requiredTextQuery(body.closedBy, 'closedBy');
    const frozen = await closeAcademicPeriod.execute({
      learnerId, periodId, closedBy, supersede: body.supersede === true, pin: body.pin ?? null,
    });
    return res.status(201).json(frozen);
  }));

  // --- wave-6 advocacy -------------------------------------------------------
  router.post('/retract', wrap(async (req, res) => {
    if (!retractTeacherRecord) throw new EntityNotFoundError('retraction', 'not configured');
    const { kind, entryId, retractedBy = null, pin = null } = req.body || {};
    res.json(await retractTeacherRecord.execute({ kind, entryId, retractedBy, pin }));
  }));
  router.get('/transcript', wrap(async (req, res) => {
    if (!getTranscript) return res.json(null);
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const transcript = await getTranscript.execute({ learnerId });
    if (wantsPdf(req)) {
      const rendered = await schoolReportDocuments?.transcriptPdf?.(transcript, learnerId);
      if (!rendered) return res.status(503).json({ error: 'transcript-render-unavailable' });
      const { pdf } = rendered;
      return res
        .set('Content-Type', 'application/pdf')
        .set('Content-Disposition', `inline; filename="transcript-${slugify(learnerId)}.pdf"`)
        .send(pdf);
    }
    return res.set('Cache-Control', 'no-store').json(transcript);
  }));
  router.get('/syllabus', wrap(async (req, res) => {
    if (!schoolReportDocuments?.canRenderSyllabus?.()) return res.status(503).json({ error: 'syllabus-render-unavailable' });
    const courseId = requiredTextQuery(req.query.courseId, 'courseId');
    const rendered = await schoolReportDocuments?.syllabusPdf?.(courseId) ?? { kind: 'unconfigured' };
    if (rendered.kind === 'unconfigured') return res.status(503).json({ error: 'syllabus-render-unavailable' });
    if (rendered.kind === 'not_found') throw new EntityNotFoundError('course', courseId);
    const { pdf } = rendered;
    return res
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `inline; filename="syllabus-${slugify(courseId)}.pdf"`)
      .send(pdf);
  }));
  router.get('/attempt-days', wrap((req, res) => {
    if (!schoolRecordsQuery?.hasAttempts?.()) return res.json({ days: [] });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    res.json({ days: schoolRecordsQuery?.attemptDays?.(learnerId) ?? [] });
  }));

  // --- wave-5 repair ---------------------------------------------------------
  router.get('/attestations', wrap((req, res) => {
    res.json({ entries: schoolRecordsQuery?.attestations?.({
      learnerId: textQuery(req.query.learnerId),
      // ?includeRetracted=1 (admin advocacy #13): withdrawn records visible,
      // annotated with retractedBy/retractedAt, instead of folded out.
      includeRetracted: req.query.includeRetracted === '1',
    }) ?? [] });
  }));
  router.post('/attestations', wrap(async (req, res) => {
    if (!recordAttestation) throw new EntityNotFoundError('attestations', 'not configured');
    const { learnerId, unitId, reason, attestedBy = null, pin = null } = req.body || {};
    res.status(201).json(await recordAttestation.execute({ learnerId, unitId, reason, attestedBy, pin }));
  }));

  // Study-day program excusals: a grown-up letting one learner off one day's
  // program obligation (today, the piano lesson). Attestation-weight — day
  // scoped, reversible, fully attributed — so no step-up grant, just the
  // teacherGate assert the use case already makes.
  router.get('/program-day-bypasses', wrap(async (req, res) => {
    if (!manageProgramDayBypass) throw new EntityNotFoundError('program day bypasses', 'not configured');
    res.set('Cache-Control', 'no-store')
      .json(await manageProgramDayBypass.list({ learnerId: textQuery(req.query.learnerId) }));
  }));
  router.post('/program-day-bypasses', wrap(async (req, res) => {
    if (!manageProgramDayBypass) throw new EntityNotFoundError('program day bypasses', 'not configured');
    const { learnerId, programId = 'piano-course', reason, decidedBy = null, pin = null } = req.body || {};
    res.status(201).json(await manageProgramDayBypass.grant({ learnerId, programId, reason, decidedBy, pin }));
  }));
  router.post('/program-day-bypasses/:bypassId/retract', wrap(async (req, res) => {
    if (!manageProgramDayBypass) throw new EntityNotFoundError('program day bypasses', 'not configured');
    const { reason, retractedBy = null, pin = null } = req.body || {};
    res.json(await manageProgramDayBypass.retract({
      bypassId: req.params.bypassId, reason, retractedBy, pin,
    }));
  }));
  router.get('/teacher-notes', wrap((req, res) => {
    res.json({ entries: schoolRecordsQuery?.teacherNotes?.({
      learnerId: textQuery(req.query.learnerId),
      // ?includeRetracted=1 (admin advocacy #13): withdrawn records visible,
      // annotated with retractedBy/retractedAt, instead of folded out.
      includeRetracted: req.query.includeRetracted === '1',
    }) ?? [] });
  }));
  router.post('/teacher-notes', wrap(async (req, res) => {
    if (!recordTeacherNote) throw new EntityNotFoundError('teacher notes', 'not configured');
    const { learnerId, note, from = null, pin = null } = req.body || {};
    res.status(201).json(await recordTeacherNote.execute({ learnerId, note, from, pin }));
  }));
  // A day's attempts grouped by assessment — the reassignment picker's read.
  router.get('/attempts-summary', wrap((req, res) => {
    if (!schoolRecordsQuery?.hasAttempts?.()) return res.json({ assessments: [] });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const day = requiredTextQuery(req.query.day, 'day');
    res.json({ assessments: schoolRecordsQuery?.attemptSummary?.(learnerId, day) ?? [] });
  }));
  router.post('/reassign', wrap(async (req, res) => {
    if (!reassignEvidence) throw new EntityNotFoundError('reassignment', 'not configured');
    const { fromLearnerId, toLearnerId, day, assessmentId, reassignedBy = null, pin = null } = req.body || {};
    res.json(await reassignEvidence.execute({ fromLearnerId, toLearnerId, day, assessmentId, reassignedBy, pin }));
  }));
  // Re-credit a whole work session. The route above moves attempt EVENTS and
  // can only reach work a machine recorded answers for; this appends one
  // `reassigned` event and reaches everything else. `fromLearnerId` is not
  // taken from the caller — the use case reads it off the session's own log,
  // so a stale panel cannot assert who the work currently belongs to.
  router.post('/reassign-session', wrap(async (req, res) => {
    if (!reassignSession) throw new EntityNotFoundError('session reassignment', 'not configured');
    const { sessionId, toLearnerId, reason, reassignedBy = null, pin = null } = req.body || {};
    res.json(await reassignSession.execute({ sessionId, toLearnerId, reason, reassignedBy, pin }));
  }));

  // --- wave-4 records --------------------------------------------------------
  router.get('/progress-report', wrap(async (req, res) => {
    if (!getProgressReport) return res.json(null);
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = requiredTextQuery(req.query.periodId, 'periodId');
    const report = await getProgressReport.execute({ learnerId, periodId });
    if (wantsPdf(req)) {
      const rendered = await schoolReportDocuments?.progressReportPdf?.(report);
      if (!rendered) return res.status(503).json({ error: 'progress-report-render-unavailable' });
      const { pdf } = rendered;
      return res
        .set('Content-Type', 'application/pdf')
        .set('Content-Disposition', `inline; filename="progress-report-${slugify(learnerId)}-${slugify(periodId)}.pdf"`)
        .send(pdf);
    }
    return res.set('Cache-Control', 'no-store').json(report);
  }));
  router.get('/certificate', wrap(async (req, res) => {
    if (!schoolReportDocuments?.canRenderCertificate?.()) return res.status(503).json({ error: 'certificate-render-unavailable' });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = requiredTextQuery(req.query.periodId, 'periodId');
    const courseId = requiredTextQuery(req.query.courseId, 'courseId');
    const rendered = await schoolReportDocuments?.certificatePdf?.({
      learnerId, periodId, courseId, issuedBy: textQuery(req.query.issuedBy) ?? null,
    });
    if (!rendered || rendered.kind === 'unconfigured') return res.status(503).json({ error: 'certificate-render-unavailable' });
    if (rendered.kind === 'not_found') throw new EntityNotFoundError('completed course', `${learnerId}/${courseId}`);
    const { pdf } = rendered;
    return res
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `inline; filename="certificate-${slugify(learnerId)}-${slugify(courseId)}.pdf"`)
      .send(pdf);
  }));

  // --- wave-3 planning domains ---------------------------------------------
  router.put('/periods', wrap(async (req, res) => {
    if (!setAcademicPeriods) throw new EntityNotFoundError('periods editing', 'not configured');
    const { periods, editedBy = null, pin = null, baseHistoryLength } = req.body || {};
    res.json(await setAcademicPeriods.execute({ periods, editedBy, pin, baseHistoryLength }));
  }));
  router.get('/periods-meta', wrap((req, res) => {
    res.json({ historyLength: schoolRecordsQuery?.periodHistoryLength?.() ?? 0 });
  }));
  router.get('/pass-overrides', wrap((req, res) => {
    res.json({ overrides: schoolRecordsQuery?.passOverrides?.() ?? {} });
  }));
  router.put('/pass-overrides/:unitId', wrap(async (req, res) => {
    if (!setPassOverride) throw new EntityNotFoundError('pass overrides', 'not configured');
    const { percent = null, editedBy = null, pin = null } = req.body || {};
    res.json(await setPassOverride.execute({ unitId: req.params.unitId, percent, editedBy, pin }));
  }));
  router.get('/milestones', wrap(async (req, res) => {
    if (!milestoneStatuses) return res.json({ milestones: [] });
    res.json(await milestoneStatuses.execute({ learnerId: requiredTextQuery(req.query.learnerId, 'learnerId') }));
  }));
  router.put('/milestones', wrap(async (req, res) => {
    if (!setMilestones) throw new EntityNotFoundError('milestones', 'not configured');
    const { learnerId, milestones, editedBy = null, pin = null, baseHistoryLength } = req.body || {};
    res.json(await setMilestones.execute({ learnerId, milestones, editedBy, pin, baseHistoryLength }));
  }));
  router.get('/enrichment', wrap((req, res) => {
    res.json({ entries: schoolRecordsQuery?.enrichment?.({
      learnerId: textQuery(req.query.learnerId),
      // ?includeRetracted=1 (admin advocacy #13): withdrawn records visible,
      // annotated with retractedBy/retractedAt, instead of folded out.
      includeRetracted: req.query.includeRetracted === '1',
    }) ?? [] });
  }));
  router.post('/enrichment', wrap(async (req, res) => {
    if (!recordEnrichment) throw new EntityNotFoundError('enrichment log', 'not configured');
    const { recordedBy = null, pin = null, learnerIds = [], from, to = null, title, subjectIds = [], note = null } = req.body || {};
    res.status(201).json(await recordEnrichment.execute({ recordedBy, pin, learnerIds, from, to, title, subjectIds, note }));
  }));

  router.get('/teacher/today', wrap(async (req, res) => {
    if (!getTeacherToday) return res.json([]);
    res.set('Cache-Control', 'no-store').json(presentPublicResources(await getTeacherToday.execute()));
  }));
  router.get('/teacher/day', wrap(async (req, res) => {
    if (!getTeacherToday) throw new EntityNotFoundError('teacher day', 'not configured');
    res.set('Cache-Control', 'no-store').json(presentPublicResources(await getTeacherToday.execute({
      studyDay: req.query.studyDay == null ? null : requiredTextQuery(req.query.studyDay, 'studyDay'), version: 'v2',
    })));
  }));
  // A course with no published cover 404s. Every consumer here draws through
  // `SafeImg fallback=""`, so the absence renders as nothing — which is the
  // truth. It must never be papered over with generated artwork: the same
  // substitute used to reach the learner panel and be read as the real thing.
  router.get('/teacher/curriculum/:courseId/poster.jpg', wrap(async (req, res) => {
    const bytes = await schoolCurriculumQuery?.getCoursePoster?.(req.params.courseId);
    if (!bytes) throw new EntityNotFoundError('course poster', req.params.courseId);
    res.set('Cache-Control', 'private, max-age=3600').set('Content-Type', 'image/jpeg')
      .set('X-Content-Type-Options', 'nosniff').send(bytes);
  }));
  router.get('/teacher/curriculum-exceptions', wrap(async (req, res) => {
    if (!manageCurriculumException) throw new EntityNotFoundError('curriculum exceptions', 'not configured');
    res.set('Cache-Control', 'no-store').json(await manageCurriculumException.list());
  }));
  router.get('/teacher/answer-sheets/:cardId', wrap(async (req, res) => {
    if (!schoolPrintAccess) throw new EntityNotFoundError('answer sheet', 'not configured');
    const card = await schoolPrintAccess.describeCard(req.params.cardId);
    if (!card) throw new EntityNotFoundError('answer sheet', 'not configured');
    if (!card.allocations.length) throw new EntityNotFoundError('answer sheet', req.params.cardId);
    res.set('Cache-Control', 'no-store').json(card);
  }));
  router.get('/teacher/learners/:learnerId/answer-sheets', wrap(async (req, res) => {
    const cards = await schoolPrintAccess?.listLearnerCards?.(req.params.learnerId);
    if (!cards) throw new EntityNotFoundError('learner answer sheets', 'not configured');
    res.set('Cache-Control', 'no-store').json({ schema: 'school.answer-sheets/v1',
      learnerId: req.params.learnerId, cards });
  }));
  router.post('/teacher/curriculum-exceptions', wrap(async (req, res) => {
    if (!manageCurriculumException) throw new EntityNotFoundError('curriculum exceptions', 'not configured');
    const result = await manageCurriculumException.execute(req.body || {});
    res.status(req.body?.apply === true ? 201 : 200).json(result);
  }));
  router.post('/teacher/curriculum-exceptions/:exceptionId/retract', wrap(async (req, res) => {
    if (!manageCurriculumException) throw new EntityNotFoundError('curriculum exceptions', 'not configured');
    res.json(await manageCurriculumException.retract({ ...req.body, exceptionId: req.params.exceptionId }));
  }));
  router.get('/teacher/curriculum/:courseId', wrap(async (req, res) => {
    const result = await schoolCurriculumQuery?.getCourse?.(req.params.courseId) ?? { kind: 'unconfigured' };
    if (result.kind === 'unconfigured') throw new EntityNotFoundError('teacher curriculum', 'not configured');
    if (result.kind === 'not_found') throw new EntityNotFoundError('course', req.params.courseId);
    const { course, units } = result;
    res.set('Cache-Control', 'no-store').json({ schema: 'school.teacher-course/v1',
      course: { ...course, courseId: course.work, posterUrl: `/api/v1/school/teacher/curriculum/${encodeURIComponent(course.work)}/poster.jpg` },
      units,
    });
  }));
  router.get('/teacher/curriculum/:courseId/lessons/:lessonId', wrap(async (req, res) => {
    const unit = await schoolCurriculumQuery?.getLesson?.(req.params.courseId, req.params.lessonId);
    if (!unit) throw new EntityNotFoundError('course lesson', req.params.lessonId);
    res.set('Cache-Control', 'no-store').json({ schema: 'school.teacher-lesson/v1',
      ...unit, lessonId: unit.unitId,
      posterUrl: `/api/v1/school/teacher/curriculum/${encodeURIComponent(req.params.courseId)}/poster.jpg`,
    });
  }));
  router.get('/teacher/curriculum/:courseId/lessons/:lessonId/preview.pdf', wrap(async (req, res) => {
    if (!previewTeacherLessonMaterial) throw new EntityNotFoundError('teacher lesson preview', 'not configured');
    const preview = await previewTeacherLessonMaterial.execute({
      courseId: req.params.courseId,
      lessonId: req.params.lessonId,
      answerKey: req.query.answerKey === '1',
    });
    // Deliberately transient: never a session artifact, never printer output.
    res.set('Cache-Control', 'private, no-store')
      .set('X-School-Preview', 'teacher-non-recording')
      .set('Content-Disposition', `inline; filename="preview-${slugify(preview.title)}.pdf"`)
      .type('application/pdf').send(Buffer.from(preview.bytes));
  }));
  router.get('/teacher/learners/:learnerId/courses/:courseId', wrap(async (req, res) => {
    const result = await schoolCurriculumQuery?.getLearnerCourse?.(req.params.learnerId, req.params.courseId)
      ?? { kind: 'unconfigured' };
    if (result.kind === 'unconfigured') throw new EntityNotFoundError('learner course progress', 'not configured');
    if (result.kind === 'not_found') throw new EntityNotFoundError('course', req.params.courseId);
    const progress = result.units;
    res.set('Cache-Control', 'no-store').json({ schema: 'school.teacher-learner-course/v1',
      learnerId: req.params.learnerId, courseId: req.params.courseId,
      completed: result.completed,
      total: progress.length, units: progress,
      posterUrl: `/api/v1/school/teacher/curriculum/${encodeURIComponent(req.params.courseId)}/poster.jpg`,
    });
  }));

  // V2 teacher workspace read models. These are intentionally additive to the
  // older lifecycle routes so rollout/cutback never changes student behavior.
  router.get('/teacher/learners/:learnerId/timeline', wrap(async (req, res) => {
    if (!getLearnerTimeline) throw new EntityNotFoundError('teacher timeline', 'not configured');
    res.set('Cache-Control', 'no-store').json(presentPublicResources(await getLearnerTimeline.execute({
      learnerId: req.params.learnerId,
      limit: req.query.limit,
      before: textQuery(req.query.before),
      unitId: textQuery(req.query.unitId),
    })));
  }));
  // Opened directly by window.open so the popup is created during the click
  // gesture. This signs a five-minute read-only scope and redirects to the
  // existing School launch-card preview; no session or learner action exists.
  router.get('/teacher/learners/:learnerId/launch-preview', wrap((req, res) => {
    if (!launchPreviewTokens) throw new EntityNotFoundError('launch preview', 'not configured');
    const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    if (!subject) throw new ValidationError('subject is required');
    const token = launchPreviewTokens.issue({
      learnerId: req.params.learnerId,
      subject,
      continueToday: req.query.continueToday === '1' || req.query.continueToday === 'true',
    });
    res.set('Cache-Control', 'no-store').redirect(302, `/school?preview=${encodeURIComponent(token)}`);
  }));
  router.post('/teacher/learners/:learnerId/agenda/dispatch/preview', wrap(async (req, res) => {
    if (!teacherAgendaDispatch) throw new EntityNotFoundError('teacher agenda dispatch', 'not configured');
    res.set('Cache-Control', 'no-store').json(presentPublicResources(await teacherAgendaDispatch.preview({
      learnerId: req.params.learnerId, learnerName: req.body?.learnerName ?? null,
    })));
  }));
  router.post('/teacher/learners/:learnerId/agenda/dispatch', wrap(async (req, res) => {
    if (!teacherAgendaDispatch) throw new EntityNotFoundError('teacher agenda dispatch', 'not configured');
    const body = req.body || {};
    res.status(201).json(presentPublicResources(await teacherAgendaDispatch.execute({
      learnerId: req.params.learnerId, learnerName: body.learnerName ?? null,
      dispatchedBy: body.dispatchedBy ?? null, pin: body.pin ?? null,
      idempotencyKey: req.get('Idempotency-Key') ?? body.idempotencyKey,
    })));
  }));
  router.get('/teacher/sessions/:sessionId', wrap(async (req, res) => {
    if (!getTeacherSession) throw new EntityNotFoundError('teacher session inspector', 'not configured');
    res.set('Cache-Control', 'no-store').json(presentPublicResources(await getTeacherSession.execute({ sessionId: req.params.sessionId })));
  }));
  /**
   * The finish code, read out to a grown-up when the media will not play.
   *
   * A POST, for two reasons that are not stylistic. The capability cookie only
   * becomes a `pin` on a body-carrying request (see the middleware above), so a
   * GET would authorize by nothing at all; and revealing WRITES — the use case
   * records the reveal, which is what makes a sheet that passed against an
   * unsatisfied companion explicable later. `no-store` on top: these letters
   * must not sit in a shared browser cache on a household screen.
   *
   * The gate is asserted INSIDE the use case, before it reads anything, so a
   * refusal cannot even reveal whether a code exists. This is also the ONLY
   * route in the system that serves the letters — nothing child-facing widens
   * to carry them, exactly as `IssueDocument.execute()` keeps `finishCode` off
   * the value that travels to `ResolveScanAction`.
   */
  router.post('/teacher/sessions/:sessionId/companion-finish-code', wrap(async (req, res) => {
    if (!getCompanionFinishCode) throw new EntityNotFoundError('companion finish code', 'not configured');
    const body = req.body || {};
    res.set('Cache-Control', 'no-store').json(await getCompanionFinishCode.execute({
      sessionId: req.params.sessionId,
      revealedBy: body.revealedBy ?? null,
      pin: body.pin ?? null,
    }));
  }));
  router.post('/teacher/sessions/:sessionId/remediation', wrap(async (req, res) => {
    if (!openRemediation || !teacherGate) throw new EntityNotFoundError('teacher remediation', 'not configured');
    const body = req.body || {};
    teacherGate.assert({ userId: body.openedBy ?? null, pin: body.pin ?? null,
      action: 'sessions.remediation.open', context: { sessionId: req.params.sessionId } });
    res.status(201).json(await openRemediation.execute({ sessionId: req.params.sessionId, openedBy: body.openedBy ?? null }));
  }));
  router.get('/teacher/artifacts/:artifactId', wrap(async (req, res) => {
    if (!schoolArtifactService?.isConfigured?.()) throw new EntityNotFoundError('issued artifact store', 'not configured');
    const artifact = await schoolArtifactService.get(req.params.artifactId);
    if (!artifact) throw new EntityNotFoundError('issued artifact', req.params.artifactId);
    res.set('Cache-Control', 'no-store').json(artifact.manifest);
  }));
  router.get('/teacher/artifacts/:artifactId/original.pdf', wrap(async (req, res) => {
    const pdf = await schoolArtifactService?.pdf?.(req.params.artifactId) ?? { kind: 'unconfigured' };
    if (pdf.kind === 'unconfigured') throw new EntityNotFoundError('issued artifact store', 'not configured');
    if (pdf.kind === 'not_found') throw new EntityNotFoundError('issued artifact', req.params.artifactId);
    if (pdf.kind === 'wrong_media_type') throw new ValidationError('artifact is not a PDF');
    if (!Buffer.isBuffer(pdf.bytes)) throw new ValidationError('artifact PDF cannot be regenerated');
    res.set('Cache-Control', 'private, no-store')
      .set('X-School-Artifact', pdf.kind === 'rendered' ? 'current-render' : 'legacy-retained')
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `inline; filename="issued-${slugify(req.params.artifactId)}.pdf"`)
      .send(pdf.bytes);
  }));
  // A thumbnail is the first page of the same current-engine projection the
  // PDF route serves; neither representation is durable artifact state.
  router.get('/teacher/artifacts/:artifactId/thumbnail.png', wrap(async (req, res) => {
    const result = await schoolArtifactService?.thumbnail?.(req.params.artifactId) ?? { kind: 'unconfigured' };
    if (result.kind === 'unconfigured') throw new EntityNotFoundError('artifact thumbnail', 'not configured');
    if (result.kind === 'not_found') throw new EntityNotFoundError('issued artifact', req.params.artifactId);
    if (result.kind === 'wrong_media_type') throw new ValidationError('artifact is not a PDF');
    if (result.kind === 'unrenderable') return res.status(404).json({ error: 'thumbnail-unrenderable' });
    res.set('Cache-Control', 'private, no-store')
      .set('X-School-Artifact', 'current-render-thumbnail')
      .type('image/png').send(result.bytes);
  }));
  router.get('/teacher/artifacts/:artifactId/original', wrap(async (req, res) => {
    if (!schoolArtifactService?.isConfigured?.()) throw new EntityNotFoundError('issued artifact store', 'not configured');
    const artifact = await schoolArtifactService.get(req.params.artifactId);
    if (!artifact) throw new EntityNotFoundError('issued artifact', req.params.artifactId);
    const representation = artifact.manifest.representation ?? { mediaType: 'application/pdf', extension: 'pdf' };
    const original = representation.mediaType === 'application/pdf'
      ? await schoolArtifactService.pdf(req.params.artifactId)
      : { kind: 'retained', bytes: artifact.bytes };
    if (!Buffer.isBuffer(original.bytes)) throw new ValidationError('artifact representation is unavailable');
    res.set('Cache-Control', 'private, no-store')
      .set('Content-Type', representation.mediaType)
      .set('Content-Disposition', `inline; filename="issued-${slugify(req.params.artifactId)}.${representation.extension}"`)
      .send(original.bytes);
  }));
  router.post('/teacher/artifacts/:artifactId/reprint', wrap(async (req, res) => {
    const body = req.body || {};
    const result = await schoolArtifactService?.reprint?.({ artifactId: req.params.artifactId,
      reprintedBy: body.reprintedBy, pin: body.pin,
      idempotencyKey: req.get('Idempotency-Key') ?? body.idempotencyKey, apply: body.apply === true });
    if (!result || result.kind === 'store_unconfigured') throw new EntityNotFoundError('issued artifact store', 'not configured');
    if (result.kind === 'not_found') throw new EntityNotFoundError('issued artifact', req.params.artifactId);
    if (result.kind === 'reprint_unconfigured') throw new EntityNotFoundError('artifact reprint', 'not configured');
    res.status(body.apply === true ? 201 : 200).json(result.receipt);
  }));
  router.get('/teacher/artifacts/:artifactId/postview.pdf', wrap(async (req, res) => {
    const proof = capabilityProof(req);
    const result = await schoolArtifactService?.postview?.(req.params.artifactId, proof) ?? { kind: 'unconfigured' };
    if (result.kind === 'unconfigured') return res.status(501).json({ error: 'artifact postview is not configured' });
    if (result.kind === 'not_found') throw new EntityNotFoundError('issued artifact', req.params.artifactId);
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'A fresh teacher confirmation is required to view this postview.' });
    }
    if (result.kind === 'wrong_media_type' || result.kind === 'unrenderable') {
      throw new ValidationError('artifact PDF cannot be regenerated');
    }
    return res.set('Cache-Control', 'private, no-store')
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `inline; filename="postview-${slugify(req.params.artifactId)}.pdf"`)
      .send(result.pdf);
  }));
  router.post('/teacher/sessions/:sessionId/grade-adjustments', wrap(async (req, res) => {
    if (!adjustSessionGrade) throw new EntityNotFoundError('grade adjustment', 'not configured');
    const body = req.body || {};
    res.status(body.apply === true ? 201 : 200).json(await adjustSessionGrade.execute({
      sessionId: req.params.sessionId,
      adjustmentId: body.adjustmentId,
      percent: body.percent,
      correctCount: body.correctCount,
      totalCount: body.totalCount,
      missedItemIds: body.missedItemIds,
      itemVerdicts: body.itemVerdicts,
      reason: body.reason,
      adjustedBy: body.adjustedBy,
      pin: body.pin,
      baseSeq: body.baseSeq,
      apply: body.apply === true,
    }));
  }));
  router.post('/teacher/sessions/:sessionId/grade-adjustments/:adjustmentId/retract', wrap(async (req, res) => {
    if (!retractSessionGradeAdjustment) throw new EntityNotFoundError('grade adjustment retraction', 'not configured');
    const body = req.body || {};
    res.json(await retractSessionGradeAdjustment.execute({
      sessionId: req.params.sessionId,
      adjustmentId: req.params.adjustmentId,
      reason: body.reason,
      retractedBy: body.retractedBy,
      pin: body.pin,
      baseSeq: body.baseSeq,
      apply: body.apply === true,
    }));
  }));
  router.post('/teacher/sessions/:sessionId/evidence-invalidations', wrap(async (req, res) => {
    if (!invalidateSessionEvidence) throw new EntityNotFoundError('evidence invalidation', 'not configured');
    const body = req.body || {};
    res.status(body.apply === true ? 201 : 200).json(await invalidateSessionEvidence.execute({
      sessionId: req.params.sessionId,
      invalidationId: body.invalidationId,
      reason: body.reason,
      invalidatedBy: body.invalidatedBy,
      pin: body.pin,
      baseSeq: body.baseSeq,
      apply: body.apply === true,
    }));
  }));

  // The configured academic calendar — a plain array, not wrapped, matching
  // `getTeacherToday`'s own "answer the whole list" posture. This is the
  // ONLY thing a child-facing surface needs to work out "the current period"
  // for itself (Task 9's student panel): `listPeriods()` carries
  // `startsAt`/`endsAt` for every period, and the client picks the one that
  // contains "now".
  router.get('/periods', wrap(async (req, res) => {
    if (!schoolRecordsQuery?.hasPeriods?.()) return res.json([]);
    res.set('Cache-Control', 'no-store').json(schoolRecordsQuery?.listPeriods?.() ?? []);
  }));

  // A learner's own RESOLVED review items, newest first — the feedback a
  // child can see (Task 9, spec R7). Never a pending item still awaiting a
  // grown-up's verdict; that queue is the parent-only `/lifecycle/review`.
  // The systematic-grading-bug story (admin advocacy #5): re-run the one
  // grading engine over recorded attempts. Dry-run unless apply:true.
  router.post('/attempts/regrade', wrap(async (req, res) => {
    if (!regradeBankAttempts) throw new EntityNotFoundError('regrade', 'not configured');
    const { bankId, fromDay, toDay, reason, regradedBy = null, pin = null, apply = false } = req.body || {};
    res.json(await regradeBankAttempts.execute({ bankId, fromDay, toDay, reason, regradedBy, pin, apply: apply === true }));
  }));

  // Superseded freeze versions (admin advocacy #5): the preserved history,
  // finally readable — supersede-close archives were write-only.
  router.get('/report-card/frozen/versions', wrap((req, res) => {
    const learnerId = textQuery(req.query.learnerId);
    const periodId = textQuery(req.query.periodId);
    if (!learnerId || !periodId) return res.status(400).json({ error: 'learnerId and periodId are required' });
    res.json({ versions: schoolReportDocuments?.listFrozenVersions?.(learnerId, periodId) ?? [] });
  }));

  // The merged who-changed-what trail (admin advocacy #9): the four
  // append-only history arrays (assignments per learner, periods,
  // pass-overrides, milestones) had no read at all — reconstructing last
  // week's changes meant YAML off the volume. Read-only, newest first.
  router.get('/audit', wrap(async (req, res) => {
    const since = textQuery(req.query.since); // ISO prefix compare; optional
    res.json({ entries: await schoolRecordsQuery?.audit?.({ since, limit: 500 }) ?? [] });
  }));

  // One child's complete communications record (admin advocacy #14).
  router.get('/learner/:learnerId/record', wrap(async (req, res) => {
    if (!getLearnerRecord) return res.json({ learnerId: req.params.learnerId, entries: [] });
    const limit = Number.parseInt(req.query.limit, 10);
    res.json(await getLearnerRecord.execute({
      learnerId: req.params.learnerId,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200,
    }));
  }));

  router.get('/review/learner/:learnerId', wrap(async (req, res) => {
    if (!schoolRecordsQuery?.hasReviewQueue?.()) return res.json([]);
    const learnerId = requiredTextQuery(req.params.learnerId, 'learnerId');
    const limit = boundedIntegerQuery(req.query.limit, 20, 1, 100, 'limit');
    res.set('Cache-Control', 'no-store').json(await schoolRecordsQuery.learnerReview(learnerId, limit));
  }));

  function textQuery(value) {
    if (value === undefined || value === null || value === '') return null;
    if (Array.isArray(value) || typeof value !== 'string') throw new ValidationError('query value must be text');
    return value;
  }

  function requiredTextQuery(value, field) {
    const text = textQuery(value);
    if (text === null) throw new ValidationError(`${field} is required`);
    return text;
  }

  function csvQuery(value) {
    const text = textQuery(value);
    if (text === null) return [];
    const values = text.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (new Set(values).size !== values.length) throw new ValidationError('query list must not contain duplicates');
    return values;
  }

  function boundedIntegerQuery(value, fallback, minimum, maximum, field) {
    const text = textQuery(value);
    if (text === null) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new ValidationError(`${field} must be an integer`);
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new ValidationError(`${field} must be from ${minimum} to ${maximum}`);
    }
    return parsed;
  }

  /** `?format=pdf` on either report-card GET; JSON stays the default either way. */
  function wantsPdf(req) {
    return textQuery(req.query.format) === 'pdf';
  }

  async function sendReportCardPdf(res, reports, report, { learnerId, periodId, req }) {
    if (!reports) return res.status(503).json({ error: 'report-card-pdf-unavailable' });
    const rendered = await reports.reportCardPdf(report, {
      learnerId, learnerName: textQuery(req.query.learnerName),
    });
    if (!rendered) return res.status(503).json({ error: 'report-card-pdf-unavailable' });
    res.set('Cache-Control', 'no-store');
    const filename = `report-card-${slugify(learnerId, 'learner')}-${slugify(periodId, 'period')}.pdf`;
    res.set('Content-Disposition', `inline; filename="${filename}"`);
    return res.type('application/pdf').send(rendered.pdf);
  }

  if (schoolCalcRouter) router.use('/calc', schoolCalcRouter);

  return router;
}

/**
 * Coerce a JSON body value into the query-string-shaped string `textQuery`/
 * `boundedIntegerQuery` expect — `POST /print/render`'s only adaptation of a
 * GET-shaped body into query-string terms. Booleans/numbers (the natural
 * JSON spellings of `freshCard: true` or `startRow: 5`) become their string
 * form; everything else (undefined/null/string/array/object) passes through
 * unchanged so the existing `textQuery` validation still rejects arrays and
 * objects exactly as it did for a malformed query value.
 */
function toParamString(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return value;
}

/** Five non-empty, slash-separated segments: catalogId/subjectId/courseId/unitId/lessonId. */
function isLessonAddress(address) {
  const segments = address.split('/');
  return segments.length === 5 && segments.every((segment) => segment.length > 0);
}

export default createSchoolRouter;
