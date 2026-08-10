import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import YAML from 'yaml';
import { certifyProducerCatalog } from './piano-producer-catalog.cli.mjs';

const TYPE_FOLDERS = ['chords', 'basslines', 'melodies', 'ideas', 'percussion'];

function grooveXml(id) {
  return `<score-partwise><miscellaneous>
    <miscellaneous-field name="type">groove</miscellaneous-field>
    <miscellaneous-field name="source-slug">${id}</miscellaneous-field>
    <miscellaneous-field name="canonical-name">straight</miscellaneous-field>
    <miscellaneous-field name="bpm">110</miscellaneous-field>
  </miscellaneous><part id="P1"><measure number="1"><attributes><divisions>4</divisions>
  <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration></note>
  </measure></part></score-partwise>`;
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'producer-catalog-'));
  const mediaRoot = join(dir, 'midi');
  const prefabRoot = join(mediaRoot, 'prefabs');
  const ledger = join(mediaRoot, '_workspace', '_ledger.jsonl');
  for (const folder of TYPE_FOLDERS) await mkdir(join(mediaRoot, folder), { recursive: true });
  await mkdir(join(mediaRoot, '_workspace'), { recursive: true });
  await mkdir(join(prefabRoot, 'stacks'), { recursive: true });
  await mkdir(join(prefabRoot, 'songs'), { recursive: true });

  const rows = [];
  for (let index = 0; index < 8; index += 1) {
    const output = `percussion/groove-${index}.musicxml`;
    rows.push({ output, slug: `groove-${index}`, harmonyVerified: 'yes' });
    await writeFile(join(mediaRoot, output), grooveXml(`groove-${index}`));
  }
  await writeFile(ledger, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const path = rows[0].output;
  const index = { stacks: [], songs: [] };
  for (let item = 0; item < 6; item += 1) {
    const id = `stack-${item}`;
    index.stacks.push({ id, title: id, author: 'curated', kind: 'stack', layerCount: 1 });
    await writeFile(join(prefabRoot, 'stacks', `${id}.yml`), YAML.stringify({
      id, title: id, author: 'curated', kind: 'stack', layers: [{ path, role: 'groove' }],
    }));
  }
  for (let item = 0; item < 3; item += 1) {
    const id = `song-${item}`;
    index.songs.push({ id, title: id, author: 'curated', kind: 'song', sectionCount: 1 });
    await writeFile(join(prefabRoot, 'songs', `${id}.yml`), YAML.stringify({
      id,
      title: id,
      author: 'curated',
      kind: 'song',
      carried: {},
      sections: [{ id: 'section-a', name: 'A', lengthBars: 4, layers: [{ path, role: 'groove' }] }],
      arrangement: [{ section: 'section-a', repeats: 1 }],
    }));
  }
  await writeFile(join(prefabRoot, 'index.yml'), YAML.stringify(index));
  return { mediaRoot, ledger, prefabRoot };
}

describe('Producer catalog certification', () => {
  it('accepts a fully reconciled catalog at the production minimums', async () => {
    const paths = await fixture();
    const report = await certifyProducerCatalog({
      mediaRoot: paths.mediaRoot,
      ledger: paths.ledger,
      prefabs: paths.prefabRoot,
    });
    assert.equal(report.valid, true, report.errors.join('\n'));
    assert.equal(report.counts.ledger, 8);
    assert.equal(report.counts.manifest, 8);
    assert.equal(report.counts.groove, 8);
    assert.equal(report.counts.prefabStacks, 6);
    assert.equal(report.counts.prefabSongs, 3);
  });

  it('rejects an unledgered manifest file even when the file itself parses', async () => {
    const paths = await fixture();
    await writeFile(join(paths.mediaRoot, 'ideas', 'untracked.musicxml'), grooveXml('untracked'));
    const report = await certifyProducerCatalog({
      mediaRoot: paths.mediaRoot,
      ledger: paths.ledger,
      prefabs: paths.prefabRoot,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((error) => error.includes('ledger/manifest count mismatch')));
    assert.ok(report.errors.some((error) => error.includes('manifest path absent from ledger: ideas/untracked.musicxml')));
  });

  it('rejects dead prefab refs and an exceeded manifest-build budget', async () => {
    const paths = await fixture();
    const payloadPath = join(paths.prefabRoot, 'stacks', 'stack-0.yml');
    const payload = YAML.parse(await readFile(payloadPath, 'utf8'));
    payload.layers[0].path = 'percussion/missing.musicxml';
    await writeFile(payloadPath, YAML.stringify(payload));
    const report = await certifyProducerCatalog({
      mediaRoot: paths.mediaRoot,
      ledger: paths.ledger,
      prefabs: paths.prefabRoot,
      maxBuildMs: 0,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((error) => error.includes('missing path: percussion/missing.musicxml')));
    assert.ok(report.errors.some((error) => error.includes('exceeds 0ms budget')));
  });

  it('rejects an indexed groove that contains no playable notes', async () => {
    const paths = await fixture();
    await writeFile(join(paths.mediaRoot, 'percussion', 'groove-0.musicxml'), `
      <score-partwise><miscellaneous>
        <miscellaneous-field name="type">groove</miscellaneous-field>
        <miscellaneous-field name="source-slug">groove-0</miscellaneous-field>
        <miscellaneous-field name="canonical-name">straight</miscellaneous-field>
        <miscellaneous-field name="bpm">110</miscellaneous-field>
      </miscellaneous></score-partwise>`);
    const report = await certifyProducerCatalog({
      mediaRoot: paths.mediaRoot,
      ledger: paths.ledger,
      prefabs: paths.prefabRoot,
    });
    assert.equal(report.valid, false);
    assert.equal(report.counts.needsReview, 1);
    assert.ok(report.errors.some((error) => error.includes('not playable/reviewed')));
  });

  it('rejects prefab structure that would silently disappear during runtime hydration', async () => {
    const paths = await fixture();
    const payloadPath = join(paths.prefabRoot, 'songs', 'song-0.yml');
    const payload = YAML.parse(await readFile(payloadPath, 'utf8'));
    payload.sections[0].layers = [{ carried: 'missing-groove' }];
    payload.arrangement[0].repeats = 0;
    await writeFile(payloadPath, YAML.stringify(payload));
    const report = await certifyProducerCatalog({
      mediaRoot: paths.mediaRoot,
      ledger: paths.ledger,
      prefabs: paths.prefabRoot,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((error) => error.includes('fails runtime hydration')));
    assert.ok(report.errors.some((error) => error.includes('carried:missing-groove')));
  });
});
