/**
 * enrich — stamp title, composer and full provenance into the converted MusicXML.
 *
 * Two audiences. ScorePlayer reads `<work-title>` / `<creator>` for the metadata
 * header it draws itself (OSMD's own title drawing is switched off), and a human
 * auditing the library later needs to know exactly where a file came from and
 * under what licence — so the Mutopia source URL, maintainer and licence go into
 * `<identification><miscellaneous>`, mirroring the traceability convention
 * already used by cli/midi-to-musicxml.mjs.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xmlEscape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Drop any existing element so re-running the import is idempotent. */
function stripTag(xml, tag) {
  return xml.replace(new RegExp(`\\s*<${tag}\\b[\\s\\S]*?</${tag}>`, 'g'), '');
}

/**
 * @param {string} xml   MusicXML from the converter
 * @param {object} prov  provenance() output
 * @param {object} extra {converterVersion, movement, tempo}
 */
export function injectMetadata(xml, prov = {}, extra = {}) {
  let out = String(xml || '');
  if (!/<score-partwise/.test(out)) return out;

  out = stripTag(out, 'work');
  out = stripTag(out, 'identification');

  const title = extra.movement ? `${prov.title} (${extra.movement})` : prov.title;
  const misc = [
    ['mutopia-source-url', prov.sourceUrl],
    ['mutopia-source-path', prov.sourcePath],
    ['mutopia-footer', prov.mutopiaFooter],
    ['license', prov.license],
    ['typesetter', prov.maintainer],
    ['edition-source', prov.source],
    ['style', prov.style],
    ['composed', prov.date],
    ['converter', extra.converterVersion],
    ['tempo-bpm', extra.tempo ? `${extra.tempo.unit}=${extra.tempo.bpm}` : null],
  ].filter(([, v]) => v != null && v !== '');

  const block = [
    '  <work>',
    `    <work-title>${xmlEscape(title || 'Untitled')}</work-title>`,
    '  </work>',
    '  <identification>',
    `    <creator type="composer">${xmlEscape(prov.composerFull || prov.composer || 'Unknown')}</creator>`,
    `    <rights>${xmlEscape(prov.license || 'Public Domain')}</rights>`,
    '    <miscellaneous>',
    ...misc.map(([k, v]) => `      <miscellaneous-field name="${k}">${xmlEscape(v)}</miscellaneous-field>`),
    '    </miscellaneous>',
    '  </identification>',
  ].join('\n');

  // Insert immediately after the opening <score-partwise ...> tag.
  return out.replace(/(<score-partwise[^>]*>)/, `$1\n${block}`);
}

export default { injectMetadata };
