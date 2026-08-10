#!/usr/bin/env node
// Curated, deterministic starter material installed into the mounted media tree.
import { cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { buildManifest } from '../backend/src/3_applications/piano/loopManifest.mjs';

const POP = 'chords/I⠃-V⠃-vi⠃-IV⠃.musicxml';
const VERSE = 'chords/I⠇-V⠟-vi⠇-IV⠟.musicxml';
const CHORUS = 'chords/I⠏-V⠏-vi⠇-IV⠟.musicxml';
const WALTZ = 'chords/I⠿-V⠃-vi⠏-IV⠏.musicxml';
const FAILED_LOFI = 'chords/i⠏-bIII⠏-iii°⠏-IV⠏-#iv°⠏-v⠏-iii°⠏-bIII⠏.musicxml';
const LOFI = 'chords/i⠏-v⠏-c542db.musicxml';
const BASS = 'basslines/I⠃-V⠃.musicxml';

const CURATED_REPAIRS = Object.freeze([
  { kind: 'stacks', id: 'lofi-groove-bed', from: FAILED_LOFI, to: LOFI },
]);

export const CURATED_PREFABS = Object.freeze({
  stacks: [
    {
      id: 'rock-rehearsal', title: 'Rock rehearsal', author: 'curated', kind: 'stack',
      layers: [
        { path: POP, role: 'chords', gain: 0.9 },
        { path: BASS, role: 'bass', gain: 0.9 },
        { path: 'percussion/rock-8ths.musicxml', role: 'groove', gain: 0.82 },
      ],
    },
    {
      id: 'latin-pocket', title: 'Latin pocket', author: 'curated', kind: 'stack',
      layers: [
        { path: VERSE, role: 'chords', gain: 0.85 },
        { path: BASS, role: 'bass', gain: 0.9 },
        { path: 'percussion/latin-clave.musicxml', role: 'groove', gain: 0.82 },
      ],
    },
    {
      id: 'waltz-sketch', title: 'Waltz sketch', author: 'curated', kind: 'stack',
      layers: [
        { path: WALTZ, role: 'chords', gain: 0.9 },
        { path: 'percussion/waltz.musicxml', role: 'groove', gain: 0.72 },
      ],
    },
    {
      id: 'dance-floor-trio', title: 'Dance-floor trio', author: 'curated', kind: 'stack',
      layers: [
        { path: POP, role: 'chords', gain: 0.86 },
        { path: BASS, role: 'bass', gain: 0.92 },
        { path: 'percussion/four-on-floor.musicxml', role: 'groove', gain: 0.84 },
      ],
    },
  ],
  songs: [
    {
      id: 'verse-chorus-starter', title: 'Verse–chorus starter', author: 'curated', kind: 'song',
      meta: { bpm: 104, keyShift: 0 },
      carried: {
        groove: { path: 'percussion/rock-8ths.musicxml', role: 'groove', gain: 0.8 },
        bass: { path: BASS, role: 'bass', gain: 0.88 },
      },
      sections: [
        { id: 'verse', name: 'Verse', lengthBars: 8, layers: [{ path: VERSE, role: 'chords' }, { carried: 'bass' }, { carried: 'groove' }] },
        { id: 'chorus', name: 'Chorus', lengthBars: 8, layers: [{ path: CHORUS, role: 'chords' }, { carried: 'bass' }, { carried: 'groove' }] },
      ],
      arrangement: [
        { section: 'verse', repeats: 2 },
        { section: 'chorus', repeats: 2 },
        { section: 'verse', repeats: 1 },
        { section: 'chorus', repeats: 2 },
      ],
    },
    {
      id: 'dance-night', title: 'Dance Night', author: 'curated', kind: 'song',
      meta: { bpm: 120, keyShift: 0 },
      carried: {
        groove: { path: 'percussion/four-on-floor.musicxml', role: 'groove', gain: 0.84 },
      },
      sections: [
        { id: 'a', name: 'A', lengthBars: 8, layers: [{ path: POP, role: 'chords' }, { path: BASS, role: 'bass' }, { carried: 'groove' }] },
        { id: 'break', name: 'Break', lengthBars: 4, layers: [{ path: LOFI, role: 'chords', gain: 0.8 }, { carried: 'groove' }] },
      ],
      arrangement: [
        { section: 'a', repeats: 2 },
        { section: 'break', repeats: 1 },
        { section: 'a', repeats: 2 },
      ],
    },
  ],
});

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function light(kind, payload) {
  return {
    id: payload.id,
    title: payload.title,
    author: payload.author,
    kind: kind === 'stacks' ? 'stack' : 'song',
    ...(kind === 'stacks'
      ? { layerCount: payload.layers.length }
      : { sectionCount: payload.sections.length }),
  };
}

function refs(kind, payload) {
  if (kind === 'stacks') return payload.layers;
  return [
    ...Object.values(payload.carried ?? {}),
    ...payload.sections.flatMap((section) => section.layers).filter((ref) => !ref.carried),
  ];
}

function refTypeMatchesRole(ref, entry) {
  const allowed = {
    chords: new Set(['chord-progression']),
    bass: new Set(['bassline']),
    groove: new Set(['groove', 'percussion']),
    melody: new Set(['melody']),
    idea: new Set(['idea']),
  };
  return !ref.role || !allowed[ref.role] || allowed[ref.role].has(entry.type);
}

export async function planPrefabCuration({ root, mediaRoot }) {
  const prefabRoot = resolve(root);
  const midiRoot = resolve(mediaRoot);
  const indexPath = join(prefabRoot, 'index.yml');
  const index = YAML.parse(await readFile(indexPath, 'utf8')) ?? {};
  const next = {
    stacks: [...(index.stacks ?? [])],
    songs: [...(index.songs ?? [])],
  };
  const additions = [];
  const updates = [];
  const errors = [];
  const manifestByPath = new Map(buildManifest(midiRoot).map((entry) => [entry.path, entry]));
  const validateRefs = async (kind, payload) => {
    for (const ref of refs(kind, payload)) {
      if (!await exists(join(midiRoot, ref.path))) {
        errors.push(`${kind}/${payload.id}: missing ${ref.path}`);
        continue;
      }
      const entry = manifestByPath.get(ref.path);
      if (!entry) errors.push(`${kind}/${payload.id}: absent from manifest ${ref.path}`);
      else if (entry.needsReview) errors.push(`${kind}/${payload.id}: unplayable ${ref.path}`);
      else if (entry.harmonyVerified === false && !['groove', 'percussion'].includes(entry.type)) {
        errors.push(`${kind}/${payload.id}: failed harmony ${ref.path}`);
      } else if (!refTypeMatchesRole(ref, entry)) {
        errors.push(`${kind}/${payload.id}: ${ref.role} role does not match ${entry.type} ${ref.path}`);
      }
    }
  };
  for (const kind of ['stacks', 'songs']) {
    const existing = new Set(next[kind].map((item) => item.id));
    for (const payload of CURATED_PREFABS[kind]) {
      if (existing.has(payload.id)) continue;
      await validateRefs(kind, payload);
      next[kind].push(light(kind, payload));
      additions.push({ kind, payload });
    }
  }
  for (const repair of CURATED_REPAIRS) {
    if (!next[repair.kind].some((item) => item.id === repair.id)) continue;
    const payloadPath = join(prefabRoot, repair.kind, `${repair.id}.yml`);
    if (!await exists(payloadPath)) {
      errors.push(`${repair.kind}/${repair.id}: indexed payload missing`);
      continue;
    }
    const payload = YAML.parse(await readFile(payloadPath, 'utf8')) ?? {};
    const repaired = structuredClone(payload);
    let changed = false;
    for (const ref of refs(repair.kind, repaired)) {
      if (ref.path === repair.from) { ref.path = repair.to; changed = true; }
    }
    if (!changed) continue;
    await validateRefs(repair.kind, repaired);
    const index = next[repair.kind].findIndex((item) => item.id === repair.id);
    next[repair.kind][index] = light(repair.kind, repaired);
    updates.push({ kind: repair.kind, payload: repaired });
  }
  return {
    valid: errors.length === 0,
    root: prefabRoot,
    next,
    additions,
    updates,
    errors,
    counts: { stacks: next.stacks.length, songs: next.songs.length },
  };
}

function backupPath(root) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dirname(root), `${basename(root)}.backup-${stamp}`);
}

async function atomicYaml(path, value) {
  const temp = `${path}.curation.tmp`;
  await writeFile(temp, YAML.stringify(value, { lineWidth: 0 }), 'utf8');
  await rename(temp, path);
}

export async function applyPrefabCuration(plan) {
  if (!plan.valid) throw new Error(`Refusing curation with ${plan.errors.length} errors`);
  const backup = backupPath(plan.root);
  await cp(plan.root, backup, { recursive: true, errorOnExist: true });
  for (const { kind, payload } of [...plan.additions, ...plan.updates]) {
    const dir = join(plan.root, kind);
    await mkdir(dir, { recursive: true });
    await atomicYaml(join(dir, `${payload.id}.yml`), payload);
  }
  await atomicYaml(join(plan.root, 'index.yml'), plan.next);
  return { applied: plan.additions.length + plan.updates.length, backup, counts: plan.counts };
}

function parseArgs(argv) {
  const args = { root: null, mediaRoot: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--media-root') args.mediaRoot = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || !args.mediaRoot) throw new Error('--root and --media-root are required');
  const plan = await planPrefabCuration(args);
  const result = args.apply ? await applyPrefabCuration(plan) : {
    valid: plan.valid,
    mode: 'dry-run',
    additions: plan.additions.map(({ kind, payload }) => `${kind}/${payload.id}`),
    updates: plan.updates.map(({ kind, payload }) => `${kind}/${payload.id}`),
    counts: plan.counts,
    errors: plan.errors,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!plan.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
