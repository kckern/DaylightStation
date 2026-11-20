/**
 * Compressed MusicXML (.mxl) is a ZIP whose META-INF/container.xml names the
 * root score file. Shared by the media proxy, which serves .mxl scores to the
 * kiosk decompressed, and the piano admin, which must hash exactly that text.
 *
 * Portable so both server owners can share it (one adapter family may not import
 * another's). adm-zip is loaded lazily and needs Node's Buffer, so call this from
 * server code only; importing the module costs browsers nothing.
 */

/** Extract MusicXML text from a compressed score archive. */
export async function extractMusicXmlFromMxl(buffer) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);
  const container = zip.getEntry('META-INF/container.xml');
  if (container) {
    const xml = container.getData().toString('utf-8');
    const match = xml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const rootPath = match && (match[1] || match[2]);
    if (rootPath) {
      const entry = zip.getEntry(rootPath);
      if (entry) return entry.getData().toString('utf-8');
    }
  }
  const entry = zip.getEntries().find((candidate) =>
    !candidate.entryName.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(candidate.entryName));
  if (entry) return entry.getData().toString('utf-8');
  throw new Error('No MusicXML entry found in .mxl archive');
}
