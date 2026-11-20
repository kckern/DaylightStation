// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { YamlPianoStudioDatastore } from '../adapters/YamlPianoStudioDatastore.mjs';
import { createSheetMusicAdminService } from './sheetMusicAdmin.mjs';

const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'adapters', '__fixtures__', 'tiny.musicxml');
const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };

describe('createSheetMusicAdminService (composition)', () => {
  let tmp;
  let pianoConfig;
  let configService;
  let datastore;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sheetmusic-admin-composition-'));
    const media = path.join(tmp, 'media');
    fs.mkdirSync(path.join(media, 'docs/sheet-music/classical/waltzes'), { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(media, 'docs/sheet-music/classical/tiny.musicxml'));
    fs.copyFileSync(FIXTURE, path.join(media, 'docs/sheet-music/classical/waltzes/nested.musicxml'));
    pianoConfig = { sheetmusic: { collections: [{ label: 'Classical', ref: 'files:docs/sheet-music/classical' }] } };
    configService = {
      getMediaDir: () => media,
      getHouseholdAppConfig: (_hid, app) => (app === 'piano' ? pianoConfig : null),
      getHouseholdPath: (rel) => path.join(tmp, 'household', rel),
      getUserDir: (id) => path.join(tmp, 'users', id),
      getHouseholdUsers: () => ['learner1'],
      getUserProfile: () => null,
    };
    datastore = new YamlPianoStudioDatastore({ configService, logger });
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('is null without a media dir, and says so at warn', () => {
    const warnings = [];
    const rootLogger = { ...logger, warn: (event, data) => warnings.push({ event, data }) };
    expect(createSheetMusicAdminService({ configService: { getMediaDir: () => null }, pianoStudioDatastore: datastore, rootLogger })).toBeNull();
    expect(warnings).toEqual([{ event: 'piano.sheetmusic-admin.disabled', data: { reason: 'no-media-dir' } }]);
  });

  it('lists the library from disk with folder and file, nested folders included', async () => {
    const service = createSheetMusicAdminService({ configService, pianoStudioDatastore: datastore, rootLogger: logger });
    const rows = await service.library();
    expect(rows.map(({ id, folder, file }) => ({ id, folder, file }))).toEqual(expect.arrayContaining([
      { id: 'files:docs/sheet-music/classical/tiny.musicxml', folder: 'classical', file: 'tiny.musicxml' },
      { id: 'files:docs/sheet-music/classical/waltzes/nested.musicxml', folder: 'classical/waltzes', file: 'nested.musicxml' },
    ]));
    expect(rows.every((row) => !row.error)).toBe(true);
  });

  it('reads upload folders from the current config each call', async () => {
    const service = createSheetMusicAdminService({ configService, pianoStudioDatastore: datastore, rootLogger: logger });
    expect(await service.uploadFolders()).toEqual(['classical']);
    pianoConfig = { sheetmusic: { collection: 'files:docs/sheet-music/folk' } };
    expect(await service.uploadFolders()).toEqual(['folk']);
  });

  it('uploads an .mxl into the media dir, and the next upload sees it (no stale list)', async () => {
    const service = createSheetMusicAdminService({ configService, pianoStudioDatastore: datastore, rootLogger: logger });
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles>'
      + '<rootfile full-path="s.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'));
    zip.addFile('s.xml', fs.readFileSync(FIXTURE));
    const buffer = zip.toBuffer();
    const result = await service.upload({ buffer, originalName: 'x.mxl', folder: 'classical', filename: 'fresh.mxl' });
    expect(result.id).toBe('files:docs/sheet-music/classical/fresh.mxl');
    expect(fs.readFileSync(path.join(configService.getMediaDir(), 'docs/sheet-music/classical/fresh.mxl'))).toEqual(buffer);
    const again = await service.upload({ buffer, originalName: 'x.mxl', folder: 'classical', filename: 'fresh.mxl' }).then(() => null, (e) => e);
    expect(again?.code).toBe('basename-exists');
  });
  it('saves a generated poster beside the score, and the library row then reads generated', async () => {
    const service = createSheetMusicAdminService({ configService, pianoStudioDatastore: datastore, rootLogger: logger });
    const id = 'files:docs/sheet-music/classical/tiny.musicxml';
    expect((await service.library()).find((row) => row.id === id).poster).toBe('none');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-daylight-poster="generated"><path d="M0 0L1 1"/></svg>';
    const result = await service.savePoster(id, svg);
    expect(result.url).toBe(`/api/v1/proxy/media/stream/${encodeURIComponent('docs/sheet-music/classical/tiny.svg')}`);
    expect(fs.readFileSync(path.join(configService.getMediaDir(), 'docs/sheet-music/classical/tiny.svg'), 'utf8')).toBe(svg);
    expect((await service.library()).find((row) => row.id === id).poster).toBe('generated');
    // A scan dropped in later wins, and a fresh generate is refused.
    fs.writeFileSync(path.join(configService.getMediaDir(), 'docs/sheet-music/classical/tiny.jpg'), 'jpeg');
    await expect(service.savePoster(id, svg)).rejects.toMatchObject({ code: 'has-scan' });
  });
});

const JEV_ID = 'files:docs/sheet-music/classical/x.musicxml';
function jevDeps({ config = {}, gateway = null } = {}) {
  const jevLogger = { child: () => jevLogger, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return {
    configService: { getMediaDir: () => '/media', getHouseholdAppConfig: () => config },
    pianoStudioDatastore: { listSheetMusicIds: () => [], getRoster: () => [], getSheetMusicLearn: () => null },
    rootLogger: jevLogger,
    segmentDecisionGateway: gateway,
  };
}

describe('createSheetMusicAdminService: Jev proposals', () => {
  it('reads sheetmusic.admin.boundaryScorer on each call', () => {
    const config = {};
    const service = createSheetMusicAdminService(jevDeps({ config }));
    expect(service.boundaryScorer()).toBe('heuristic');
    config.sheetmusic = { admin: { boundaryScorer: 'jev' } };
    expect(service.boundaryScorer()).toBe('jev');
  });

  it('has no proposer without a configured gateway', async () => {
    const config = { sheetmusic: { admin: { boundaryScorer: 'jev' } } };
    const off = createSheetMusicAdminService(jevDeps({ config, gateway: { isConfigured: () => false, evaluate: async () => ({}) } }));
    await expect(off.propose(JEV_ID, {})).rejects.toMatchObject({ code: 'jev-unavailable' });
    const none = createSheetMusicAdminService(jevDeps({ config }));
    await expect(none.propose(JEV_ID, {})).rejects.toMatchObject({ code: 'jev-unavailable' });
  });

  it('wires a proposer when the gateway is configured', async () => {
    const config = { sheetmusic: { admin: { boundaryScorer: 'jev' } } };
    const service = createSheetMusicAdminService(jevDeps({ config, gateway: { isConfigured: () => true, evaluate: async () => ({}) } }));
    // Past the gateway check, the input is validated next.
    await expect(service.propose(JEV_ID, { features: [], measureCount: 4 })).rejects.toMatchObject({ code: 'invalid-request' });
  });
});
