/**
 * contentfilter stack-scan [--profile <name>] [--json]
 *
 * Which films have stacked picture effects (a whole-frame blur with regional blurs on top, an
 * identical pair, a blur under a blackout ...)? For every film with a REFINED EDL, runs the
 * player's resolver WITHOUT the precedence pass (`stackGuard: false`, what the child saw before
 * the guardrail) and again with it, and lists the film ids with the number of overlapping groups
 * for each. `after` must be 0 everywhere. Read-only; prints ids and counts only.
 */
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { resolveEffectiveCues, pictureOverlaps } from '../../browser/content-filter/contentFilter.js';
import { loadCascade } from './auditCommand.mjs';

export const STACK_SCAN_USAGE = 'Usage: contentfilter stack-scan [--profile <name>] [--json]\n\n'
  + 'List the films whose current refined EDL has overlapping picture effects: overlapping groups\n'
  + 'as composed without the precedence pass (before) and with it (after, must be 0). Read-only.';

/** Pure: one film's counts. */
export function scanFilm({ edl, profile, override }) {
  const before = pictureOverlaps(resolveEffectiveCues({ edl, profile, override, stackGuard: false }));
  const after = pictureOverlaps(resolveEffectiveCues({ edl, profile, override }));
  return { before: before.length, after: after.length };
}

export function runStackScan({ flags = {}, mediaFilterDir, dataFilterDir }) {
  const dir = path.join(mediaFilterDir, 'edl');
  if (!existsSync(dir)) throw new Error(`No EDL folder (${dir})`);
  const films = [];
  let scanned = 0;
  for (const f of readdirSync(dir).filter((n) => /^\d+\.edl\.yml$/.test(n)).sort()) {
    const rk = f.split('.')[0];
    let cascade;
    try { cascade = loadCascade({ rk, flags, mediaFilterDir, dataFilterDir }); } catch { continue; }
    if (!cascade.refined) continue;
    scanned++;
    const { before, after } = scanFilm(cascade);
    if (before || after) films.push({ rk, before, after });
  }
  return { scanned, stacked: films.length, remaining: films.filter((x) => x.after).length, films };
}

export function formatStackScan(r) {
  const out = [`${r.stacked} of ${r.scanned} refined films have stacked picture effects before the guardrail; ${r.remaining} after`];
  for (const f of r.films) out.push(`  ${f.rk}  before ${f.before}  after ${f.after}`);
  return out.join('\n');
}
