// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import sha256 from 'crypto-js/sha256.js';
import { SheetMusicScoreReader } from './SheetMusicScoreReader.mjs';

const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), '__fixtures__', 'tiny.musicxml');
const nodeSha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

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

    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
      + '<rootfile full-path="score/tiny.xml" media-type="application/vnd.recordare.musicxml+xml"/>'
      + '</rootfiles></container>', 'utf8'));
    zip.addFile('score/tiny.xml', Buffer.from(fixtureXml, 'utf8'));
    fs.writeFileSync(path.join(dir, 'tiny.mxl'), zip.toBuffer());

    const bomZip = new AdmZip();
    bomZip.addFile('score.musicxml', Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fixtureXml, 'utf8')]));
    fs.writeFileSync(path.join(dir, 'bom.mxl'), bomZip.toBuffer());

    // A file saved by an editor that writes a UTF-8 byte-order mark.
    fs.writeFileSync(path.join(dir, 'bom.musicxml'), Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fixtureXml, 'utf8')]));

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

  it('refuses paths outside docs/sheet-music', async () => {
    await expect(reader.read('files:docs/other/x.mxl')).rejects.toThrow();
    await expect(reader.read('docs/sheet-music/t/tiny.musicxml')).rejects.toThrow();
  });

  it('refuses empty, . and .. path segments', async () => {
    for (const id of [
      'files:docs/sheet-music/../other/x.musicxml',
      'files:docs/sheet-music/./t/tiny.musicxml',
      'files:docs/sheet-music//t/tiny.musicxml',
      'files:docs/sheet-music/',
    ]) {
      await expect(reader.read(id), id).rejects.toThrow();
    }
  });

  it('rejects a missing score', async () => {
    await expect(reader.read('files:docs/sheet-music/t/none.musicxml')).rejects.toThrow();
  });
});
