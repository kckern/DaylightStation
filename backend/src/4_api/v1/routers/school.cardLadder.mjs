/**
 * `/card-ladder/…` (mastery redesign §4 API, §8 test mode). Mounted twice:
 * live, and `/card-ladder/test` over the read-only shadow service. A thin
 * shell — every rule lives in CardLadderSittingService. Responses are
 * `private, no-store`: a child's sitting must not sit in a shared cache.
 */
import express from 'express';
import { presentPublicResources } from '../presenters/publicResourceRefs.mjs';

// A spoken take arrives as the raw request body (MediaRecorder output).
const rawAudio = express.raw({ type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'application/octet-stream'], limit: '10mb' });

/** The canonical root first; `/word-ladder` is the pre-rename alias (2026-09-23). */
export const CARD_LADDER_ROUTE_ROOTS = Object.freeze(['/card-ladder', '/word-ladder']);

export function mountCardLadderRoutes({
  router, wrap, notConfigured, cardLadderStudy = null, cardLadderTest = null, stageScreen = null, capabilityProof = () => null,
  teacherCapabilitySessions = null, cardLadderTuning = null,
}) {
  const noStore = (res) => res.set('Cache-Control', 'private, no-store');
  // Every route answers under `/card-ladder` and, as an alias kept for
  // anything still pointed at the engine's old name, `/word-ladder`.
  for (const root of CARD_LADDER_ROUTE_ROOTS) {
    const mount = (base, getService, { test }) => {
      const service = () => {
        const s = getService();
        if (!s) throw notConfigured(test ? 'card-ladder test mode' : 'card-ladder');
        return s;
      };
      // The start card (read-only; nothing opens before Start, spec §6). Test
      // mode reads the seeded snapshot Start would open on (`scenario`).
      router.get(`${base}/intro`, wrap(async (req, res) => {
        const { userId, deckId, scenario = null } = req.query;
        const intro = await service().intro(test ? { userId, deckId, scenario } : { userId, deckId });
        noStore(res).json(presentPublicResources(intro));
      }));
      router.post(`${base}/open`, wrap(async (req, res) => {
        const { userId, deckId, scenario = null, capabilities } = req.body || {};
        noStore(res).json(await service().open(test ? { userId, deckId, scenario, capabilities } : { userId, deckId, capabilities }));
      }));
      // Speaking steps only; the test mount's service keeps nothing (discarding sink).
      router.post(`${base}/sittings/:sittingId/recordings/:itemId`, rawAudio, wrap(async (req, res) => {
        noStore(res).json(await service().saveRecording({
          userId: req.query.userId, sittingId: req.params.sittingId, itemId: req.params.itemId,
          buffer: Buffer.isBuffer(req.body) ? req.body : null, ext: req.query.ext ?? 'webm',
        }));
      }));
      router.post(`${base}/sittings/:sittingId/practice`, wrap(async (req, res) => {
        const {
          userId, mode, help = true, filter = 'introduced', chosen = [], frontSide = 'term',
        } = req.body || {};
        noStore(res).json(await service().practice({
          userId, sittingId: req.params.sittingId, mode, help, filter, chosen, frontSide,
        }));
      }));
      // My words. Test mode reads the named sitting's shadow (`sittingId`).
      router.get(`${base}/words`, wrap(async (req, res) => {
        const { userId, deckId, sittingId = null } = req.query;
        noStore(res).json(await service().words({ userId, deckId, sittingId }));
      }));
      router.post(`${base}/sittings/:sittingId/items/:itemId`, wrap(async (req, res) => {
        const { userId, response = {} } = req.body || {};
        noStore(res).json(await service().respond({
          userId, sittingId: req.params.sittingId, itemId: req.params.itemId, response,
        }));
      }));
      router.get(`${base}/sittings/:sittingId`, wrap(async (req, res) => {
        noStore(res).json(await service().get({ userId: req.query.userId, sittingId: req.params.sittingId }));
      }));
      router.post(`${base}/sittings/:sittingId/close`, wrap(async (req, res) => {
        const { userId, reason = 'leave' } = req.body || {};
        noStore(res).json(await service().close({ userId, sittingId: req.params.sittingId, reason }));
      }));
    };
    router.get(`${root}/stage`, wrap(async (_req, res) => noStore(res).json({ screen: stageScreen })));
    router.post(`${root}/fold`, wrap(async (req, res) => {
      if (!cardLadderStudy) throw notConfigured('card-ladder');
      const { learnerId, actorId, pin = null } = req.body || {};
      noStore(res).json(await cardLadderStudy.fold({ learnerId, actorId, pin }));
    }));
    // Grown-up word controls (spec §6): live only, teacher-gated in the service.
    // `pin` may also be the console's cookie capability: the school router
    // injects it into a POST body, but a GET has no body, so the GET reads the
    // cookie itself via `capabilityProof` (a literal query pin always wins).
    const live = () => { if (!cardLadderStudy) throw notConfigured('card-ladder'); return cardLadderStudy; };
    /**
     * Who is asking, for the admin GET. Mirrors school.teacherReading.mjs's
     * `actor(req)`: `TeacherGate.assert` checks `isAdult(userId)` BEFORE it
     * ever looks at the capability/pin (TeacherGate.mjs), so a GET with no
     * `actorId` was refused with a 403 regardless of how good the cookie was —
     * the console's read never sent one, because the panel had no reason to
     * think it needed to. The capability session's own userId outranks a query
     * actorId a client supplied: the cookie is what the console actually
     * holds, and a query param naming someone else would be attribution the
     * gate never checked.
     */
    const sessionActorId = (req) => {
      const proof = capabilityProof(req);
      const session = proof ? teacherCapabilitySessions?.status(proof.capabilityToken) : null;
      return session?.active ? session.userId : null;
    };
    router.get(`${root}/admin/words`, wrap(async (req, res) => {
      const { learnerId, deckId } = req.query;
      const pin = req.query.pin ?? capabilityProof(req) ?? null;
      const actorId = sessionActorId(req) ?? req.query.actorId ?? null;
      noStore(res).json(await live().adminWords({ learnerId, deckId, actorId, pin }));
    }));
    const adminPost = (path, method, fields) => router.post(`${root}/admin/${path}`, wrap(async (req, res) => {
      const body = req.body || {};
      const { learnerId, deckId, actorId = null, pin = null } = body;
      const extra = Object.fromEntries(fields.map((key) => [key, body[key]]));
      noStore(res).json(await live()[method]({ learnerId, deckId, actorId, pin, ...extra }));
    }));
    adminPost('reset', 'adminReset', ['wordId']);
    adminPost('mastered', 'adminMarkMastered', ['wordId', 'stage']);
    adminPost('exclude', 'adminExclude', ['wordId', 'excluded']);
    adminPost('drop-deck', 'adminDropDeck', ['dropDeckId']);
    adminPost('regrade', 'adminRegrade', ['day', 'itemId', 'pass']);
    // Tuning (spec §7): the agent's current values vs defaults, its notes and
    // history, and a grown-up undo of one setting. Live only, teacher-gated in
    // CardLadderTuningService; the acting teacher is the capability session's.
    const tuning = () => { if (!cardLadderTuning) throw notConfigured('card-ladder tuning'); return cardLadderTuning; };
    router.get(`${root}/admin/tuning`, wrap(async (req, res) => {
      const { learnerId, deckId } = req.query;
      const pin = req.query.pin ?? capabilityProof(req) ?? null;
      const actorId = sessionActorId(req) ?? req.query.actorId ?? null;
      noStore(res).json(await tuning().adminTuning({ learnerId, deckId, actorId, pin }));
    }));
    router.post(`${root}/admin/tuning/undo`, wrap(async (req, res) => {
      const { learnerId, deckId = null, setting } = req.body || {};
      const pin = req.body?.pin ?? capabilityProof(req) ?? null;
      const actorId = sessionActorId(req) ?? req.body?.actorId ?? null;
      noStore(res).json(await tuning().adminUndo({ learnerId, deckId, setting, actorId, pin }));
    }));
    // Order does not matter: every live route has a literal second segment
    // (`intro`, `open`, `sittings`, `words`, `stage`, `fold`, `admin`) and every test route has `test`, so
    // the two sets are disjoint — no test path can match a live pattern.
    mount(`${root}/test`, () => cardLadderTest, { test: true });
    mount(`${root}`, () => cardLadderStudy, { test: false });
  }
}

export default mountCardLadderRoutes;
