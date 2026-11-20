// @vitest-environment node
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { extractMusicXmlFromMxl, MAX_MXL_XML_BYTES } from './mxlArchive.mjs';

function withDeclaredSize(buffer, size) {
  const out = Buffer.from(buffer);
  for (let i = 0; i <= out.length - 4; i += 1) {
    const signature = out.readUInt32LE(i);
    if (signature === 0x04034b50) out.writeUInt32LE(size, i + 22);
    if (signature === 0x02014b50) out.writeUInt32LE(size, i + 24);
  }
  return out;
}

const XML = `<score-partwise>${'<measure/>'.repeat(300)}</score-partwise>`;

function storedZip() {
  const zip = new AdmZip();
  zip.addFile('score.musicxml', Buffer.from(XML, 'utf8'));
  zip.getEntry('score.musicxml').header.method = 0; // STORED: output = bytes present
  return zip.toBuffer();
}

describe('extractMusicXmlFromMxl', () => {
  it('caps the XML at 32 MB by default', () => {
    expect(MAX_MXL_XML_BYTES).toBe(32 * 1024 * 1024);
  });

  it('returns the score entry text', async () => {
    expect(await extractMusicXmlFromMxl(storedZip())).toBe(XML);
  });

  it('refuses an entry whose declared size is over the cap, before inflating it', async () => {
    const error = await extractMusicXmlFromMxl(withDeclaredSize(storedZip(), 0xfffffff0)).then(() => null, (e) => e);
    expect(error?.code).toBe('MXL_TOO_LARGE');
    expect(error.message).toMatch(/too large/i);
  });

  it('checks the real size after reading too, when the declared size lies low', async () => {
    const lying = withDeclaredSize(storedZip(), 10);
    const error = await extractMusicXmlFromMxl(lying, { maxXmlBytes: 100 }).then(() => null, (e) => e);
    expect(error?.code).toBe('MXL_TOO_LARGE');
  });
});
