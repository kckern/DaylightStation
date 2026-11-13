import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Content-filter API (mounted at /api/v1/content-filter).
 *
 * Serves the 3-layer cascade for a title so the Player's useContentFilter hook
 * can apply skip/mute/blur/etc. in real time:
 *   GET /:ratingKey?profile=family
 *     -> { edl, profile, override }
 * ratingKey is the Plex rating key (contentId `plex:<ratingKey>`); it is
 * digit-sanitized to prevent path traversal.
 */
export function createContentFilterRouter({ getContentFilter, contentFilterScenes = null, contentFilterArt = null, contentFilterReview = null, contentFilterLibrary = null, jobs = null, logger = console } = {}) {
  if (!getContentFilter || typeof getContentFilter.execute !== 'function') {
    throw new Error('createContentFilterRouter requires getContentFilter');
  }
  const router = express.Router();

  // Every write to a film is refused while a run is writing its files (the child writes the same
  // override and refined EDL). A write that changes what the household gets re-audits the film;
  // review marks, sign-off and runs do not.
  if (jobs) {
    const WRITE = new Set(['PUT', 'POST', 'DELETE']);
    const NO_REAUDIT = /^\/(jobs|review|signoff)(\/|$)/;
    router.use('/:ratingKey', asyncHandler(async (req, res, next) => {
      const key = String(req.params.ratingKey);
      if (!WRITE.has(req.method) || !/^\d+$/.test(key)) return next();
      if (contentFilterLibrary) res.on('finish', () => { if (res.statusCode < 300) contentFilterLibrary.invalidate(key); });
      if (/^\/jobs(\/|$)/.test(req.path)) return next();
      if (await jobs.busyWriting(key)) {
        return res.status(409).json({ error: 'A filter run is writing this film. Try again when it finishes.' });
      }
      // The bleep tone's loudness is a playback setting: it changes nothing the audit checked.
      const keys = Object.keys(req.body?.settings || {});
      const levelOnly = req.path === '/settings' && req.method === 'PUT' && keys.length > 0 && keys.every((k) => k === 'bleepLevel');
      if (!NO_REAUDIT.test(req.path) && !levelOnly) {
        res.on('finish', () => { if (res.statusCode < 300) jobs.audit(key).catch?.(() => {}); });
      }
      next();
    }));
  }

  // A nudge sent with an effect is only saved if the effect is valid (nothing half-applied).
  const CUE_EFFECTS = new Set(['profile', 'off', 'mute', 'bleep', 'blur', 'full-blur', 'blackout', 'skip']);
  const SCENE_EFFECTS = new Set(['profile', 'off', 'blackout', 'skip']);
  router.put(['/:ratingKey/cues/:id', '/:ratingKey/scenes/:id'], (req, res, next) => {
    const effect = req.body?.effect;
    const allowed = req.path.includes('/scenes/') ? SCENE_EFFECTS : CUE_EFFECTS;
    if ('nudge' in (req.body || {}) && effect != null && !allowed.has(effect)) return res.status(400).json({ error: `unknown effect: ${effect}` });
    next();
  });

  // GET /library?stage=&q= -> { films: [{ ratingKey, title, year, stage, job, reviewed, match, unmatched, runtimeWarning }], meta } (Admin library)
  if (contentFilterLibrary) {
    router.get('/library', asyncHandler(async (req, res) => {
      const stage = req.query.stage ? String(req.query.stage) : null;
      const q = req.query.q ? String(req.query.q).slice(0, 100) : null;
      res.json(await contentFilterLibrary.list({ stage, q }));
    }));
  }

  // Pipeline runs (Admin "Make filter"; ContentFilterJobs). Registered before /:ratingKey.
  if (jobs) {
    // GET /jobs -> { running: [{ ratingKey, runId, step }], queued: [...] } (also read by the deploy gate)
    router.get('/jobs', asyncHandler(async (req, res) => { res.json(await jobs.state()); }));
    // Remote filter worker: claim the next run, report progress, hand back results.
    const owner = (req) => String(req.body?.owner || '').slice(0, 120);
    const remote = (fn) => asyncHandler(async (req, res) => {
      if (!owner(req)) return res.status(400).json({ error: 'owner required' });
      try { await fn(req, res); } catch (error) {
        if (error.status === 409 || error.status === 400) return res.status(error.status).json({ error: error.message });
        throw error;
      }
    });
    router.post('/jobs/claim', remote(async (req, res) => {
      const claimed = await jobs.claimRemote({ owner: owner(req) });
      if (!claimed) return res.status(204).end();
      res.json(claimed);
    }));
    router.post('/:ratingKey/jobs/:runId/progress', remote(async (req, res) => {
      await jobs.progress({ ratingKey: String(req.params.ratingKey).replace(/[^0-9]/g, ''), runId: req.params.runId, owner: owner(req), step: req.body?.step || null });
      res.json({ ok: true });
    }));
    // Results carry the refined EDL, the override and transcripts (the app's JSON limit is 50 MB).
    router.post('/:ratingKey/jobs/:runId/complete', remote(async (req, res) => {
      const { status, step = null, error = null, results = null } = req.body || {};
      res.json(await jobs.complete({ ratingKey: String(req.params.ratingKey).replace(/[^0-9]/g, ''), runId: req.params.runId, owner: owner(req), status, step, error, results }));
    }));
    // POST /:ratingKey/jobs/:runId/cancel { by? } -> { run } (Admin "Stop"; 404 unknown, 409 already settled)
    router.post('/:ratingKey/jobs/:runId/cancel', asyncHandler(async (req, res) => {
      const ratingKey = String(req.params.ratingKey).replace(/[^0-9]/g, '');
      if (!ratingKey) return res.status(400).json({ error: 'invalid ratingKey' });
      try {
        res.json({ run: await jobs.cancel({ ratingKey, runId: String(req.params.runId), by: req.body?.by ? String(req.body.by).slice(0, 80) : null }) });
      } catch (error) {
        if (error.status === 404 || error.status === 409) return res.status(error.status).json({ error: error.message });
        throw error;
      }
    }));
    router.get('/:ratingKey/jobs', asyncHandler(async (req, res) => {
      const ratingKey = String(req.params.ratingKey).replace(/[^0-9]/g, '');
      if (!ratingKey) return res.status(400).json({ error: 'invalid ratingKey' });
      res.json((await jobs.record(ratingKey)) || { ratingKey, runs: [] });
    }));
    // POST /:ratingKey/jobs { kind: make|send-back|stage, cues?, stage?, reasons?: {rowId: reason} } -> 202 { run }
    router.post('/:ratingKey/jobs', asyncHandler(async (req, res) => {
      const ratingKey = String(req.params.ratingKey).replace(/[^0-9]/g, '');
      if (!ratingKey) return res.status(400).json({ error: 'invalid ratingKey' });
      const { kind = 'make', cues = null, stage = null, reasons = null } = req.body || {};
      if (cues != null && !(Array.isArray(cues) && cues.every((c) => /^[A-Za-z0-9_-]+$/.test(String(c))))) {
        return res.status(400).json({ error: 'cues must be cue ids' });
      }
      if (reasons != null && !(typeof reasons === 'object' && !Array.isArray(reasons)
        && Object.keys(reasons).length <= 500
        && Object.entries(reasons).every(([k, v]) => /^[A-Za-z0-9_:-]+$/.test(k) && /^[a-z]+$/.test(String(v))))) {
        return res.status(400).json({ error: 'reasons must map row ids to a reason' });
      }
      // A film not matched to Plex has no file to filter against: never queue it.
      const verdict = contentFilterLibrary?.matchOf ? await contentFilterLibrary.matchOf(ratingKey) : null;
      if (verdict?.match === 'unmatched') {
        return res.status(409).json({ error: `This film is not matched to Plex: ${verdict.unmatched?.text || 'no Plex film'}.` });
      }
      try {
        const run = await jobs.enqueue({ ratingKey, kind, cues, stage, reasons, by: req.body?.by || 'admin' });
        res.status(202).json({ run });
      } catch (error) {
        if (error.status === 409 || error.status === 400) return res.status(error.status).json({ error: error.message });
        throw error;
      }
    }));
  }

  // GET /:ratingKey/art -> { logo, background, poster, source }: card art, the logo chosen by cascade.
  if (contentFilterArt) {
    router.get('/:ratingKey/art', asyncHandler(async (req, res) => {
      const ratingKey = String(req.params.ratingKey).replace(/[^0-9]/g, '');
      if (!ratingKey) return res.status(400).json({ error: 'invalid ratingKey' });
      res.json(await contentFilterArt.execute({ ratingKey }));
    }));
  }

  router.get('/:ratingKey', asyncHandler(async (req, res) => {
    const ratingKey = String(req.params.ratingKey).replace(/[^0-9]/g, '');
    if (!ratingKey) return res.status(400).json({ error: 'invalid ratingKey' });

    const profileName = String(req.query.profile || 'family').replace(/[^a-z0-9_-]/gi, '');
    const { edl, profile, override, certification } = await getContentFilter.execute({
      ratingKey,
      profileName,
    });
    if (!edl) return res.status(404).json({ error: 'no filter data', ratingKey });

    // info (not debug) so the endpoint hit is visible in prod logs — confirms the
    // client fetched, and whether an override (sync/snap/gap-fills) was served.
    logger.info?.('content-filter.serve', {
      ratingKey, profile: profileName, cues: edl.cues?.length || 0,
      hasOverride: !!override, addCues: override?.addCues?.length || 0,
      cueOverrides: Object.keys(override?.cueOverrides || {}).length,
    });
    res.json({ edl, profile, override, certification });
  }));

  // Scenes: the grown-up's review (Admin -> Content filter -> Scenes).
  //   GET  /:ratingKey/scenes?profile=family     -> { title, calibration, scenes }
  //   POST /:ratingKey/scenes/cards {all, force} -> { drafted, scenes }   (LLM drafts)
  //   POST /:ratingKey/scenes/:sceneId/card -> { card }   (redraft one)
  //   PUT  /:ratingKey/cues/:cueId {effect, disabled, card, by} -> { ruling }
  //   POST /:ratingKey/cues/:cueId/card -> { cardDraft }   (LLM draft, stored unapproved)
  //   PUT  /:ratingKey/scenes/:sceneId {effect, disabled, card, by} -> { ruling }
  if (contentFilterScenes) {
    const rk = (req) => String(req.params.ratingKey).replace(/[^0-9]/g, '');
    // A scene/cue id is used as-is or refused: silently stripping `va123#0` to `va1230` would rule the wrong item.
    const cleanId = (raw) => { const v = String(raw); return v === v.replace(/[^a-z0-9_-]/gi, '') ? v : null; };
    const profileOf = (req) => String(req.query.profile || 'family').replace(/[^a-z0-9_-]/gi, '');

    // Settings: four plain choices, for this film (override.profilePatch) or everywhere (the profile).
    //   PUT    /:ratingKey/settings {settings}       -> { profilePatch }
    //   DELETE /:ratingKey/settings                  -> { cleared }
    //   PUT    /profiles/:name/settings {settings}   -> { profile }
    // /profiles/... has two segments before /settings, so it never collides with /:ratingKey routes.
    router.put('/profiles/:name/settings', asyncHandler(async (req, res) => {
      const profileName = String(req.params.name).replace(/[^a-z0-9_-]/gi, '').toLowerCase();
      if (!profileName) return res.status(400).json({ error: 'invalid profile' });
      let out;
      try {
        out = await contentFilterScenes.setProfileSettings({ profileName, settings: req.body?.settings });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!out) return res.status(404).json({ error: 'no such profile', profile: profileName });
      res.json(out);
    }));
    router.put('/:ratingKey/settings', asyncHandler(async (req, res) => {
      if (!rk(req)) return res.status(400).json({ error: 'invalid ratingKey' });
      try {
        res.json(await contentFilterScenes.setTitleSettings({ ratingKey: rk(req), settings: req.body?.settings, profileName: profileOf(req) }));
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    }));
    router.delete('/:ratingKey/settings', asyncHandler(async (req, res) => {
      if (!rk(req)) return res.status(400).json({ error: 'invalid ratingKey' });
      res.json(await contentFilterScenes.clearTitleSettings({ ratingKey: rk(req) }));
    }));

    router.get('/:ratingKey/scenes', asyncHandler(async (req, res) => {
      const out = await contentFilterScenes.list({ ratingKey: rk(req), profileName: profileOf(req) });
      if (!out) return res.status(404).json({ error: 'no refined filter', ratingKey: rk(req) });
      res.json(out);
    }));

    router.post('/:ratingKey/scenes/cards', asyncHandler(async (req, res) => {
      const out = await contentFilterScenes.draftCards({
        ratingKey: rk(req), profileName: profileOf(req), all: !!req.body?.all, force: !!req.body?.force,
      });
      if (!out) return res.status(404).json({ error: 'no refined filter', ratingKey: rk(req) });
      res.json(out);
    }));

    router.put('/:ratingKey/scenes/:sceneId', asyncHandler(async (req, res) => {
      const sceneId = cleanId(req.params.sceneId);
      if (sceneId === null) return res.status(400).json({ error: 'invalid id', id: req.params.sceneId });
      const { effect, disabled, card, by } = req.body || {};
      let ruling;
      try {
        if (contentFilterReview && 'nudge' in (req.body || {})) await contentFilterReview.nudgeScene({ ratingKey: rk(req), sceneId, nudge: req.body.nudge });
        ruling = await contentFilterScenes.rule({ ratingKey: rk(req), sceneId, effect, disabled, card, by });
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      if (!ruling) return res.status(404).json({ error: 'no such scene', sceneId });
      res.json({ ruling });
    }));
    router.post('/:ratingKey/scenes/:sceneId/card', asyncHandler(async (req, res) => {
      const sceneId = cleanId(req.params.sceneId);
      if (sceneId === null) return res.status(400).json({ error: 'invalid id', id: req.params.sceneId });
      let out;
      try {
        out = await contentFilterScenes.draftCard({ ratingKey: rk(req), sceneId, profileName: profileOf(req) });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!out) return res.status(404).json({ error: 'no such scene', sceneId });
      res.json(out);
    }));

    router.put('/:ratingKey/cues/:cueId', asyncHandler(async (req, res) => {
      const cueId = cleanId(req.params.cueId);
      if (cueId === null) return res.status(400).json({ error: 'invalid id', id: req.params.cueId });
      const { effect, disabled, card, by } = req.body || {};
      let ruling;
      try {
        if (contentFilterReview && 'nudge' in (req.body || {})) await contentFilterReview.nudgeCue({ ratingKey: rk(req), cueId, nudge: req.body.nudge });
        ruling = await contentFilterScenes.ruleCue({ ratingKey: rk(req), cueId, effect, disabled, card, by });
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      if (!ruling) return res.status(404).json({ error: 'no such cue', cueId });
      res.json({ ruling });
    }));

    router.post('/:ratingKey/cues/:cueId/card', asyncHandler(async (req, res) => {
      const cueId = cleanId(req.params.cueId);
      if (cueId === null) return res.status(400).json({ error: 'invalid id', id: req.params.cueId });
      let out;
      try {
        out = await contentFilterScenes.draftCueCard({ ratingKey: rk(req), cueId, profileName: profileOf(req) });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!out) return res.status(404).json({ error: 'no such cue', cueId });
      res.json(out);
    }));
  }

  if (contentFilterReview) {
    const send = (res, error) => {
      if (!error.status) throw error;
      return res.status(error.status).json({ error: error.message, ...(error.missing ? { missing: error.missing } : {}) });
    };
    const key = (req) => String(req.params.ratingKey).replace(/[^0-9]/g, '');
    const ROW = /^(cue|scene|subject):[A-Za-z0-9_-]+$/;
    // GET /:rk/review -> { title, certification, audit, rows, reviewed, total, job, signOff }
    // A film not matched to Plex: its review (household work at that key stays readable) marked
    // `match: 'unmatched', unmatched: { reason, text }`; with nothing to review, just
    // { title, year, match, unmatched }. Runs stay refused (POST /:rk/jobs).
    router.get('/:ratingKey/review', asyncHandler(async (req, res) => {
      const verdict = contentFilterLibrary?.matchOf ? await contentFilterLibrary.matchOf(key(req)) : null;
      const notMatched = verdict?.match === 'unmatched' ? { match: 'unmatched', unmatched: verdict.unmatched } : null;
      try {
        const review = await contentFilterReview.get({ ratingKey: key(req) });
        // The list is the latest audit's rows: a film with none (never run here) or a stale one,
        // and nothing queued or running, gets its audit now. jobs.audit debounces per film.
        const open = review.job && (review.job.status === 'queued' || review.job.status === 'running');
        const reason = !review.audit ? 'missing' : (!review.audit.fresh && !review.audit.running ? 'stale' : null);
        // Never while one runs or after one failed: the card offers Retry (review 2026-11-12).
        if (jobs?.audit && reason && !open && !review.auditRunning && !review.auditError) {
          logger.info?.('content_filter.review.audit_requested', { ratingKey: key(req), reason });
          jobs.audit(key(req))?.catch?.(() => {});
        }
        res.json(notMatched ? { ...review, ...notMatched } : review);
      } catch (e) {
        if (notMatched && e.status === 404) return res.json({ title: verdict.title, year: verdict.year, ...notMatched });
        send(res, e);
      }
    }));
    // PUT /:rk/review/:rowId { span, by, verdict?, reason?, change?, dwellMs?, replays? } -> { mark }
    // (no verdict = approve). A remove or an in-place change alters what the household gets, so it
    // re-audits the film; DELETE is the undo and reverts whatever the verdict applied.
    const reaudit = (res, rk) => { res.on('finish', () => { if (res.statusCode < 300) jobs?.audit?.(rk)?.catch?.(() => {}); }); };
    router.put('/:ratingKey/review/:rowId', asyncHandler(async (req, res) => {
      if (!ROW.test(req.params.rowId)) return res.status(400).json({ error: 'invalid row id' });
      const b = req.body || {};
      try {
        const mark = await contentFilterReview.setVerdict(key(req), req.params.rowId, {
          verdict: b.verdict ?? 'approve', reason: b.reason, change: b.change, span: b.span, by: b.by, dwellMs: b.dwellMs, replays: b.replays,
        });
        if (b.verdict === 'remove' || b.change || mark.reenabled) reaudit(res, key(req));
        const { reenabled: _re, ...stored } = mark;
        res.json({ mark: stored });
      } catch (e) { send(res, e); }
    }));
    router.delete('/:ratingKey/review/:rowId', asyncHandler(async (req, res) => {
      if (!ROW.test(req.params.rowId)) return res.status(400).json({ error: 'invalid row id' });
      try {
        await contentFilterReview.clearVerdict({ ratingKey: key(req), rowId: req.params.rowId, by: req.body?.by ?? req.query?.by });
        reaudit(res, key(req));
        res.json({ ok: true });
      } catch (e) { send(res, e); }
    }));
    // PUT /:rk/words/:word { value: off|mute|bleep|null } -> this film's ruling for one word
    router.put('/:ratingKey/words/:word', asyncHandler(async (req, res) => {
      try { res.json(await contentFilterReview.setTitleWord({ ratingKey: key(req), word: req.params.word, value: req.body?.value ?? null })); } catch (e) { send(res, e); }
    }));
    // POST /:rk/signoff -> Approve for family (409 with `missing` unless ready); DELETE withdraws.
    router.post('/:ratingKey/signoff', asyncHandler(async (req, res) => {
      try { res.json({ certification: await contentFilterReview.approve({ ratingKey: key(req), by: req.body?.by }) }); } catch (e) { send(res, e); }
    }));
    router.delete('/:ratingKey/signoff', asyncHandler(async (req, res) => {
      try { res.json({ certification: await contentFilterReview.withdraw({ ratingKey: key(req), by: req.body?.by }) }); } catch (e) { send(res, e); }
    }));
  }

  return router;
}

export default createContentFilterRouter;
