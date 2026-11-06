/**
 * contentfilter migrate-refined <ratingKey> - move a title's refined cue times
 * from its household override (one file's time) into the shareable refined EDL
 * (VidAngel clock), and leave the override with its sync (plus the copy's frame
 * grid) and any person-set keys.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { prepareCopy } from './copySetup.mjs';
import { wordMatcher } from '../../server/domain/content-filter/refine/cueKinds.mjs';
import { wordPairs } from '../../server/domain/content-filter/refine/syncFit.mjs';
import { buildRefinedEdl, anchorsFrom, refinedEdlName, stripRefined } from '../../server/domain/content-filter/refine/refinedEdl.mjs';

export const MIGRATE_USAGE = `Usage: contentfilter migrate-refined <ratingKey> [--src <path|url>] [--write]

Builds refined/<workId>-<tagSetId>.edl.yml from the override's refined cues and
strips them from the override (keeping its sync and person-set keys). Without
--write it prints what it would do.`;

export async function runMigrate({ rk, flags, args, dataFilterDir, mediaFilterDir, loadPlexConfig, getJson }) {
  const edl = yaml.load(readFileSync(path.join(mediaFilterDir, 'edl', `${rk}.edl.yml`), 'utf8'));
  const overridePath = path.join(dataFilterDir, 'overrides', `${rk}.yml`);
  if (!existsSync(overridePath)) throw new Error(`No override for ${rk}`);
  const override = yaml.load(readFileSync(overridePath, 'utf8')) || {};
  const sync = override.sync;
  if (!sync) throw new Error(`Override for ${rk} has no sync; nothing maps its times to the VidAngel clock`);
  const refinedCount = Object.values(override.cueOverrides || {}).filter((o) => o?.refine).length;
  if (!refinedCount) throw new Error(`Override for ${rk} has no refined cues`);

  // The copy the times were measured on: its part, frame grid and transcript (for anchors)
  const part = sync.part ?? Object.values(override.cueOverrides).find((o) => o?.refine)?.refine?.part;
  const { partId, probe, transcript } = await prepareCopy({ rk, flags: { ...flags, part }, mediaFilterDir, loadPlexConfig, getJson, verb: 'Migrating' });
  const frames = { fps: String(probe.fps), startTime: probe.startTime || 0 };

  const tags = (edl.cues || []).filter((c) => c.type === 'mute').map((c) => ({ t: c.in, id: c.id, match: wordMatcher(c) })).filter((t) => t.match);
  const { pairs } = wordPairs(tags, transcript.words);
  const refinedById = Object.fromEntries(Object.entries(override.cueOverrides).filter(([, o]) => o?.refine && o.precision === 'ms'));
  const anchors = anchorsFrom({ pairs, words: transcript.words, segments: transcript.segments, sync, refinedById });
  const refined = buildRefinedEdl({ edl, cueOverrides: override.cueOverrides, sync, anchors, refinedFrom: { runtimeSec: probe.duration, ...frames } });

  const { cueOverrides, removed } = stripRefined(override.cueOverrides);
  const next = { ...override, sync: { ...sync, part: String(partId), frames }, cueOverrides };
  if (!Object.keys(cueOverrides).length) delete next.cueOverrides;
  const refinedPath = path.join(mediaFilterDir, 'refined', refinedEdlName(edl));
  console.error(`${refined.timebase.refinedCount} refined cues, ${anchors.length} anchors -> ${refinedPath}`);
  console.error(`override: ${removed} refined entries removed, ${Object.keys(cueOverrides).length} kept; sync gains frames ${frames.fps} @ ${frames.startTime}`);
  if (!args.includes('--write')) { console.error('(dry run: pass --write)'); return { refined, override: next }; }
  mkdirSync(path.dirname(refinedPath), { recursive: true });
  writeFileSync(refinedPath, yaml.dump(refined, { lineWidth: 140 }));
  writeFileSync(overridePath, yaml.dump(next, { lineWidth: 140 }));
  console.error(`✓ ${refinedPath}\n✓ ${overridePath}`);
  return { refined, override: next };
}
