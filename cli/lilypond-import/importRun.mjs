/**
 * importRun — orchestrate one import: source .ly files in, validated MusicXML out.
 *
 *   normalize → convert → validate → enrich → write (+ JSONL ledger)
 *
 * Nothing is written unless it passes the gate, and every outcome (including
 * every rejection and why) lands in the ledger. A rejected score is a reported
 * failure, never a silently skipped one.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalize } from './normalize.mjs';
import { parseHeader, scoreBasename, provenance } from './header.mjs';
import { convertToMusicXml, CONVERTER_VERSION } from './convert.mjs';
import { validateScore } from './validate.mjs';
import { injectMetadata } from './enrich.mjs';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * Convert one source file into 1..n movement documents.
 * Pure except for the injected `convert` function, so it is testable offline.
 *
 * @returns {Promise<Array<{ok, basename, xml, stats, reasons, movement, sourcePath}>>}
 */
export async function convertSource({ src, sourcePath, sourceUrl, convert = convertToMusicXml }) {
  const header = parseHeader(src);
  const prov = provenance({ header, sourcePath, sourceUrl });
  const movements = normalize(src);

  if (!movements.length) {
    return [{
      ok: false, basename: null, xml: null, movement: null, sourcePath,
      stats: null, reasons: ['normalize produced no score (no resolvable staves)'],
    }];
  }

  const results = [];
  for (const [i, mv] of movements.entries()) {
    const label = movements.length > 1
      ? `${ROMAN[i] || i + 1}${mv.hint ? `. ${mv.hint}` : ''}`
      : null;
    const basename = scoreBasename({
      header, sourcePath, movementIndex: i, movementCount: movements.length, hint: mv.hint,
    });

    const { xml, stderr, backendError } = await convert(mv.ly);
    const check = validateScore(xml);
    const reasons = [...check.reasons];
    if (backendError) reasons.push(`backend: ${backendError}`);

    results.push({
      ok: check.ok,
      basename,
      movement: label,
      sourcePath,
      stats: check.stats,
      reasons,
      stderrSample: String(stderr || '').split('\n').filter(Boolean).slice(-3).join(' | ') || null,
      xml: check.ok
        ? injectMetadata(xml, prov, { converterVersion: CONVERTER_VERSION, movement: label, tempo: mv.tempo })
        : null,
    });
  }
  return results;
}

/**
 * Run the whole batch and write what passes.
 * @returns {Promise<{written: number, failed: number, rows: object[]}>}
 */
export async function runImport({ sources, outDir, ledgerPath, dryRun = false, convert = convertToMusicXml, log = () => {} }) {
  const rows = [];
  let written = 0;
  let failed = 0;

  for (const source of sources) {
    const src = await fs.readFile(source.file, 'utf8');
    let results;
    try {
      results = await convertSource({ src, sourcePath: source.sourcePath, sourceUrl: source.sourceUrl, convert });
    } catch (err) {
      results = [{ ok: false, basename: null, reasons: [`threw: ${err?.message || err}`], sourcePath: source.sourcePath, stats: null, xml: null, movement: null }];
    }

    for (const r of results) {
      const row = {
        sourcePath: r.sourcePath, basename: r.basename, movement: r.movement,
        ok: r.ok, reasons: r.reasons, stats: r.stats, stderrSample: r.stderrSample ?? null,
        converter: CONVERTER_VERSION,
      };
      if (r.ok && !dryRun) {
        await fs.mkdir(outDir, { recursive: true });
        const dest = path.join(outDir, `${r.basename}.musicxml`);
        await fs.writeFile(dest, r.xml, 'utf8');
        row.dest = dest;
      }
      if (r.ok) { written += 1; log(`  OK    ${r.basename}  (${r.stats.measures}m ${r.stats.notes}n ${r.stats.fingerings}f)`); }
      else { failed += 1; log(`  FAIL  ${r.basename || r.sourcePath}: ${r.reasons.join('; ')}`); }
      rows.push(row);
    }
  }

  if (ledgerPath && !dryRun) {
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.appendFile(ledgerPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  }
  return { written, failed, rows };
}

export default { convertSource, runImport };
