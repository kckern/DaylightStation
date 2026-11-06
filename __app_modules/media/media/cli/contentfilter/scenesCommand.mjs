/**
 * contentfilter scenes <ratingKey> --src <file> [--same-scene] [--out <json>] [--write]
 *
 * Group a title's refined tags into scenes (edges on shot cuts, situation and
 * picture levels per group, all judged by the decision model) and, with
 * --write, store them as `scenes:` in the refined EDL. Re-runs keep scene ids
 * (and so the household's sceneOverrides) when the members mostly match.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { FfmpegRefineMedia } from '../../server/adapters/content-filter/FfmpegRefineMedia.mjs';
import { SceneBuilder } from '../../server/application/content-filter/refine/SceneBuilder.mjs';
import { carryForward } from '../../server/domain/content-filter/refine/scenes.mjs';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';

export const SCENES_USAGE = `Usage: contentfilter scenes <ratingKey> --src <file> [--same-scene] [--out <json>] [--write] [--trust situation,picture --evidence <ref>]

--trust records which axes calibration showed can be acted on (sceneCalibration);
the player uses an untrusted axis for nothing. Without it the stored value is kept.`;
const GROUP_SHORT = { violence_blood_gore: 'violence', sex_nudity_immodesty: 'nudity', sex_any: 'sexual' };

export async function runScenes({ rk, flags, args, mediaFilterDir, dataFilterDir, getDecisionGateway }) {
  if (!flags.src) throw new Error('scenes needs --src <media file>');
  const edl = yaml.load(readFileSync(path.join(mediaFilterDir, 'edl', `${rk}.edl.yml`), 'utf8'));
  const refinedPath = path.join(mediaFilterDir, 'refined', refinedEdlName(edl));
  if (!existsSync(refinedPath)) throw new Error(`No refined EDL for ${rk}; run refine first`);
  const refined = yaml.load(readFileSync(refinedPath, 'utf8'));
  const override = yaml.load(readFileSync(path.join(dataFilterDir, 'overrides', `${rk}.yml`), 'utf8')) || {};
  if (!override.sync) throw new Error(`Override for ${rk} has no sync`);
  const workDir = path.join(mediaFilterDir, 'refine', rk);
  const wordsPath = path.join(workDir, `words-${override.sync.part}.json`);
  const segments = existsSync(wordsPath) ? JSON.parse(readFileSync(wordsPath, 'utf8')).segments || [] : [];
  if (!segments.length) console.error(`⚠ no transcript at ${wordsPath}: situations are judged from tags alone`);

  const decisions = await getDecisionGateway({ logger: { debug() {}, info() {}, warn: console.warn, error: console.error } });
  if (!decisions) throw new Error('No decision model configured (system auth jev.api_key).');
  mkdirSync(workDir, { recursive: true });
  const builder = new SceneBuilder({
    media: new FfmpegRefineMedia(), decisions, src: flags.src, sync: override.sync, segments, title: edl.title,
    log: (e) => appendFileSync(path.join(workDir, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...e })}\n`),
    options: { sameScene: args.includes('--same-scene') },
  });
  const built = await builder.build(refined.cues || []);
  const { scenes, remaps } = carryForward(refined.scenes || [], built);
  for (const r of remaps) appendFileSync(path.join(workDir, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), step: 'scene-id-remap', ...r })}\n`);

  for (const s of scenes) {
    const lv = Object.entries(s.level).map(([g, l]) => `${GROUP_SHORT[g] || g} ${l.situation}/${l.picture}`).join(', ');
    console.error(`  ${s.id} ${fmt(s.in)}–${fmt(s.out)} (${s.edges}) ${s.cues.length} tags: ${lv}`);
  }
  console.error(`${scenes.length} scenes${remaps.length ? `, ${remaps.length} ids carried over` : ''}`);
  if (flags.out) writeFileSync(String(flags.out), JSON.stringify({ rk, title: edl.title, scenes }, null, 1));
  if (!args.includes('--write')) { console.error('(dry run: pass --write to store them in the refined EDL)'); return scenes; }
  let sceneCalibration = refined.sceneCalibration;
  if (flags.trust) {
    const trusted = new Set(String(flags.trust).split(',').map((a) => a.trim()));
    sceneCalibration = {
      situation: trusted.has('situation') ? 'trusted' : 'untrusted',
      picture: trusted.has('picture') ? 'trusted' : 'untrusted',
      at: new Date().toISOString().slice(0, 10),
      ...(flags.evidence ? { evidence: String(flags.evidence) } : {}),
    };
  }
  writeFileSync(refinedPath, yaml.dump({ ...refined, scenes, ...(sceneCalibration ? { sceneCalibration } : {}) }, { lineWidth: 140 }));
  console.error(`✓ ${refinedPath}`);
  return scenes;
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
