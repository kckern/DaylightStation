/**
 * Compressed MusicXML (.mxl) is a ZIP whose META-INF/container.xml names the
 * root score file. Shared by the media proxy, which serves .mxl scores to the
 * kiosk decompressed, and the piano admin, which must hash exactly that text.
 *
 * Node-only: never import from browser code; the bundler would emit an adm-zip
 * chunk that requires fs/zlib. A root-level server file with no declared layer,
 * so both the proxy adapter and the piano adapter may import it (one adapter
 * family may not import another's).
 */

/** Largest decompressed entry this will read: a big orchestral score is a few MB. */
export const MAX_MXL_XML_BYTES = 32 * 1024 * 1024;

function tooLarge(name, bytes, max) {
  const error = new Error(`MusicXML entry "${name}" is too large: ${bytes} bytes (limit ${max})`);
  error.code = 'MXL_TOO_LARGE';
  return error;
}

/**
 * Reads one entry as UTF-8 text. The declared size is checked before inflating,
 * and the real length after, in case the header understates it.
 */
function entryText(entry, maxXmlBytes) {
  if (entry.header.size > maxXmlBytes) throw tooLarge(entry.entryName, entry.header.size, maxXmlBytes);
  const data = entry.getData();
  if (data.length > maxXmlBytes) throw tooLarge(entry.entryName, data.length, maxXmlBytes);
  return data.toString('utf-8');
}

/** Extract MusicXML text from a compressed score archive. */
export async function extractMusicXmlFromMxl(buffer, { maxXmlBytes = MAX_MXL_XML_BYTES } = {}) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);
  const container = zip.getEntry('META-INF/container.xml');
  if (container) {
    const xml = entryText(container, maxXmlBytes);
    const match = xml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const rootPath = match && (match[1] || match[2]);
    if (rootPath) {
      const entry = zip.getEntry(rootPath);
      if (entry) return entryText(entry, maxXmlBytes);
    }
  }
  const entry = zip.getEntries().find((candidate) =>
    !candidate.entryName.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(candidate.entryName));
  if (entry) return entryText(entry, maxXmlBytes);
  throw new Error('No MusicXML entry found in .mxl archive');
}
