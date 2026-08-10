import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import YAML from 'yaml';
import { auditProducerData, applyProducerMigration } from './piano-producer-migrate.cli.mjs';

const cliPath = fileURLToPath(new URL('./piano-producer-migrate.cli.mjs', import.meta.url));

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'producer-v2-'));
  const root = join(dir, 'producer');
  const mediaRoot = join(dir, 'midi');
  for (const family of ['loops', 'crate', 'songs']) await mkdir(join(root, family), { recursive: true });
  await mkdir(join(mediaRoot, 'chords'), { recursive: true });
  await writeFile(join(mediaRoot, 'chords', 'new.musicxml'), '<score-partwise/>');
  const ledger = join(dir, 'ledger.jsonl');
  await writeFile(ledger, `${JSON.stringify({ slug: 'old', source: 'chords/old.mid', output: 'chords/new.musicxml', type: 'chord-progression' })}\n`);
  await writeFile(join(root, 'loops', 'loop-1.yml'), YAML.stringify({
    author: 'kid', kind: 'chords', notes: [{ ticks: 0, durationTicks: 480, midi: 60 }], ppq: 480, lengthBars: 1,
  }));
  const layer = {
    id: 'chords/old.mid', role: 'chords', channel: 0, gmProgram: 0, gain: 1, muted: false, soloed: false, carried: false,
    source: { kind: 'library', entry: { path: 'chords/old.mid', slug: 'old' } },
  };
  await writeFile(join(root, 'crate', 'crate-1.yml'), YAML.stringify({ author: 'kid', kind: 'stack', layers: [layer] }));
  await writeFile(join(root, 'songs', 'song-1.yml'), YAML.stringify({
    author: 'kid', sections: [{ id: 'sec-1', name: 'A', lengthBars: 1, stack: [{ ...layer, source: { kind: 'loop', loopId: 'loop-1' } }] }],
    arrangement: [{ sectionId: 'sec-1', repeats: 1 }], carriedLayers: {}, meta: { keyShift: 0, bpm: 100 },
  }));
  return { root, mediaRoot, ledger };
}

describe('Producer v2 migration', () => {
  it('repairs exact ledger source refs, normalizes all families, validates, and backs up before apply', async () => {
    const paths = await fixture();
    const audit = await auditProducerData(paths);
    assert.equal(audit.report.valid, true);
    assert.deepEqual(audit.report.counts, { loops: 1, crate: 1, songs: 1 });
    assert.equal(audit.report.repairedLibraryRefs.length, 1);
    assert.equal(audit.records.find((item) => item.family === 'crate').normalized.layers[0].source.entry.path, 'chords/new.musicxml');
    const report = await applyProducerMigration(audit);
    assert.match(report.backup, /producer\.backup-v1-/);
    const stored = YAML.parse(await readFile(join(paths.root, 'crate', 'crate-1.yml'), 'utf8'));
    assert.equal(stored.schemaVersion, 2);
    assert.equal(stored.layers[0].source.entry.path, 'chords/new.musicxml');
    const cleanAudit = await auditProducerData(paths);
    assert.equal(cleanAudit.report.clean, true);
    assert.deepEqual(cleanAudit.report.changed, []);
    assert.deepEqual(cleanAudit.report.repairedLibraryRefs, []);
  });

  it('refuses a dead loop reference', async () => {
    const paths = await fixture();
    const songPath = join(paths.root, 'songs', 'song-1.yml');
    const song = YAML.parse(await readFile(songPath, 'utf8'));
    song.sections[0].stack[0].source.loopId = 'missing';
    await writeFile(songPath, YAML.stringify(song));
    const audit = await auditProducerData(paths);
    assert.equal(audit.report.valid, false);
    assert.ok(audit.report.errors.some((error) => error.includes('source.loopId missing')));
    await assert.rejects(() => applyProducerMigration(audit), /Refusing migration/);
  });

  it('--require-clean exits nonzero before migration and zero after an idempotent apply', async () => {
    const paths = await fixture();
    const args = [
      '--root', paths.root,
      '--ledger', paths.ledger,
      '--media-root', paths.mediaRoot,
      '--require-clean',
    ];
    const dirty = await runCli(args);
    assert.equal(dirty.code, 1, dirty.stderr);
    assert.equal(JSON.parse(dirty.stdout).clean, false);

    await applyProducerMigration(await auditProducerData(paths));
    const clean = await runCli(args);
    assert.equal(clean.code, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).clean, true);
  });
});
