/**
 * /api/v1/school — thin HTTP shell over SchoolService (spec §5, §8).
 * All policy lives in the service; this file only maps errors to statuses.
 */
import express from 'express';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';
// Same slug the school receipts already use to keep an untrusted id out of a
// filename/document-id — see receipts.mjs:30. Reused here (not replicated) so
// the two Content-Disposition-adjacent id-sanitizing call sites can't drift.
import { slugify } from '#domains/school/documents/receipts.mjs';

export function createSchoolRouter({
  schoolService,
  getMaterialCatalog = null,
  getMaterialUnits = null,
  getMaterialProgressSummary = null,
  materialProgressStore = null,
  getSchoolReport = null,
  getLearningProgress = null,
  getInstructionalInsights = null,
  learningCatalog = null,
  openCatalogLearningSession = null,
  recordLearningReflection = null,
  recordLearningProbeInteraction = null,
  remediationTutor = null,
  learnerDirectory = null,
  issueContinuationCode = null,
  printService = null,
  schoolCalcRouter = null,
  surfaceCertification = null,
  surfaceRegistry = null,
  getScreenConfig = null,
  renderPrintDocument = null,
  printDocumentsRepo = null,
  printAllocationStore = null,
  getPrintTeacherPin = null,
  // Report cards, period close, teacher digest (Task 6, spec R5b).
  getReportCard = null,
  closeAcademicPeriod = null,
  getTeacherToday = null,
  // Teacher console picker (teacher-console spec §4.7.1) — the config-declared
  // teacher roster, `{configured, teachers: [{id, name}]}`.
  getTeachers = null,
  // Raw frozen-record reader (`YamlSchoolDatastore`-shaped: `readReportCard`,
  // `listReportCards`) — distinct from `getReportCard` above, which derives a
  // LIVE report; this one only ever reads what `closeAcademicPeriod` already froze.
  reportCardsStore = null,
  // `(report, {learnerName}) => Promise<{pdf, pageCount, mode}>` (Task 7) — a
  // plain function, not a `{execute}` use case; called directly whenever
  // `?format=pdf` is on either report-card GET. Absent → 503 rather than a
  // silent JSON fallback, since a caller explicitly asked for a PDF.
  renderReportCardPdf = null,
  // Feedback delivery + kid-visible standing (Task 9, spec R7 / adequacy
  // SHOULD 9). `reviewQueue` is the SAME `IReviewQueue` `getReportCard`'s
  // pending-count already reads (`stores.reviewQueue`); `academicPeriods`
  // the SAME `IAcademicPeriodSource` `getReportCard` resolves periods
  // through — both reused, not re-instantiated, so this router never
  // disagrees with the report card about what "the current period" means.
  reviewQueue = null,
  academicPeriods = null,
  // Wave-3 planning domains (teacher-console W3-1..W3-4): all writes are
  // TeacherGate-checked inside their use cases; reads are open like the rest.
  setAcademicPeriods = null,
  getProgressReport = null,
  renderProgressReportPdf = null,
  renderCertificatePdf = null,
  // `(nowMs) => minutes` — the household's UTC offset (certificate dating).
  getHouseholdOffsetMinutes = null,
  // Wave-5 repair (spec D1/D2/D3) — writes gated inside their use cases.
  attestationLog = null,
  recordAttestation = null,
  teacherNotesStore = null,
  recordTeacherNote = null,
  reassignEvidence = null,
  attemptsStore = null,
  // Advocacy wave 6.
  retractTeacherRecord = null,
  getTranscript = null,
  renderTranscriptPdf = null,
  renderSyllabusPdf = null,
  curriculumForSyllabus = null,
  passOverrideStore = null,
  setPassOverride = null,
  milestoneStatuses = null,
  setMilestones = null,
  enrichmentLog = null,
  recordEnrichment = null,
  logger = console,
}) {
  const router = express.Router();
  let warnedMaterialsConfigMissing = false;
  const wrap = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (err instanceof GuestForbiddenError) return res.status(403).json({ error: err.message });
        if (err instanceof SessionGoneError) return res.status(410).json({ error: err.message });
        if (err instanceof EntityNotFoundError) return res.status(404).json({ error: err.message });
        if (['REMEDIATION_ACTION_CONFLICT', 'REMEDIATION_ACTION_OUT_OF_ORDER'].includes(err?.code)) {
          return res.status(409).json({ error: err.message, code: err.code });
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
        return res.status(500).json({ error: 'internal' });
      });
  };

  router.get('/roster', wrap(async (req, res) => res.json(
    learnerDirectory ? await learnerDirectory.listLearners() : schoolService.getRoster(),
  )));
  // The teacher console's picker roster: config-declared teacher ids resolved
  // against the live household roster per request. Unwired serves the honest
  // "not configured" shape rather than 404ing a surface that can explain it.
  router.get('/teachers', wrap(async (req, res) => res.json(
    getTeachers ? await getTeachers.execute() : { configured: false, teachers: [] },
  )));
  // Await the (async, off-thread) warm so a cold cache returns the full list
  // rather than empty — without ever blocking the event loop on the file scan.
  router.get('/banks', wrap(async (req, res) => {
    await schoolService.warmBanks();
    res.json(schoolService.listBanks({ audience: req.query.audience }));
  }));
  router.get('/banks/:bankId', wrap((req, res) => res.json(schoolService.getBank(req.params.bankId))));
  router.get('/catalogs', wrap(async (req, res) => {
    if (!learningCatalog) return res.json({ schema: 'school.catalog-index/v1', catalogs: [] });
    return res.set('Cache-Control', 'no-store').json(await learningCatalog.list({
      learnerId: textQuery(req.query.learnerId),
    }));
  }));
  router.get('/catalogs/:catalogId/subjects/:subjectId/courses/:courseId/units/:unitId/lessons/:lessonId', wrap(async (req, res) => {
    if (!learningCatalog) throw new EntityNotFoundError('School Catalog', 'not configured');
    const { catalogId, subjectId, courseId, unitId, lessonId } = req.params;
    return res.set('Cache-Control', 'no-store').json(await learningCatalog.lesson({
      catalogId, subjectId, courseId, unitId, lessonId,
      learnerId: textQuery(req.query.learnerId),
    }));
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
      rows = address !== null
        ? await surfaceCertification.lesson(address)
        : await surfaceCertification.bank(bankId);
    } catch {
      throw new EntityNotFoundError('School surface certification target', address ?? bankId);
    }
    const filtered = surfaceId !== null ? rows.filter((row) => row.surfaceId === surfaceId) : rows;
    return res.set('Cache-Control', 'no-store').json(filtered);
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
    if (!surfaceRegistry) return unresolved('surface registry not configured');

    let surfaceId = 'screen-browser';
    if (screenParam !== null && screenParam !== 'browser') {
      if (!getScreenConfig) return unresolved('screen config lookup not configured');
      const config = await getScreenConfig(screenParam);
      if (!config) return unresolved('screen config not found');
      if (!config.surfaceProfile) return unresolved('screen config has no surfaceProfile key');
      surfaceId = config.surfaceProfile;
    }

    const profile = surfaceRegistry.get(surfaceId);
    if (!profile) return unresolved(`unknown surfaceId '${surfaceId}'`);
    return res.set('Cache-Control', 'no-store').json(profile);
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
  const PRINT_DOC_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,3}$/;
  const PRINT_CARD_ID = /^[0-9]{7}$/;
  // The FIXED /print routes must register BEFORE the /print/*id splat below —
  // Express matches in registration order, and the splat would otherwise
  // swallow them as document ids (it did, in production, until 2026-08-06:
  // /print/pending 404'd as "print document not found: pending"). No
  // reserved-name exclusion list on purpose — it would silently drift the
  // day a new fixed /print route is added; order is the one source of truth.
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
  // Hierarchical taxonomy ids contain '/', so the id is a named wildcard
  // (Express 5 splat) rather than a single segment.
  router.get('/print/*id', wrap(async (req, res) => {
    if (!renderPrintDocument) return res.status(503).json({ error: 'print-render-unavailable' });
    const rawId = splatPath(req, 'id');
    // omr is the default: card-backed sheets are the system's main mode, and
    // the common ask is "print my sheet", not "choose a variety".
    const variety = textQuery(req.query.variety) ?? 'omr';
    if (variety !== 'omr' && variety !== 'hand') {
      throw new ValidationError("variety must be 'omr' or 'hand'");
    }

    // /print/<7 digits> is a CARD lookup, not a document id. Card ids are
    // unique and unambiguous — documentValidation reserves bare 7-digit ids
    // so no document can ever collide — and the card number is the one thing
    // physically printed in large digits on the sheet in a child's hand. The
    // card's newest usable allocation names the document; the request then
    // flows exactly as `?card=<id>` on that document (adoption, teacher key,
    // learner-mismatch checks all apply unchanged).
    let id = rawId;
    let cardFromPath = null;
    if (PRINT_CARD_ID.test(rawId)) {
      if (!printAllocationStore?.findByCard) {
        return res.status(503).json({ error: 'print-render-unavailable' });
      }
      if (variety === 'hand') {
        throw new ValidationError('a card-id path names an omr sheet; hand variety does not apply');
      }
      for (const param of ['card', 'freshCard', 'startRow', 'retake']) {
        if (req.query[param] !== undefined) {
          throw new ValidationError(`a card-id path already names the sheet; ${param} does not apply`);
        }
      }
      const record = newestUsableRecord(await printAllocationStore.findByCard(rawId));
      if (!record) {
        // The same courtesy a mis-bubbled scan gets: a mistyped card number
        // suggests the live cards one digit away instead of a bare 404.
        const nearMissCardIds = await nearMissLiveCards(printAllocationStore, rawId);
        return res.status(404).json({
          error: `no sheet found for card ${rawId}`,
          ...(nearMissCardIds.length ? { nearMissCardIds } : {}),
        });
      }
      id = record.documentId;
      cardFromPath = rawId;
    } else if (!PRINT_DOC_ID.test(rawId)) {
      throw new ValidationError('id must be a lowercase document id');
    }

    const context = {};
    const learnerName = textQuery(req.query.learnerName);
    if (learnerName) context.learnerName = learnerName;
    const date = textQuery(req.query.date);
    if (date) context.date = date;
    if (req.query.teacher === '1' || req.query.teacher === 'true') {
      // Answer keys are gated: this is a kid-facing app, and the population
      // being kept from the key is exactly the population with URL-bar
      // access. `getPrintTeacherPin` (composition-wired, reads the household
      // school config's `print.teacherPin`) is the trust anchor: when wired,
      // teacher renders DENY until a pin is configured and matched. A
      // composition that does not wire the getter (embedded/test harnesses)
      // has opted out of the gate entirely.
      if (getPrintTeacherPin) {
        const pin = await getPrintTeacherPin();
        if (pin == null) {
          return res.status(403).json({
            error: 'teacher keys are disabled: set print.teacherPin in the school household config',
          });
        }
        if (textQuery(req.query.pin) !== String(pin)) {
          return res.status(403).json({ error: 'teacher key requires the correct pin=<value>' });
        }
      }
      context.teacher = true;
    }

    // Sheet identity: the render must be reproducible so the student sheet,
    // its answer key, and the bank selections/order all agree across calls.
    //   rev=<9 hex>   — pin the published revision (else latest/source).
    //   variant=<n>   — per-kid shuffle variant (spread over the document,
    //                   exactly as IssueDocument does; never in the artifact).
    //   card=<7 digits> (omr, without startRow) — the card IS the sheet id:
    //                   when an allocation record exists for this card and
    //                   document, its rev/variant/startRow/learner are ADOPTED
    //                   so the render (or its teacher key) reproduces the
    //                   exact sheet the card was printed for. Explicit
    //                   rev/variant params are rejected in that mode — the
    //                   record is the identity, not the query string.
    const revParam = textQuery(req.query.rev);
    if (revParam !== null && !/^[0-9a-f]{9}$/.test(revParam)) {
      throw new ValidationError('rev must be 9 lowercase hex characters');
    }
    let variant = req.query.variant === undefined
      ? null
      : boundedIntegerQuery(req.query.variant, 0, 0, 999, 'variant');
    let rev = revParam;
    let adoptedRecord = null;

    // Memoized archetype probe: both the bare-lane gate and the card-adopt
    // gate below need to know if this document is a quiz, and both may run
    // in the same request — one repo read serves them both.
    let quizProbe = null;
    const isQuizDocument = async () => {
      if (!printDocumentsRepo) return false;
      if (quizProbe === null) {
        const probe = (await printDocumentsRepo.getPublished(id)) ?? (await printDocumentsRepo.get(id));
        quizProbe = probe?.archetype === 'quiz';
      }
      return quizProbe;
    };

    if (variety === 'omr') {
      const freshCard = req.query.freshCard === '1' || req.query.freshCard === 'true';
      const card = cardFromPath ?? textQuery(req.query.card);
      const learnerId = textQuery(req.query.learnerId);
      if (freshCard && card) throw new ValidationError('freshCard and card are mutually exclusive');

      // Quiz sheets are PER-STUDENT: without a learner (or an explicit card,
      // which pins identity to its allocation record), two siblings hitting
      // the same URL would be handed the same sheet identity — same card
      // number, same shuffle — and their scans would grade into one record.
      // Teacher renders are reads, not takes, and stay exempt. Worksheets
      // (lower stakes) may still render anonymously.
      if (!card && !learnerId && !context.teacher && await isQuizDocument()) {
        throw new ValidationError(
          'quiz sheets are per-student: add learnerId=<id> (or card=<7 digits> to reproduce a printed sheet)',
        );
      }

      const adopt = (record) => {
        if (revParam !== null || variant !== null) {
          throw new ValidationError(
            'this render reproduces an existing sheet; rev/variant come from its allocation record',
          );
        }
        if (learnerId && (record.learnerId ?? null) !== learnerId) {
          // Same conflict code either way (the record can't be adopted under
          // this learnerId), but "belongs to a different learner" is simply
          // false when the record has no learnerId at all — it was rendered
          // anonymously, not for someone else.
          const message = record.learnerId
            ? `card ${record.cardId} belongs to a different learner; omit learnerId to reproduce its sheet`
            : `card ${record.cardId} carries an anonymous sheet; omit learnerId to reproduce it`;
          throw new DomainInvariantError(message, {
            code: 'CARD_LEARNER_MISMATCH', details: { cardId: record.cardId },
          });
        }
        adoptedRecord = record;
        rev = record.rev;
        variant = record.variant;
        context.cardId = record.cardId ?? context.cardId;
        context.startRow = record.rowRange.start;
        if (record.learnerId) context.learnerId = record.learnerId;
      };
      const newestUsable = newestUsableRecord;

      // retake=1: a deliberate fresh attempt — new card, next unused shuffle
      // variant for this learner's document, so the retake sheet is never
      // the memorizable duplicate of the first (and never touches the
      // original's record). Mutually exclusive with every explicit-identity
      // param: a retake's identity is derived, not supplied.
      const retake = req.query.retake === '1' || req.query.retake === 'true';
      if (retake) {
        if (freshCard || card || revParam !== null || variant !== null) {
          throw new ValidationError('retake takes no card/freshCard/rev/variant parameters');
        }
        const prior = printAllocationStore?.findByDocument
          ? (await printAllocationStore.findByDocument(id))
            .filter((entry) => (learnerId ? entry.learnerId === learnerId : true))
          : [];
        variant = prior.reduce((max, entry) => Math.max(max, entry.variant ?? 0), -1) + 1;
        context.freshCard = true;
      } else if (freshCard) {
        context.freshCard = true;
      } else if (card) {
        if (!PRINT_CARD_ID.test(card)) throw new ValidationError('card must be 7 digits');
        context.cardId = card;
        let usableRecordExists = false;
        if (printAllocationStore) {
          if (req.query.startRow === undefined) {
            const record = newestUsable((await printAllocationStore.findByCard(card))
              .filter((entry) => entry.documentId === id));
            usableRecordExists = !!record;
            if (record) adopt(record);
          } else if (!learnerId && (await isQuizDocument())) {
            // An explicit startRow skips ADOPTION (the record's rev/variant
            // never override the query string here), but the quiz gate below
            // still needs to know whether this card carries a real record
            // for this document — otherwise startRow=<n> reopens the exact
            // fabricated-card bypass the bare card= lane closes, just with
            // one extra query param.
            const record = newestUsable((await printAllocationStore.findByCard(card))
              .filter((entry) => entry.documentId === id));
            usableRecordExists = !!record;
          }
        }
        if (!adoptedRecord && !learnerId && !usableRecordExists && (await isQuizDocument())) {
          throw new ValidationError(
            `card ${card} has no usable allocation for this quiz — add learnerId=<id> to attach it `
            + '(or check the card number)',
          );
        }
        if (!adoptedRecord) {
          context.startRow = boundedIntegerQuery(req.query.startRow, 1, 1, 50, 'startRow');
        }
      } else {
        // Automatic sheet identity: a bare omr render reuses this document's
        // newest usable sheet (per learner when learnerId is given), and only
        // mints a fresh card when none exists — so refreshing the URL never
        // burns cards, and the same URL keeps producing the same sheet.
        // KNOWN LIMIT: this find-then-allocate is not atomic — two truly
        // simultaneous first prints can each mint a card, stranding one as
        // an uncollected live record (recover: school-docs release-card).
        // Accepted at household scale; the store itself serializes writes.
        const record = printAllocationStore?.findByDocument
          ? newestUsable((await printAllocationStore.findByDocument(id))
            .filter((entry) => (learnerId ? entry.learnerId === learnerId : true)))
          : null;
        if (record) adopt(record);
        // A teacher key with no existing sheet is a READ — minting a live
        // allocation as a side effect would quietly become the class's sheet
        // identity (the next student print adopts it). Render key-only; the
        // "rendered without card allocation" warning stays on the response.
        // An explicit freshCard=1&teacher=1 (deliberately minting the sheet
        // and key in one go) still allocates via the branch above.
        else if (!context.teacher) context.freshCard = true;
      }
      if (learnerId && !adoptedRecord) context.learnerId = learnerId;
    } else if (req.query.card !== undefined || req.query.freshCard !== undefined
        || req.query.startRow !== undefined) {
      throw new ValidationError('hand variety takes no card parameters');
    }

    let target;
    if (!printDocumentsRepo) {
      // No repo wired (embedded/test harness): rev/variant pinning is impossible,
      // and the renderer resolves the id itself.
      if (rev !== null || variant !== null) return res.status(503).json({ error: 'print-render-unavailable' });
      target = { id };
    } else {
      // Published-first on EVERY lane: a source render re-publishes in-memory and
      // a drifted source hashes to a rev getPublished can never serve — the
      // allocation record would pin a phantom rev and the card would die at scan
      // time, taking innocent cardmates with it. The published artifact's rev is
      // a FIELD, which variant overrides leave intact. Source is the fallback
      // only for a document never published at all (proofing a draft).
      const raw = rev !== null
        ? await printDocumentsRepo.getPublished(id, rev)
        : ((await printDocumentsRepo.getPublished(id)) ?? (await printDocumentsRepo.get(id)));
      if (!raw) throw new EntityNotFoundError('print document', rev !== null ? `${id}@${rev}` : id);
      target = { document: variant !== null ? { ...raw, variant } : raw };
    }

    const result = await renderPrintDocument.execute({ ...target, context });
    const warnings = variety === 'hand'
      ? (result.warnings ?? []).filter((warning) => !/without card allocation/.test(warning))
      : (result.warnings ?? []);
    if (warnings.length) res.set('X-School-Print-Warnings', JSON.stringify(warnings));
    if (result.allocation) res.set('X-School-Print-Allocation', JSON.stringify(result.allocation));
    res.set('Cache-Control', 'no-store');
    const slug = id.split('/').pop();
    res.set('Content-Disposition', `inline; filename="${slug}${context.teacher ? '-key' : ''}.pdf"`);
    return res.type('application/pdf').send(Buffer.from(result.bytes));
  }));

  router.get('/geography/decks', wrap((req, res) => {
    // Geography is an outer presentation here. The service/source expose only
    // generic collections and bank summaries.
    const decks = schoolService.listBankSourceSummaries({ collection: 'geography' })
      .map(({ summaryId, ...summary }) => ({ deckId: summaryId, ...summary }));
    res.json({ decks });
  }));
  router.post('/sessions', wrap((req, res) => {
    const { userId = null, bankId, mode, learning = null } = req.body || {};
    if (learning !== null) {
      if (!openCatalogLearningSession) {
        throw new EntityNotFoundError('School Catalog sessions', 'not configured');
      }
      return Promise.resolve(openCatalogLearningSession.execute({
        learnerId: userId, bankId, mode, learning,
      })).then((result) => res.json(result));
    }
    return res.json(schoolService.openSession({ userId, bankId, mode }));
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
    await schoolService.warmBanks();
    res.json(schoolService.listQuizRequests({ materialId: req.query.materialId || null }));
  }));
  router.post('/quiz-requests/dismiss', wrap(async (req, res) => {
    const { unitId = null, bankId = null, userId, dismissedBy = null, pin = null, reason } = req.body || {};
    res.json(await schoolService.dismissQuizRequest({ unitId, bankId, userId, dismissedBy, pin, reason }));
  }));
  // Kid-safe like /quiz-requests: a child asks for another go; the row lands
  // on the teacher's backlog (student-advocacy A2).
  router.post('/retake-requests', wrap((req, res) => {
    const { userId = null, bankId = null, unitId = null, title = null } = req.body || {};
    res.json(schoolService.requestRetake({ userId, bankId, unitId, title }));
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
    if (!userId || !materialProgressStore) return res.json({ ok: true, recorded: false });
    materialProgressStore.record({
      userId,
      plexId: req.params.unitId,
      percent,
      seconds: playhead,
      duration: durationMs != null ? durationMs / 1000 : undefined,
    });
    return res.json({ ok: true });
  }));

  // --- report cards, period close, teacher digest (Task 6, spec R5b) --------
  // LEAN by design: this feeds Task 7's PDF and Task 9's parent panel. It must
  // never grow dashboard extras of its own — those belong on `/progress`.
  router.get('/report-card', wrap(async (req, res) => {
    if (!getReportCard) return res.json(null);
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = requiredTextQuery(req.query.periodId, 'periodId');
    const report = await getReportCard.execute({ learnerId, periodId });
    if (wantsPdf(req)) return sendReportCardPdf(res, renderReportCardPdf, report, { learnerId, periodId, req });
    return res.set('Cache-Control', 'no-store').json(report);
  }));

  router.get('/report-card/frozen', wrap(async (req, res) => {
    if (!reportCardsStore) return res.json(null);
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = textQuery(req.query.periodId);
    if (periodId) {
      const record = reportCardsStore.readReportCard(learnerId, periodId);
      if (!record) throw new EntityNotFoundError('Frozen report card', `${learnerId}/${periodId}`);
      if (wantsPdf(req)) return sendReportCardPdf(res, renderReportCardPdf, record, { learnerId, periodId, req });
      return res.set('Cache-Control', 'no-store').json(record);
    }
    // The list variety returns every frozen record for the learner — `format=pdf`
    // names exactly one document, so it does not apply here; served as JSON
    // regardless of the query param.
    return res.set('Cache-Control', 'no-store').json(reportCardsStore.listReportCards(learnerId));
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
      if (!renderTranscriptPdf) return res.status(503).json({ error: 'transcript-render-unavailable' });
      const roster = learnerDirectory ? await learnerDirectory.listLearners() : [];
      const learnerName = roster.find((r) => r.id === learnerId)?.name ?? learnerId;
      const { pdf } = await renderTranscriptPdf(transcript, { learnerName });
      return res
        .set('Content-Type', 'application/pdf')
        .set('Content-Disposition', `inline; filename="transcript-${slugify(learnerId)}.pdf"`)
        .send(pdf);
    }
    return res.set('Cache-Control', 'no-store').json(transcript);
  }));
  router.get('/syllabus', wrap(async (req, res) => {
    if (!curriculumForSyllabus || !renderSyllabusPdf) return res.status(503).json({ error: 'syllabus-render-unavailable' });
    const courseId = requiredTextQuery(req.query.courseId, 'courseId');
    const units = (await curriculumForSyllabus.listUnitSummaries())
      .filter((u) => u.courseId === courseId)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (!units.length) throw new EntityNotFoundError('course', courseId);
    const { pdf } = await renderSyllabusPdf({ courseId, units });
    return res
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `inline; filename="syllabus-${slugify(courseId)}.pdf"`)
      .send(pdf);
  }));
  router.get('/attempt-days', wrap((req, res) => {
    if (!attemptsStore?.listAttemptDays) return res.json({ days: [] });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    res.json({ days: attemptsStore.listAttemptDays(learnerId).slice(0, 14) });
  }));

  // --- wave-5 repair ---------------------------------------------------------
  router.get('/attestations', wrap((req, res) => {
    res.json({ entries: attestationLog ? attestationLog.list({ learnerId: textQuery(req.query.learnerId) }) : [] });
  }));
  router.post('/attestations', wrap(async (req, res) => {
    if (!recordAttestation) throw new EntityNotFoundError('attestations', 'not configured');
    const { learnerId, unitId, reason, attestedBy = null, pin = null } = req.body || {};
    res.status(201).json(await recordAttestation.execute({ learnerId, unitId, reason, attestedBy, pin }));
  }));
  router.get('/teacher-notes', wrap((req, res) => {
    res.json({ entries: teacherNotesStore ? teacherNotesStore.list({ learnerId: textQuery(req.query.learnerId) }) : [] });
  }));
  router.post('/teacher-notes', wrap(async (req, res) => {
    if (!recordTeacherNote) throw new EntityNotFoundError('teacher notes', 'not configured');
    const { learnerId, note, from = null, pin = null } = req.body || {};
    res.status(201).json(await recordTeacherNote.execute({ learnerId, note, from, pin }));
  }));
  // A day's attempts grouped by assessment — the reassignment picker's read.
  router.get('/attempts-summary', wrap((req, res) => {
    if (!attemptsStore) return res.json({ assessments: [] });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const day = requiredTextQuery(req.query.day, 'day');
    const byAssessment = new Map();
    for (const attempt of attemptsStore.readAttemptDay(learnerId, day)) {
      const id = attempt.sessionId ?? attempt.provenance?.recordId ?? null;
      if (!id) continue;
      const entry = byAssessment.get(id) ?? { assessmentId: id, count: 0, bankId: attempt.bankId ?? null, firstAt: attempt.at };
      entry.count += 1;
      if (attempt.at < entry.firstAt) entry.firstAt = attempt.at;
      byAssessment.set(id, entry);
    }
    res.json({ assessments: [...byAssessment.values()] });
  }));
  router.post('/reassign', wrap(async (req, res) => {
    if (!reassignEvidence) throw new EntityNotFoundError('reassignment', 'not configured');
    const { fromLearnerId, toLearnerId, day, assessmentId, reassignedBy = null, pin = null } = req.body || {};
    res.json(await reassignEvidence.execute({ fromLearnerId, toLearnerId, day, assessmentId, reassignedBy, pin }));
  }));

  // --- wave-4 records --------------------------------------------------------
  // The certificate's issue date in the HOUSEHOLD's calendar (6pm local must
  // not date a certificate tomorrow) — same offset policy as the pacing reads.
  const householdToday = () => {
    const nowMs = Date.now();
    return new Date(nowMs + (getHouseholdOffsetMinutes?.(nowMs) ?? 0) * 60_000).toISOString().slice(0, 10);
  };
  router.get('/progress-report', wrap(async (req, res) => {
    if (!getProgressReport) return res.json(null);
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = requiredTextQuery(req.query.periodId, 'periodId');
    const report = await getProgressReport.execute({ learnerId, periodId });
    if (wantsPdf(req)) {
      if (!renderProgressReportPdf) return res.status(503).json({ error: 'progress-report-render-unavailable' });
      const { pdf } = await renderProgressReportPdf(report);
      return res
        .set('Content-Type', 'application/pdf')
        .set('Content-Disposition', `inline; filename="progress-report-${slugify(learnerId)}-${slugify(periodId)}.pdf"`)
        .send(pdf);
    }
    return res.set('Cache-Control', 'no-store').json(report);
  }));
  router.get('/certificate', wrap(async (req, res) => {
    if (!getReportCard || !renderCertificatePdf) return res.status(503).json({ error: 'certificate-render-unavailable' });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const periodId = requiredTextQuery(req.query.periodId, 'periodId');
    const courseId = requiredTextQuery(req.query.courseId, 'courseId');
    const card = await getReportCard.execute({ learnerId, periodId });
    const course = (card?.courses ?? []).find((c) => c.courseId === courseId);
    // No fabricated diplomas: a course with nothing graded has no percent.
    if (!course || typeof course.coursePercent !== 'number') {
      throw new EntityNotFoundError('completed course', `${learnerId}/${courseId}`);
    }
    const roster = learnerDirectory ? await learnerDirectory.listLearners() : [];
    const learnerName = roster.find((r) => r.id === learnerId)?.name ?? learnerId;
    const { pdf } = await renderCertificatePdf({
      learnerName,
      courseId,
      percent: course.coursePercent,
      periodLabel: card.period?.label ?? periodId,
      issuedOn: householdToday(),
      issuedBy: textQuery(req.query.issuedBy) ?? null,
    });
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
    res.json({ historyLength: typeof academicPeriods?.historyLength === 'function' ? academicPeriods.historyLength() : 0 });
  }));
  router.get('/pass-overrides', wrap((req, res) => {
    res.json({ overrides: passOverrideStore ? passOverrideStore.all() : {} });
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
    res.json({ entries: enrichmentLog ? enrichmentLog.list({ learnerId: textQuery(req.query.learnerId) }) : [] });
  }));
  router.post('/enrichment', wrap(async (req, res) => {
    if (!recordEnrichment) throw new EntityNotFoundError('enrichment log', 'not configured');
    const { recordedBy = null, pin = null, learnerIds = [], from, to = null, title, subjectIds = [], note = null } = req.body || {};
    res.status(201).json(await recordEnrichment.execute({ recordedBy, pin, learnerIds, from, to, title, subjectIds, note }));
  }));

  router.get('/teacher/today', wrap(async (req, res) => {
    if (!getTeacherToday) return res.json([]);
    res.set('Cache-Control', 'no-store').json(await getTeacherToday.execute());
  }));

  // The configured academic calendar — a plain array, not wrapped, matching
  // `getTeacherToday`'s own "answer the whole list" posture. This is the
  // ONLY thing a child-facing surface needs to work out "the current period"
  // for itself (Task 9's student panel): `listPeriods()` carries
  // `startsAt`/`endsAt` for every period, and the client picks the one that
  // contains "now".
  router.get('/periods', wrap(async (req, res) => {
    if (!academicPeriods) return res.json([]);
    res.set('Cache-Control', 'no-store').json(academicPeriods.listPeriods());
  }));

  // A learner's own RESOLVED review items, newest first — the feedback a
  // child can see (Task 9, spec R7). Never a pending item still awaiting a
  // grown-up's verdict; that queue is the parent-only `/lifecycle/review`.
  router.get('/review/learner/:learnerId', wrap(async (req, res) => {
    if (!reviewQueue) return res.json([]);
    const learnerId = requiredTextQuery(req.params.learnerId, 'learnerId');
    const limit = boundedIntegerQuery(req.query.limit, 20, 1, 100, 'limit');
    const items = await reviewQueue.listForLearner(learnerId, { limit });
    // Standalone teacher notes (spec D3) join the same child-visible feed,
    // marked kind:'note' so a renderer can tell them from verdicts.
    const standaloneNotes = (teacherNotesStore?.list?.({ learnerId }) ?? []).map((n) => ({
      itemId: n.id, sessionId: null, unitId: null, verdict: null, kind: 'note',
      note: n.note, gradedBy: n.from ?? null, gradedAt: n.at,
    }));
    res.set('Cache-Control', 'no-store').json([...items.map((item) => ({
      itemId: item.itemId,
      sessionId: item.sessionId,
      unitId: item.unitId ?? null,
      verdict: item.verdict,
      note: item.note ?? null,
      gradedBy: item.gradedBy ?? null,
      gradedAt: item.gradedAt ?? null,
      prompt: item.prompt ?? null,
      questionNumber: item.questionNumber ?? null,
    })), ...standaloneNotes]
      .sort((a, b) => String(b.gradedAt ?? '').localeCompare(String(a.gradedAt ?? '')))
      .slice(0, limit));
  }));

  if (schoolCalcRouter) router.use('/calc', schoolCalcRouter);

  return router;
}

/**
 * Newest usable allocation record, live before satisfied, then most recently
 * rendered — the same precedence scan-back resolution uses for row ownership.
 * Shared by the print route's bare-omr reuse, card adoption, and the
 * card-id-path lookup.
 */
function newestUsableRecord(records) {
  return records
    .filter((record) => record.status === 'live' || record.status === 'satisfied')
    .sort((a, b) => {
      const rank = (record) => (record.status === 'live' ? 1 : 0);
      return (rank(b) - rank(a)) || String(b.renderedAt).localeCompare(String(a.renderedAt));
    })[0] ?? null;
}

/**
 * Live cards exactly one digit off a card id nobody recognizes — the same
 * Hamming-1 courtesy the scan consumer extends to a mis-bubbled card, for a
 * mistyped URL. Household-scale linear scan; a store without `listCardIds`
 * yields no suggestions.
 */
async function nearMissLiveCards(store, cardId) {
  if (typeof store.listCardIds !== 'function') return [];
  const out = [];
  for (const candidate of await store.listCardIds()) {
    if (candidate.length !== cardId.length) continue;
    let distance = 0;
    for (let i = 0; i < candidate.length && distance < 2; i += 1) {
      if (candidate[i] !== cardId[i]) distance += 1;
    }
    if (distance !== 1) continue;
    // eslint-disable-next-line no-await-in-loop
    const records = await store.findByCard(candidate);
    if (records.some((record) => record.status === 'live')) out.push(candidate);
  }
  return out.sort();
}

/** `?format=pdf` on either report-card GET; JSON stays the default either way. */
function wantsPdf(req) {
  return textQuery(req.query.format) === 'pdf';
}

/**
 * Render and send a report card as `application/pdf` — shared by the live
 * and frozen GET routes so the content-type/filename/cache-header contract
 * (and the "not wired" 503) stays identical between them.
 *
 * `learnerId`/`periodId` are query-string values, not path segments — a
 * caller can put anything in them (quotes, semicolons, CRLF). They are
 * slugged before landing in `Content-Disposition`, the same way `receipts.mjs`
 * sluggs a learner id before it becomes part of a document id: a hostile
 * `learnerId=kid1"; filename="evil.pdf` must not be able to inject a second
 * `filename=` parameter into the header.
 */
async function sendReportCardPdf(res, renderReportCardPdf, report, { learnerId, periodId, req }) {
  if (!renderReportCardPdf) return res.status(503).json({ error: 'report-card-pdf-unavailable' });
  const { pdf } = await renderReportCardPdf(report, { learnerName: textQuery(req.query.learnerName) });
  res.set('Cache-Control', 'no-store');
  const slug = `report-card-${slugify(learnerId, 'learner')}-${slugify(periodId, 'period')}.pdf`;
  res.set('Content-Disposition', `inline; filename="${slug}"`);
  return res.type('application/pdf').send(pdf);
}

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

/** Five non-empty, slash-separated segments: catalogId/subjectId/courseId/unitId/lessonId. */
function isLessonAddress(address) {
  const segments = address.split('/');
  return segments.length === 5 && segments.every((segment) => segment.length > 0);
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

export default createSchoolRouter;
