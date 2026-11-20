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

  it('is null without a media dir', () => {
    expect(createSheetMusicAdminService({ configService: { getMediaDir: () => null }, pianoStudioDatastore: datastore, rootLogger: logger })).toBeNull();
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
});
