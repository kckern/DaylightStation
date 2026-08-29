import express from 'express';
import path from 'node:path';
import { splatPath } from '#api/utils/wildcard.mjs';

const STATUS = { definition_not_found: 404, experience_not_found: 404, session_not_found: 404, revision_conflict: 409, idempotency_conflict: 409, session_terminal: 409, authorization_denied: 403, journal_corrupt: 500, invalid_contract: 400, invalid_definition: 422, invalid_session_setup: 422, experience_manifest_invalid: 422, surface_required: 422, surface_incompatible: 422, authority_incompatible: 422, rule_rejected: 422, illegal_command: 422, invalid_wager: 422, invalid_dice_notation: 422, no_selection_candidates: 422, verifier_required: 422 };

const HOST_ROLES = new Set(['sysadmin', 'parent', 'gaming-host']);

export function authenticatedGamingViewer(req) {
  const roles = new Set([...(req.roles || []), ...(req.user?.roles || [])].map(String));
  const participantId = req.user?.sub ? String(req.user.sub) : null;
  if ([...roles].some((role) => HOST_ROLES.has(role))) {
    return { role: 'host', participant_id: participantId };
  }
  return participantId ? { role: 'participant', participant_id: participantId } : {};
}

function requireViewer(req) {
  const viewer = authenticatedGamingViewer(req);
  if (!viewer.role) throw Object.assign(new Error('Gaming authentication is required'), { code: 'authentication_required', status: 401 });
  return viewer;
}

function requireHost(req) {
  const viewer = requireViewer(req);
  if (viewer.role !== 'host') throw Object.assign(new Error('Gaming host authority is required'), { code: 'authorization_denied', status: 403 });
  return viewer;
}

export function createGamingRouter({ gamingApplication, assetCatalog = null, mediaPartyGamesDir = null, broadcastEvent = null, logger = null }) {
  if (!gamingApplication) throw new Error('createGamingRouter: gamingApplication required');
  const router = express.Router();
  const handle = (operation) => async (req, res) => {
    try { await operation(req, res); }
    catch (error) {
      const status = Number(error.status) || STATUS[error.code] || 500;
      logger?.[status >= 500 ? 'error' : 'warn']?.('gaming.api.error', { code: error.code || 'internal_error', status, message: error.message });
      res.status(status).json({ error: error.code || 'internal_error', message: status >= 500 ? 'Gaming request failed' : error.message, ...(error.details ? { details: error.details } : {}) });
    }
  };

  router.get('/definitions/:definitionId', handle(async (req, res) => { requireHost(req); return res.json(await gamingApplication.getDefinition(req.params.definitionId)); }));
  router.get('/launch/:definitionId', handle(async (req, res) => { requireViewer(req); return res.json(await gamingApplication.getLaunchDescriptor(req.params.definitionId, { surfaceId: req.query.surface || null, authorityMode: req.query.authority || null })); }));
  router.get('/catalog', handle((req, res) => { requireViewer(req); return res.json({ experiences: gamingApplication.listExperienceCatalog(req.query.surface || null) }); }));
  router.get('/experiences', handle((req, res) => { requireViewer(req); return res.json({ experiences: gamingApplication.listExperienceManifests() }); }));
  router.get('/experiences/:experienceId/manifest', handle((req, res) => { requireViewer(req); return res.json(gamingApplication.getExperienceManifest(req.params.experienceId)); }));
  router.get('/environments/party-games/profile', handle((req, res) => { requireHost(req); return res.json(gamingApplication.getEnvironmentProfile()); }));
  router.get('/environments/party-games/catalog', handle((req, res) => { requireHost(req); return res.json({ entries: gamingApplication.listPartyGamesCatalog() }); }));
  router.get('/experiences/:experienceId/content', handle((req, res) => { requireHost(req); return res.json({ content: gamingApplication.listContent(req.params.experienceId) }); }));
  router.get('/experiences/:experienceId/content/:contentId', handle((req, res) => { requireHost(req); return res.json(gamingApplication.getContent(req.params.experienceId, req.params.contentId)); }));

  router.post('/sessions', handle(async (req, res) => {
    const body = req.body || {};
    const viewer = requireViewer(req);
    if (typeof body.definition_id !== 'string') return res.status(400).json({ error: 'definition_id_required' });
    const participants = body.participants || [];
    if (viewer.role !== 'host' && (participants.length === 0
      || participants.some((participant) => String(participant.id || participant.user_id || '') !== viewer.participant_id)
      || (body.seats || []).length > 0)) {
      throw Object.assign(new Error('Participants may create only an unseated session for themselves'), { code: 'authorization_denied', status: 403 });
    }
    res.status(201).json(await gamingApplication.createSession({
      definitionId: body.definition_id, surfaceId: body.surface_id, participants, seats: body.seats || [], setup: body.setup || {}, seed: body.seed, viewer,
    }));
  }));
  router.get('/sessions/:sessionId', handle(async (req, res) => res.json(await gamingApplication.resumeSession(req.params.sessionId, requireViewer(req)))));
  router.post('/sessions/:sessionId/commands', handle(async (req, res) => {
    if (!req.body?.command_id) return res.status(400).json({ error: 'command_envelope_required' });
    const result = await gamingApplication.dispatch(req.params.sessionId, req.body, requireViewer(req));
    broadcastEvent?.({ source: 'gaming-authority', topic: 'gaming', kind: 'session-updated', sessionId: req.params.sessionId, rulesetId: result.header.ruleset.id, revision: result.header.revision, ts: Date.now() });
    res.json(result);
  }));
  router.post('/sessions/:sessionId/close', handle(async (req, res) => { requireHost(req); return res.json(await gamingApplication.closeSession(req.params.sessionId, req.body || {})); }));
  router.get('/sessions/:sessionId/effects', handle(async (req, res) => { requireHost(req); return res.json({ effects: await gamingApplication.listEffects(req.params.sessionId) }); }));
  router.get('/sessions/:sessionId/drawing-checkpoint', handle(async (req, res) => res.json(await gamingApplication.getDrawingCheckpoint(req.params.sessionId, requireViewer(req)))));
  router.put('/sessions/:sessionId/drawing-checkpoint', handle(async (req, res) => res.json(await gamingApplication.putDrawingCheckpoint(req.params.sessionId, { strokes: req.body?.strokes }, requireViewer(req)))));
  router.delete('/sessions/:sessionId/drawing-checkpoint', handle(async (req, res) => res.json(await gamingApplication.deleteDrawingCheckpoint(req.params.sessionId, requireViewer(req)))));
  router.post('/sessions/:sessionId/host-packet/print', handle(async (req, res) => { requireHost(req); return res.json(await gamingApplication.printHostPacket(req.params.sessionId, { explicit: true })); }));

  router.get('/media/*splat', handle((req, res) => {
    requireViewer(req);
    if (!mediaPartyGamesDir) return res.status(404).json({ error: 'media_not_configured' });
    const root = path.resolve(mediaPartyGamesDir); const file = path.resolve(root, splatPath(req));
    if (!file.startsWith(`${root}${path.sep}`)) return res.status(404).json({ error: 'media_not_found' });
    return res.sendFile(file, (error) => { if (error && !res.headersSent) res.status(404).json({ error: 'media_not_found' }); });
  }));

  router.get('/assets/:packId', handle((req, res) => {
    requireViewer(req);
    if (!assetCatalog) return res.status(404).json({ error: 'asset_catalog_unavailable' });
    const catalog = assetCatalog.get(req.params.packId); if (!catalog) return res.status(404).json({ error: 'asset_pack_not_found' });
    const assets = Object.fromEntries(Object.entries(catalog.assets).filter(([, asset]) => asset.status === 'approved').map(([id, asset]) => {
      const { source, source_sha256: ignoredHash, provenance, distribution, ...publicAsset } = asset; void source; void ignoredHash; void provenance; void distribution;
      return [id, { ...publicAsset, image_url: `/api/v1/gaming/assets/${encodeURIComponent(req.params.packId)}/${encodeURIComponent(id)}/image` }];
    }));
    res.json({ schema_version: catalog.schema_version, pack: catalog.pack, assets });
  }));
  router.get('/assets/:packId/:assetId/image', handle((req, res) => {
    requireViewer(req);
    if (!assetCatalog) return res.status(404).json({ error: 'asset_catalog_unavailable' });
    const asset = assetCatalog.getAsset(req.params.packId, req.params.assetId); if (!asset) return res.status(404).json({ error: 'asset_not_found' });
    const etag = `"${asset.source_sha256}"`; res.set({ ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
    if (req.headers?.['if-none-match'] === etag) return res.status(304).end(); return res.type('png').sendFile(asset.file);
  }));
  return router;
}

export default createGamingRouter;
