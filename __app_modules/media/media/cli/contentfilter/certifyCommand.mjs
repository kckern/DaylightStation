/**
 * contentfilter certify <ratingKey> - show a title's refined EDL certification,
 * recompute it, and (with --parent --by NAME --write) record a person's sign-off.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';
import { certify, signOff } from '../../server/domain/content-filter/refine/certification.mjs';
import { applySafeWindows } from '../../server/domain/content-filter/refine/safeWindow.mjs';

export const CERTIFY_USAGE = `Usage: contentfilter certify <ratingKey> [--parent --by <name>] [--write]

Machine certification: every mute covers its word (pinned to ms/frame, or a safe window
wide enough for VidAngel's measured tag drift).
Parent certification: a person signed off on a machine-certified EDL.`;

export function runCertify({ rk, flags, args, mediaFilterDir }) {
  const edl = yaml.load(readFileSync(path.join(mediaFilterDir, 'edl', `${rk}.edl.yml`), 'utf8'));
  const refinedPath = path.join(mediaFilterDir, 'refined', refinedEdlName(edl));
  if (!existsSync(refinedPath)) throw new Error(`No refined EDL for ${rk} (${refinedPath}); it is not certified`);
  const loaded = yaml.load(readFileSync(refinedPath, 'utf8'));
  const refined = { ...loaded, cues: applySafeWindows(loaded.cues || []) };
  const at = new Date().toISOString().slice(0, 10);
  let cert = certify(refined, { at });
  if (args.includes('--parent')) {
    if (!flags.by) throw new Error('--parent needs --by <name>');
    cert = signOff({ ...refined, certification: cert }, { by: String(flags.by), at });
  }
  const { mute, visual } = cert.counts;
  console.error(`${edl.title}: certification ${cert.level} (bar: ${cert.bar})`);
  console.error(`  mutes ${mute.precise} pinned, ${mute.safeWindow} in safe windows, ${mute.approx} uncovered; visual ${visual.precise} precise, ${visual.approx} approximate`);
  if (cert.blocking?.length) console.error(`  approximate mutes: ${cert.blocking.join(', ')}`);
  if (!args.includes('--write')) { console.error('(dry run: pass --write to store it)'); return cert; }
  writeFileSync(refinedPath, yaml.dump({ ...refined, certification: cert }, { lineWidth: 140 }));
  // (cues now carry safe windows for any mute still unpinned)
  console.error(`✓ ${refinedPath}`);
  return cert;
}
