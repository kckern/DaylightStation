import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Finite reviewed Piano, School, Language and Fitness data only. Bytes travel in the already pinned fixture;
// the sandbox receives no new read, write or network grant.
export function validateRawFixtures(fixture) {
  const rows = fixture.rawUTF8Files ?? [], binaryRows = fixture.rawBinaryFiles ?? [];
  assert.ok(Array.isArray(rows) && Array.isArray(binaryRows));
  const seen = new Set(); let total = 0;
  for (const row of [...rows, ...binaryRows]) {
    const binary = binaryRows.includes(row);
    const destination = row.destination;
    assert.ok(typeof destination === 'string' && path.posix.normalize(destination) === destination && !destination.includes('\\'));
    const producer = /^data\/household(?:-[A-Za-z0-9_-]+)?\/piano\/producer\/(loops|crate|songs)\/[a-z0-9-]+\.yml$/.test(destination);
    const composer = /^data\/users\/([A-Za-z0-9_-]+)\/apps\/piano\/composer\/[a-z0-9-]+\.musicxml$/.exec(destination);
    const deck = /^data\/content\/school\/learning-catalog\/flashcard-decks\/language\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.yml$/.test(destination);
    const attempts = /^data\/users\/([A-Za-z0-9_-]+)\/apps\/school\/attempts\/\d{4}-\d{2}-\d{2}\.yml$/.exec(destination);
    const bypass = /^data\/household(?:-[A-Za-z0-9_-]+)?\/school\/records\/program-day-bypasses\.yml$/.test(destination);
    const lexicon = /^media\/school\/language\/[A-Za-z0-9_-]+\/lexicon\.yml$/.test(destination);
    const manifest = /^data\/household(?:-[A-Za-z0-9_-]+)?\/school\/artifacts\/issued\/agenda\/([A-Za-z0-9_-]+)\/\d{8}T\d{9}Z\.yml$/.exec(destination);
    const payload = /^data\/household(?:-[A-Za-z0-9_-]+)?\/school\/artifacts\/issued\/agenda\/([A-Za-z0-9_-]+)\/\d{8}T\d{9}Z\.png$/.exec(destination);
    const householdStaticPNG = ["media/img/users/user_1.png", "media/img/users/default.png", "media/img/equipment/synthetic-cycle.png", "media/img/entropy/synthetic-reading.png"].includes(destination);
  const asset = /^media\/school\/language\/[A-Za-z0-9_-]+\/words\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/(image\.jpg|term\.mp3)$/.test(destination);
    const race = /^data\/household(?:-[A-Za-z0-9_-]+)?\/fitness\/log\/cycle-races\/\d{4}-\d{2}-\d{2}\/\d{14}\.ya?ml$/.test(destination);
    const memo = /^data\/household(?:-[A-Za-z0-9_-]+)?\/fitness\/voice-memos\/vm_[A-Za-z0-9]{16}\.json$/.test(destination);
    const languageCorpus = /^data\/content\/school\/language\/[A-Za-z0-9_-]+\.yml$/.test(destination);
    const promptAudio = /^media\/school\/language\/[A-Za-z0-9_-]+\/\d{4}-[A-Za-z]{2,8}\.mp3$/.test(destination);
    const pianoLesson = ['media/docs/piano-lessons/synthetic-daily-lessons/index.yml', 'media/docs/piano-lessons/synthetic-daily-lessons/five-finger.yml'].includes(destination);
    const curationUsageText = ["media/img/art/classic/synthetic-forest/metadata.yaml", "media/img/art/classic/synthetic-room/metadata.yaml", "media/img/art/classic/synthetic-river/metadata.yaml", "data/system/history/ai-usage/2026-10.synthetic-readiness.jsonl", "media/weekly-review/2026-10-05/.drafts/synthetic-family-a.meta.json", "media/weekly-review/2026-10-05/.drafts/synthetic-family-b.meta.json", "media/weekly-review/2026-09-28/.drafts/synthetic-prior-family.meta.json"].includes(destination);
    const curationUsageImage = ["media/img/art/classic/synthetic-forest/image.png", "media/img/art/classic/synthetic-room/image.png", "media/img/art/classic/synthetic-river/image.png"].includes(destination);
    const gamingStored = ['media/games/_common/catalog/synthetic-read-assets.yml', 'data/household/gaming/effects/sessions/synthetic_asset-session.jsonl'].includes(destination);
    const gamingSchoolImage = ['media/games/_common/synthetic-read-assets/tiles.png', 'media/games/party-games/synthetic-read-assets.png', 'media/school/language/synthetic-read-assets/words/en/star/image.png'].includes(destination);
    const mediaNavigationImage = ["media/audio/readalong/synthetic-media-navigation/cover.png", "media/audio/readalong/synthetic-media-navigation/chapter/cover.png", "data/content/readalong/synthetic-media-navigation/icon.png"].includes(destination);
    const mediaNavigationAudio = ["media/audio/readalong/synthetic-media-navigation/chapter/0001-synthetic-reading.wav", "media/audio/singalong/synthetic-media-navigation/0001-synthetic-song.mp3"].includes(destination);
    if (row.mtimeMs !== undefined) assert.ok(binary && (gamingSchoolImage || mediaNavigationImage) && row.mtimeMs === 1759276800000, 'Unreviewed fixture mtime');
    if (gamingSchoolImage || mediaNavigationImage) assert.equal(row.mtimeMs, 1759276800000, 'Exact image fixture mtime required');
    const studyRecording = destination === "media/school/language/daily-korean/recordings/user_1/0002-KR.wav";
    const cueAudio = destination === 'media/school/_ux/ding.mp3';
    assert.ok(binary ? householdStaticPNG || curationUsageImage || mediaNavigationImage || mediaNavigationAudio || studyRecording || gamingSchoolImage || payload || asset || promptAudio || cueAudio : curationUsageText || gamingStored || pianoLesson || languageCorpus || producer || composer || deck || attempts || bypass || lexicon || manifest || race || memo, 'Unreviewed raw destination');
    for (const match of [attempts, manifest, payload]) if (match) assert.ok(Object.hasOwn(fixture.fixtureFiles, 'data/users/' + match[1] + '/profile.yml'), 'Raw School user must have projected roster profile');
    if (composer) assert.ok(Object.hasOwn(fixture.fixtureFiles, 'data/users/' + composer[1] + '/profile.yml'), 'Raw composer user must have a projected roster profile');
    assert.ok(!seen.has(destination) && !Object.hasOwn(fixture.fixtureFiles, destination), 'Raw duplicate or JSON collision'); seen.add(destination);
    assert.equal(row.encoding, binary ? 'binary' : 'utf8'); assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(row.byteLength) && row.byteLength > 0 && row.byteLength <= 1048576);
    assert.ok(typeof row.base64 === 'string');
    const bytes = Buffer.from(row.base64, 'base64'); assert.equal(bytes.toString('base64'), row.base64, 'Noncanonical bytes');
    assert.equal(bytes.length, row.byteLength); total += bytes.length; assert.ok(total <= 8388608);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, 'Raw byte hash mismatch');
    if (binary) {
      const extension = path.posix.extname(destination);
      const signature = (studyRecording || destination === "media/audio/readalong/synthetic-media-navigation/chapter/0001-synthetic-reading.wav") ? bytes.length>=44 && bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WAVE' && bytes.readUInt32LE(4)+8===bytes.length
        : extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : extension === '.jpg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : extension === '.mp3' && (bytes.subarray(0, 3).toString('ascii') === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224);
      assert.ok(signature, 'Binary fixture does not match approved PNG/JPEG/MP3 type');
    } else {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); assert.ok(!text.includes('\0'), 'Binary raw fixture');
    }
  }
  return rows;
}
export const rawFixturePins = fixture => validateRawFixtures(fixture).map(({ destination, sha256, byteLength, encoding }) => ({ destination, sha256, byteLength, encoding }));

export const binaryFixturePins = fixture => { validateRawFixtures(fixture); return (fixture.rawBinaryFiles ?? []).map(({ destination, sha256, byteLength, encoding }) => ({ destination, sha256, byteLength, encoding })); };

// Exact reviewed readdir-only metadata. No file payload or file-serving capability.
export function validateDirectoryFixtures(fixture) {
  const dirs = fixture.fixtureDirectories ?? [], metadata = fixture.metadataDirectories ?? [];
  assert.ok(Array.isArray(dirs) && dirs.length <= 4096 && Array.isArray(metadata) && metadata.length <= 1);
  const canonical = value => typeof value === 'string' && path.posix.normalize(value) === value && !value.includes('\\');
  const files = [...Object.keys(fixture.fixtureFiles), ...(fixture.rawUTF8Files ?? []).map(r=>r.destination), ...(fixture.rawBinaryFiles ?? []).map(r=>r.destination)];
  const seen = new Set();
  for (const destination of dirs) {
    assert.ok(canonical(destination) && /^data\/household(?:-[A-Za-z0-9_-]+)?\/fitness\/(?:workouts|log\/(?:cycle-races\/)?\d{4}-\d{2}-\d{2})$/.test(destination), 'Unreviewed directory destination');
    assert.ok(!seen.has(destination), 'Duplicate directory');seen.add(destination);
    assert.ok(files.every(file=>destination !== file && !destination.startsWith(file+'/')), 'File/directory collision');
  }
  for (const row of metadata) {
    assert.equal(row.destination,'media/fitness/ux/menus');assert.equal(row.consumer,'fitness-menu-music-names-only');
    assert.ok(!seen.has(row.destination));seen.add(row.destination);
    assert.ok(files.every(file=>file !== row.destination && !file.startsWith(row.destination+'/') && !row.destination.startsWith(file+'/')), 'Metadata cannot shadow content');
    assert.ok(Array.isArray(row.entries) && row.entries.length > 0 && row.entries.length <= 128);
    const names=new Set();
    for(const entry of row.entries){assert.match(entry.name,/^\d{3}\.mp3$/);assert.ok(!names.has(entry.name));names.add(entry.name);assert.equal(entry.type,'file');assert.equal(entry.contentAvailable,false);assert.match(entry.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isInteger(entry.byteLength)&&entry.byteLength>0&&entry.byteLength<=10485760);}
  }
  return {fixtureDirectories:dirs,metadataDirectories:metadata};
}
export const directoryFixturePins = fixture => validateDirectoryFixtures(fixture);

// Parent-side setup for three exact synthetic image files; no source files or syscall policy changes.
export function materializeTimedImageFixtures(fixture, scratch) {
  validateRawFixtures(fixture);
  assert.ok(path.isAbsolute(scratch) && fs.realpathSync(scratch) === scratch && fs.lstatSync(scratch).isDirectory(), 'Canonical private scratch required');
  const selected = (fixture.rawBinaryFiles ?? []).filter(row => row.mtimeMs !== undefined);
  for (const row of selected) {
    const file = path.join(scratch, row.destination);
    assert.ok(file.startsWith(scratch + path.sep) && !fs.existsSync(file), 'Timed fixture collision');
    let parent = scratch;
    for (const segment of row.destination.split('/').slice(0, -1)) {
      parent = path.join(parent, segment);
      if (fs.existsSync(parent)) assert.ok(fs.lstatSync(parent).isDirectory() && !fs.lstatSync(parent).isSymbolicLink(), 'Timed fixture symlink/parent collision');
    }
  }
  const observed = [];
  for (const row of selected) {
    const file = path.join(scratch, row.destination);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(row.base64, 'base64'), { flag: 'wx', mode: 0o600 });
    fs.utimesSync(file, row.mtimeMs / 1000, row.mtimeMs / 1000);
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(file) === file);
    assert.equal(stat.size, row.byteLength); assert.equal(stat.mtimeMs, row.mtimeMs);
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), row.sha256);
    observed.push({ destination: row.destination, sha256: row.sha256, byteLength: stat.size, mtimeMs: stat.mtimeMs });
  }
  return observed;
}
