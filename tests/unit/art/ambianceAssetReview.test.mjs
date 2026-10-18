import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Jimp } from 'jimp';
import { createArtAdapter } from '../../../__app_modules/media/art/server/adapters/ArtAdapter.mjs';
import { AmbianceService } from '../../../__app_modules/media/art/server/application/AmbianceService.mjs';
import * as audit from '../../../__app_modules/media/art/cli/ambianceAudit.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(meta = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ambiance-fingerprint-')); roots.push(root);
  const work = path.join(root, 'art', 'sacred', 'Work'); await mkdir(work, { recursive: true });
  const bytes = await new Jimp({ width: 20, height: 30, color: 0x668866ff }).getBuffer('image/png');
  await writeFile(path.join(work, 'work.png'), bytes);
  await writeFile(path.join(work, 'metadata.yaml'), JSON.stringify({ title: 'Work', width: 20, height: 30, ...meta }));
  const record = { themes: ['peace'], seasons: [], energy: 0, intensity: 1, mediumKind: 'painting', review: {
    status: 'approved', profiles: ['quiet'], reviewer: 'curator', reviewedAt: '2026-01-01', reason: 'Viewed exact image',
    evidence: [{ kind: 'visual', path: 'art/sacred/Work/work.png', sha256: createHash('sha256').update(bytes).digest('hex') }],
  } };
  const catalog = { version: 1, profiles: { quiet: { maxEnergy: 1, maxIntensity: 2, allowedMedia: ['painting'], fallbackArtIds: ['sacred/Work'] } },
    tracks: { 'plex:101': record }, artworks: { 'sacred/Work': record } };
  const adapter = createArtAdapter({ imgBasePath: root, logger: { info() {}, warn() {} }, recencyStore: null });
  const service = new AmbianceService({ catalog: { load: async () => catalog }, artworkSource: adapter });
  return { root, work, catalog, service };
}

describe('reviewed asset freshness', () => {
  it('rejects an artwork whose bytes do not match the visual review, including fallback', async () => {
    const { catalog, service } = await fixture();
    catalog.artworks['sacred/Work'].review.evidence[0].sha256 = '0'.repeat(64);
    expect(await service.match({ profile: 'quiet', trackId: 'plex:101' })).toMatchObject({ mode: 'neutral', panels: [] });
  });
  it('rejects an image deleted after the source and color caches are warm', async () => {
    const { work, service } = await fixture();
    expect((await service.match({ profile: 'quiet', trackId: 'plex:101' })).mode).toBe('single');
    await rm(path.join(work, 'work.png'));
    expect(await service.match({ profile: 'quiet', trackId: 'plex:101' })).toMatchObject({ mode: 'neutral', panels: [] });
  });
  it('audits hidden assets through the same resolution as runtime', async () => {
    const { root, catalog, service } = await fixture({ hidden: true });
    expect((await service.match({ profile: 'quiet', trackId: 'plex:101' })).mode).toBe('neutral');
    const report = await audit.auditAmbianceLibrary({ catalog, profile: 'quiet', trackIds: ['plex:101'], artRoot: path.join(root, 'art') });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({ kind: 'missing-art', id: 'sacred/Work' });
    expect(report.coverage[0].kind).toBe('neutral');
  });
});
