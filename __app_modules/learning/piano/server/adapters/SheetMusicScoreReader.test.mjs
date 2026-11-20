// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import sha256 from 'crypto-js/sha256.js';
import { SheetMusicScoreReader, ScoreReadError } from './SheetMusicScoreReader.mjs';

const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), '__fixtures__', 'tiny.musicxml');
const nodeSha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);

/** Rewrites the declared uncompressed size in every local and central header. */
function withDeclaredSize(buffer, size) {
  const out = Buffer.from(buffer);
  for (let i = 0; i <= out.length - 4; i += 1) {
    const signature = out.readUInt32LE(i);
    if (signature === 0x04034b50) out.writeUInt32LE(size, i + 22);
    if (signature === 0x02014b50) out.writeUInt32LE(size, i + 24);
  }
  return out;
}

function mxlOf(xml) {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
    + '<rootfile full-path="score/tiny.xml" media-type="application/vnd.recordare.musicxml+xml"/>'
    + '</rootfiles></container>', 'utf8'));
  zip.addFile('score/tiny.xml', Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

/** Expects read() to reject with a ScoreReadError of this code for this id. */
async function expectCode(reader, scoreId, code) {
  const error = await reader.read(scoreId).then(() => null, (e) => e);
  expect(error, `${scoreId} should reject`).toBeInstanceOf(ScoreReadError);
  expect(error.code).toBe(code);
  expect(error.scoreId).toBe(scoreId);
  return error;
}

describe('SheetMusicScoreReader', () => {
  let tmp;
  let reader;
  let fixtureXml;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'score-reader-'));
    const dir = path.join(tmp, 'docs', 'sheet-music', 't');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(dir, 'tiny.musicxml'));
    fixtureXml = fs.readFileSync(FIXTURE, 'utf8');

    fs.writeFileSync(path.join(dir, 'tiny.mxl'), mxlOf(fixtureXml));

    // A file saved by an editor that writes a UTF-8 byte-order mark.
    fs.writeFileSync(path.join(dir, 'bom.musicxml'), Buffer.concat([BOM_BYTES, Buffer.from(fixtureXml, 'utf8')]));
    const bomZip = new AdmZip();
    bomZip.addFile('score.musicxml', Buffer.concat([BOM_BYTES, Buffer.from(fixtureXml, 'utf8')]));
    fs.writeFileSync(path.join(dir, 'bom.mxl'), bomZip.toBuffer());

    fs.writeFileSync(path.join(dir, 'broken.mxl'), 'not a zip archive at all');
    fs.writeFileSync(path.join(dir, 'bomb.mxl'), withDeclaredSize(mxlOf(fixtureXml), 0xfffffff0));
    fs.mkdirSync(path.join(dir, 'folder.musicxml'));

    // Real scores outside the library, so a missing guard would read them.
    const other = path.join(tmp, 'docs', 'other');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'x.mxl'), mxlOf(fixtureXml));
    fs.copyFileSync(FIXTURE, path.join(other, 'x.musicxml'));
    fs.copyFileSync(FIXTURE, path.join(tmp, 'docs', 'sheet-musical.musicxml'));

    reader = new SheetMusicScoreReader({ mediaDir: tmp });
  });

  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('reads .musicxml text and hashes it like the kiosk', async () => {
    const { xml, contentSha256 } = await reader.read('files:docs/sheet-music/t/tiny.musicxml');
    expect(xml).toContain('<score-partwise');
    expect(xml).toBe(fixtureXml);
    expect(contentSha256).toBe(nodeSha(xml));
  });

  it('reads the root file out of an .mxl archive and hashes the inner XML', async () => {
    const { xml, contentSha256 } = await reader.read('files:docs/sheet-music/t/tiny.mxl');
    expect(xml).toBe(fixtureXml);
    expect(contentSha256).toBe(nodeSha(fixtureXml));
  });

  it('drops a leading UTF-8 BOM, as the browser\'s response.text() does', async () => {
    const plain = await reader.read('files:docs/sheet-music/t/tiny.musicxml');
    const bom = await reader.read('files:docs/sheet-music/t/bom.musicxml');
    expect(bom.xml.charCodeAt(0)).not.toBe(0xfeff);
    expect(bom.xml).toBe(plain.xml);
    expect(bom.contentSha256).toBe(plain.contentSha256);
  });

  it('drops a leading BOM from an .mxl root file too (no container.xml: first score entry)', async () => {
    const { xml, contentSha256 } = await reader.read('files:docs/sheet-music/t/bom.mxl');
    expect(xml).toBe(fixtureXml);
    expect(contentSha256).toBe(nodeSha(fixtureXml));
  });

  it('hashes non-ASCII text exactly as crypto-js does in the kiosk', () => {
    const text = '<work-title>Für Élise — 엘리제를 위하여</work-title>';
    expect(SheetMusicScoreReader.hash(text)).toBe(sha256(text).toString());
  });

  it('refuses ids outside docs/sheet-music with NOT_LIBRARY_SCORE, though the files exist', async () => {
    for (const id of [
      'files:docs/other/x.mxl',
      'files:docs/sheet-musical.musicxml',
      'docs/sheet-music/t/tiny.musicxml',
      'files:docs/sheet-music/../other/x.musicxml',
      'files:docs/sheet-music/./t/tiny.musicxml',
      'files:docs/sheet-music//t/tiny.musicxml',
      'files:docs/sheet-music/',
    ]) {
      const error = await expectCode(reader, id, 'NOT_LIBRARY_SCORE');
      expect(error.message).toMatch(/Not a sheet music score/);
    }
  });

  it('reports a missing score, or a folder where a score should be, as SCORE_NOT_FOUND', async () => {
    const missing = await expectCode(reader, 'files:docs/sheet-music/t/none.musicxml', 'SCORE_NOT_FOUND');
    expect(missing.cause?.code).toBe('ENOENT');
    await expectCode(reader, 'files:docs/sheet-music/t/folder.musicxml', 'SCORE_NOT_FOUND');
  });

  it('reports an archive that will not open as SCORE_UNREADABLE, with the cause', async () => {
    const error = await expectCode(reader, 'files:docs/sheet-music/t/broken.mxl', 'SCORE_UNREADABLE');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('refuses an archive entry that declares a huge size as SCORE_TOO_LARGE', async () => {
    await expectCode(reader, 'files:docs/sheet-music/t/bomb.mxl', 'SCORE_TOO_LARGE');
  });

  it('refuses files over the size caps as SCORE_TOO_LARGE before reading them', async () => {
    const small = new SheetMusicScoreReader({ mediaDir: tmp, maxArchiveBytes: 16, maxXmlBytes: 16 });
    await expectCode(small, 'files:docs/sheet-music/t/tiny.mxl', 'SCORE_TOO_LARGE');
    await expectCode(small, 'files:docs/sheet-music/t/tiny.musicxml', 'SCORE_TOO_LARGE');
  });

  it('never puts the absolute media path in an error message', async () => {
    for (const [id] of [
      ['files:docs/sheet-music/t/none.musicxml'],
      ['files:docs/sheet-music/t/broken.mxl'],
      ['files:docs/sheet-music/t/bomb.mxl'],
      ['files:docs/other/x.mxl'],
    ]) {
      const error = await reader.read(id).then(() => null, (e) => e);
      expect(error.message).not.toContain(tmp);
    }
  });
});

describe('SheetMusicScoreReader.writeScoreExclusive', () => {
  let tmp;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'score-writer-')); });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('writes the bytes to the library path, creating the folder', async () => {
    const reader = new SheetMusicScoreReader({ mediaDir: tmp });
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 8, 7]);
    await reader.writeScoreExclusive('files:docs/sheet-music/fresh/new-tune.mxl', bytes);
    expect(fs.readFileSync(path.join(tmp, 'docs/sheet-music/fresh/new-tune.mxl'))).toEqual(bytes);
  });

  it('refuses to overwrite with code EEXIST and leaves the file alone', async () => {
    const reader = new SheetMusicScoreReader({ mediaDir: tmp });
    const id = 'files:docs/sheet-music/fresh/kept.musicxml';
    await reader.writeScoreExclusive(id, Buffer.from('first'));
    const error = await reader.writeScoreExclusive(id, Buffer.from('second')).then(() => null, (e) => e);
    expect(error?.code).toBe('EEXIST');
    expect(error.scoreId).toBe(id);
    expect(error.message).not.toContain(tmp);
    expect(fs.readFileSync(path.join(tmp, 'docs/sheet-music/fresh/kept.musicxml'), 'utf8')).toBe('first');
  });

  it('refuses ids outside the library', async () => {
    const reader = new SheetMusicScoreReader({ mediaDir: tmp });
    for (const id of ['files:docs/other/x.mxl', 'files:docs/sheet-music/../x.mxl']) {
      const error = await reader.writeScoreExclusive(id, Buffer.from('x')).then(() => null, (e) => e);
      expect(error?.code, id).toBe('NOT_LIBRARY_SCORE');
    }
  });

  it('reports other failures as SCORE_UNWRITABLE', async () => {
    const reader = new SheetMusicScoreReader({ mediaDir: tmp });
    fs.mkdirSync(path.join(tmp, 'docs/sheet-music/blocked'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs/sheet-music/blocked/file'), 'x');
    // A path under a regular file cannot be created.
    const error = await reader.writeScoreExclusive('files:docs/sheet-music/blocked/file/x.mxl', Buffer.from('x')).then(() => null, (e) => e);
    expect(error?.code).toBe('SCORE_UNWRITABLE');
  });
});
