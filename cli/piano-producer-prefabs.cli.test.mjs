import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import YAML from 'yaml';
import { CURATED_PREFABS, applyPrefabCuration, planPrefabCuration } from './piano-producer-prefabs.cli.mjs';

function playableXml(path) {
  const type = path.startsWith('percussion/') ? 'groove'
    : path.startsWith('basslines/') ? 'bassline'
      : 'chord-progression';
  return `<score-partwise><miscellaneous>
    <miscellaneous-field name="type">${type}</miscellaneous-field>
    <miscellaneous-field name="canonical-name">fixture</miscellaneous-field>
    <miscellaneous-field name="source-slug">${path}</miscellaneous-field>
    <miscellaneous-field name="bpm">110</miscellaneous-field>
  </miscellaneous><part id="P1"><measure number="1"><attributes><divisions>4</divisions>
  <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note>
  <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration></note>
  <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration></note>
  </measure></part></score-partwise>`;
}

describe('Producer prefab curation', () => {
  it('validates references and applies new payloads only after a backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'producer-prefabs-'));
    const root = join(dir, 'prefabs');
    const mediaRoot = join(dir, 'midi');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'index.yml'), 'stacks: []\nsongs: []\n');
    const allRefs = CURATED_PREFABS.stacks.flatMap((payload) => payload.layers)
      .concat(CURATED_PREFABS.songs.flatMap((payload) => [
        ...Object.values(payload.carried),
        ...payload.sections.flatMap((section) => section.layers).filter((ref) => !ref.carried),
      ]));
    for (const path of new Set(allRefs.map((ref) => ref.path))) {
      const target = join(mediaRoot, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, playableXml(path));
    }
    const plan = await planPrefabCuration({ root, mediaRoot });
    assert.equal(plan.valid, true);
    assert.deepEqual(plan.counts, { stacks: 4, songs: 2 });
    const applied = await applyPrefabCuration(plan);
    assert.match(applied.backup, /prefabs\.backup-/);
    const index = YAML.parse(await readFile(join(root, 'index.yml'), 'utf8'));
    assert.equal(index.stacks.length, 4);
    assert.equal(index.songs.length, 2);
  });

  it('repairs the indexed lofi starter and preserves the original in its backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'producer-prefabs-repair-'));
    const root = join(dir, 'prefabs');
    const mediaRoot = join(dir, 'midi');
    const failedPath = 'chords/i⠏-bIII⠏-iii°⠏-IV⠏-#iv°⠏-v⠏-iii°⠏-bIII⠏.musicxml';
    const verifiedPath = 'chords/i⠏-v⠏-c542db.musicxml';
    const stack = {
      id: 'lofi-groove-bed',
      title: 'Lofi groove bed',
      author: 'curated',
      kind: 'stack',
      layers: [
        { path: failedPath, role: 'chords', gain: 0.8 },
        { path: 'percussion/brush-swing.musicxml', role: 'groove', gain: 0.7 },
      ],
    };
    const index = {
      stacks: [
        ...CURATED_PREFABS.stacks.map((payload) => ({ id: payload.id })),
        { id: stack.id },
      ],
      songs: CURATED_PREFABS.songs.map((payload) => ({ id: payload.id })),
    };
    await mkdir(join(root, 'stacks'), { recursive: true });
    await writeFile(join(root, 'index.yml'), YAML.stringify(index));
    await writeFile(join(root, 'stacks', `${stack.id}.yml`), YAML.stringify(stack));
    for (const path of [verifiedPath, 'percussion/brush-swing.musicxml']) {
      const target = join(mediaRoot, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, playableXml(path));
    }

    const plan = await planPrefabCuration({ root, mediaRoot });
    assert.equal(plan.valid, true);
    assert.deepEqual(plan.updates.map(({ payload }) => payload.id), ['lofi-groove-bed']);
    assert.equal(plan.additions.length, 0);
    const applied = await applyPrefabCuration(plan);
    const repaired = YAML.parse(await readFile(join(root, 'stacks', `${stack.id}.yml`), 'utf8'));
    const original = YAML.parse(await readFile(join(applied.backup, 'stacks', `${stack.id}.yml`), 'utf8'));
    assert.equal(repaired.layers[0].path, verifiedPath);
    assert.equal(original.layers[0].path, failedPath);
  });
});
