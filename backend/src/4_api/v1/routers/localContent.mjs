import { sendInternalError } from '#api/utils/internalError.mjs';
/** Deprecated legacy local-content HTTP translation. Sunset: 2026-08-01. */
import express from 'express';
import { splatPath } from '#api/utils/wildcard.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { sendLocalFileResource } from '#system/http/streamFile.mjs';

const unconfigured = (res) => sendInternalError(res, { error: 'LocalContent adapter not configured' });

export function createLocalContentRouter({ localContentService, sendFileResource = sendLocalFileResource }) {
  if (!localContentService) throw new Error('createLocalContentRouter requires localContentService');
  const router = express.Router();

  router.get('/scripture/*splat', asyncHandler(async (req, res) => {
    const outcome = await localContentService.getScripture(splatPath(req));
    if (outcome.kind === 'unconfigured') return unconfigured(res);
    if (outcome.kind === 'invalid') return res.status(400).json({ error: 'Invalid scripture reference', input: outcome.input });
    if (outcome.kind === 'not_found') return res.status(404).json({ error: 'Scripture not found', input: outcome.input, resolved: outcome.resolved });
    const value = outcome.value;
    return res.json({
      input: value.input,
      reference: value.reference,
      volume: value.volume,
      version: value.version,
      verse_id: value.verseId,
      assetId: value.assetId,
      mediaUrl: `/api/v1/proxy/local-content/stream/scripture/${value.assetId}`,
      duration: value.duration,
      verses: value.verses,
    });
  }));

  router.get('/hymn/:number', asyncHandler(async (req, res) => {
    const outcome = await localContentService.getHymn(req.params.number);
    if (outcome.kind === 'unconfigured') return unconfigured(res);
    if (outcome.kind === 'not_found') return res.status(404).json({ error: 'Hymn not found', number: outcome.number });
    const value = outcome.value;
    return res.json({
      title: value.title,
      number: value.number,
      hymn_num: value.number,
      assetId: value.assetId,
      verses: value.verses,
      mediaUrl: `/api/v1/proxy/local-content/stream/hymn/${req.params.number}`,
      duration: value.duration,
    });
  }));

  router.get('/primary/:number', asyncHandler(async (req, res) => {
    const outcome = await localContentService.getPrimary(req.params.number);
    if (outcome.kind === 'unconfigured') return unconfigured(res);
    if (outcome.kind === 'not_found') return res.status(404).json({ error: 'Primary song not found', number: outcome.number });
    const value = outcome.value;
    return res.json({
      title: value.title,
      number: value.number,
      song_number: value.number,
      verses: value.verses,
      mediaUrl: `/api/v1/proxy/local-content/stream/primary/${req.params.number}`,
      duration: value.duration,
    });
  }));

  router.get('/talk/*splat', asyncHandler(async (req, res) => {
    const outcome = await localContentService.getTalk(splatPath(req));
    if (outcome.kind === 'unconfigured') return unconfigured(res);
    if (outcome.kind === 'not_found') {
      const error = outcome.reason === 'no_playable_talks'
        ? 'No playable talks found in conference'
        : 'Talk not found';
      return res.status(404).json({ error, path: outcome.path });
    }
    return res.json(outcome.value);
  }));

  router.get('/poem/*splat', asyncHandler(async (req, res) => {
    const outcome = await localContentService.getPoem(splatPath(req));
    if (outcome.kind === 'unconfigured') return unconfigured(res);
    if (outcome.kind === 'not_found') return res.status(404).json({ error: 'Poem not found', path: outcome.path });
    const value = outcome.value;
    return res.json({
      title: value.title,
      author: value.author,
      condition: value.condition,
      also_suitable_for: value.alsoSuitableFor,
      poem_id: value.poemId,
      assetId: value.assetId,
      mediaUrl: value.mediaUrl,
      duration: value.duration,
      verses: value.verses,
    });
  }));

  router.get('/cover{/*splat}', asyncHandler(async (req, res) => {
    const outcome = await localContentService.getCover(splatPath(req));
    if (outcome.kind === 'invalid') return res.status(400).json({ error: 'No media key provided' });
    const image = outcome.value;
    res.set({
      'Content-Type': image.mimeType,
      'Content-Length': image.buffer.length,
      'Cache-Control': 'public, max-age=86400',
    });
    return res.send(image.buffer);
  }));

  const serveCollectionCover = asyncHandler(async (req, res) => {
    const outcome = localContentService.getCollectionCover(req.params.adapter, req.params.collection, splatPath(req));
    if (outcome.kind === 'unsupported') return res.status(404).json({ error: 'Adapter not found or does not support cover images' });
    if (outcome.kind === 'not_found') {
      return res.status(404).json({ error: 'No cover image found', collection: outcome.collection, subPath: outcome.subPath });
    }
    res.set('Content-Type', outcome.value.resource.mimeType);
    res.set('Cache-Control', 'public, max-age=86400');
    return sendFileResource(req, res, outcome.value.resource);
  });
  router.get('/collection-cover/:adapter/:collection/*splat', serveCollectionCover);
  router.get('/collection-cover/:adapter/:collection', serveCollectionCover);

  router.get('/collection-icon/:adapter/:collection', asyncHandler(async (req, res) => {
    const outcome = localContentService.getCollectionIcon(req.params.adapter, req.params.collection);
    if (outcome.kind === 'unsupported') return res.status(404).json({ error: 'Adapter not found or does not support icons' });
    if (outcome.kind === 'not_found') return res.status(404).json({ error: 'No icon found for collection', collection: outcome.collection });
    res.set('Content-Type', outcome.value.resource.mimeType);
    res.set('Cache-Control', 'public, max-age=86400');
    return sendFileResource(req, res, outcome.value.resource);
  }));

  router.get('/collection/:name', asyncHandler(async (req, res) => {
    const outcome = await localContentService.getCollection(req.params.name);
    if (outcome.kind === 'unconfigured') return unconfigured(res);
    return res.json({ collection: outcome.value.name, items: outcome.value.items });
  }));

  return router;
}

export default createLocalContentRouter;
