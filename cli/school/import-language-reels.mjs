#!/usr/bin/env node
/**
 * Safely ingest the Facebook Korean language-reel source collection.
 *
 * This is intentionally a two-phase cross-volume move: copy every source to
 * a temporary destination, checksum it, promote it, write an audit manifest,
 * and only then archive the originals. AppleDouble sidecars are deliberately
 * ignored; they are Finder metadata, not authored assets.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';

const SOURCE_ROOT = '/Volumes/Media/_Inbox/fb';
const COURSE = 'korean-language-reels';
const REQUIRED = ['.mp4', '.srt', '.yaml'];

const slug = (value) => String(value ?? 'uncategorized')
  .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorized';
const hash = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const exists = async (file) => fs.access(file).then(() => true).catch(() => false);
const parseSrtTime = (value) => {
  const m = String(value).trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) return null;
  return (((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000) + Number(m[4]);
};
function parseSrt(text) {
  const blocks = text.replace(/\r/g, '').trim().split(/\n{2,}/);
  return blocks.map((block, index) => {
    const lines = block.split('\n');
    const timing = lines.find((line) => line.includes('-->'));
    if (!timing) throw new Error(`SRT block ${index + 1} has no timing`);
    const [start, end] = timing.split('-->').map((part) => parseSrtTime(part.trim()));
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
      throw new Error(`SRT block ${index + 1} has invalid timing`);
    }
    const textLines = lines.slice(lines.indexOf(timing) + 1).join(' ').trim();
    return { id: `cue-${String(index + 1).padStart(2, '0')}`, startMs: start, endMs: end, text: textLines };
  });
}
function transcriptLines(raw) {
  return String(raw?.transcript_ko ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}
const normal = (value) => String(value ?? '').replace(/\s+/g, '').replace(/[.!?]/g, '');
function sourceMismatch(raw, cues) {
  const source = transcriptLines(raw).map(normal);
  const timed = cues.map((cue) => normal(cue.text)).filter(Boolean);
  return source.length !== timed.length || source.some((line, index) => line !== timed[index]);
}
async function copyVerified(source, destination) {
  if (await exists(destination)) {
    if (await hash(source) !== await hash(destination)) throw new Error(`collision with different content: ${destination}`);
    return { destination, sha256: await hash(destination), reused: true };
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.importing-${process.pid}`;
  try {
    await fs.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    const digest = await hash(temporary);
    if (digest !== await hash(source)) throw new Error(`checksum mismatch: ${source}`);
    await fs.rename(temporary, destination);
    return { destination, sha256: digest, reused: false };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function writeYaml(destination, value) {
  const text = yaml.dump(value, { lineWidth: 110, noRefs: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, text, { flag: 'wx' });
}

const apply = process.argv.includes('--apply');
const base = process.env.DAYLIGHT_BASE_PATH;
if (!base) throw new Error('DAYLIGHT_BASE_PATH is required');
const mediaRoot = path.join(base, 'media', 'school', 'language', COURSE);
const contentRoot = path.join(base, 'data', 'content', 'school', 'language', COURSE);
const archiveRoot = path.join(SOURCE_ROOT, '..', '_ingested', `${COURSE}-${new Date().toISOString().replace(/[:.]/g, '-')}`);

const discovered = new Map();
for (const category of await fs.readdir(SOURCE_ROOT, { withFileTypes: true })) {
  if (!category.isDirectory() || category.name.startsWith('.')) continue;
  const dir = path.join(SOURCE_ROOT, category.name);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('._')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!REQUIRED.includes(ext)) continue;
    const id = path.basename(entry.name, ext);
    if (!/^\d+$/.test(id)) throw new Error(`unexpected source filename: ${entry.name}`);
    const row = discovered.get(id) ?? { id, folder: category.name, files: {} };
    if (row.folder !== category.name) throw new Error(`duplicate source id in two folders: ${id}`);
    row.files[ext] = path.join(dir, entry.name);
    discovered.set(id, row);
  }
}
const rows = [...discovered.values()].sort((a, b) => Number(a.id) - Number(b.id));
const incomplete = rows.filter((row) => REQUIRED.some((ext) => !row.files[ext]));
if (incomplete.length) throw new Error(`incomplete source triplets: ${incomplete.map((row) => row.id).join(', ')}`);

const manifest = { schema: 'school.language-reels-import/v1', course: COURSE, sourceRoot: SOURCE_ROOT,
  importedAt: new Date().toISOString(), count: rows.length, reels: [], warnings: [] };
for (const row of rows) {
  const raw = yaml.load(await fs.readFile(row.files['.yaml'], 'utf8'));
  const cues = parseSrt(await fs.readFile(row.files['.srt'], 'utf8'));
  const category = slug(raw?.category);
  const mismatch = sourceMismatch(raw, cues);
  if (mismatch) manifest.warnings.push({ id: row.id, kind: 'transcript_srt_mismatch' });
  if (slug(row.folder) !== category) manifest.warnings.push({ id: row.id, kind: 'folder_category_mismatch', folder: row.folder, category });
  row.raw = raw; row.cues = cues; row.category = category; row.mismatch = mismatch;
}

if (!apply) {
  console.log(JSON.stringify({ apply: false, count: rows.length, mediaRoot, contentRoot, archiveRoot, warnings: manifest.warnings }, null, 2));
  process.exit(0);
}
if (await exists(archiveRoot)) throw new Error(`archive already exists: ${archiveRoot}`);

for (const row of rows) {
  const sourceDir = path.join(contentRoot, 'sources', row.category);
  const reelDir = path.join(contentRoot, 'reels', row.category);
  const media = await copyVerified(row.files['.mp4'], path.join(mediaRoot, row.category, `${row.id}.mp4`));
  const sourceYaml = await copyVerified(row.files['.yaml'], path.join(sourceDir, `${row.id}.source.yaml`));
  const sourceSrt = await copyVerified(row.files['.srt'], path.join(sourceDir, `${row.id}.srt`));
  const unitFile = path.join(contentRoot, 'units', `language-reel-${row.id}.yml`);
  const reelFile = path.join(reelDir, `${row.id}.reel.yml`);
  if (await exists(unitFile) || await exists(reelFile)) throw new Error(`normalized content already exists for ${row.id}`);
  const sourceLabel = `${row.folder}/${row.id}`;
  await writeYaml(unitFile, {
    schema: 'school.unit/v1', unitId: `language-reel-${row.id}`,
    title: `${String(row.raw?.category ?? row.folder).replace(/_/g, ' ')} reel ${row.id}`,
    description: 'Korean listening, reconstruction, comprehension, and speaking practice.',
    subject: 'language', objectives: ['Understand a short Korean language reel.'],
    program: 'language-reels', programInstance: row.id, cadence: 'once',
    provenance: { sources: [sourceLabel], reviewState: 'draft' },
  });
  await writeYaml(reelFile, {
    schema: 'school.language-reel/v1', id: row.id,
    title: null, languages: { source: 'en', target: 'ko' }, reviewState: 'draft',
    source: { folder: row.folder, category: row.raw?.category ?? null, sourceId: row.id,
      transcriptSrtMismatch: row.mismatch },
    media: { assetId: `school:language/${COURSE}/${row.category}/${row.id}` },
    transcript: row.cues, vocabulary: row.raw?.vocabulary ?? [], grammar: row.raw?.grammar ?? [],
    authoring: { cloze: [], comprehension: [], speaking: { enabled: false, segments: [] },
      requiredBeforeApproval: ['title', 'reviewed transcript', 'cloze', 'comprehension'] },
  });
  manifest.reels.push({ id: row.id, category: row.category, unitId: `language-reel-${row.id}`,
    files: { media, sourceYaml, sourceSrt }, transcriptSrtMismatch: row.mismatch });
}
await fs.mkdir(path.join(contentRoot, 'manifests'), { recursive: true });
await writeYaml(path.join(contentRoot, 'manifests', `import-${Date.now()}.yml`), manifest);

for (const row of rows) {
  const archiveDir = path.join(archiveRoot, row.folder);
  await fs.mkdir(archiveDir, { recursive: true });
  for (const ext of REQUIRED) await fs.rename(row.files[ext], path.join(archiveDir, path.basename(row.files[ext])));
}
console.log(JSON.stringify({ apply: true, imported: rows.length, archiveRoot, warnings: manifest.warnings }, null, 2));
