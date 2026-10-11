import {validateGratitudeFixture,gratitudeFixtureIdentitySha256} from './gratitude-png-contract.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Finite reviewed Piano, School, Language and Fitness data only. Bytes travel in the already pinned fixture;
// the sandbox receives no new read, write or network grant.
export function validateRawFixtures(fixture) {
  validateFixedConfigMetadata(fixture);
  const rows = fixture.rawUTF8Files ?? [], binaryRows = fixture.rawBinaryFiles ?? [];
  assert.ok(Array.isArray(rows) && Array.isArray(binaryRows));
  const seen = new Set(); let total = 0;
  for (const row of [...rows, ...binaryRows]) {
    const binary = binaryRows.includes(row);
    const destination = row.destination;
    const gratitudeFont=binary&&destination==='media/fonts/roboto-condensed/RobotoCondensed-Regular.ttf'&&row.sha256==='c318f47fe2ec114266cab50c9712d20acb2275516b51538d1a83862bdfc12e59'&&row.byteLength===144196&&createHash('sha256').update(JSON.stringify(fixture)).digest('hex')===gratitudeFixtureIdentitySha256;if(gratitudeFont)validateGratitudeFixture(fixture);
    const schoolRemainingMediaPins = {"media/school/language/korean-language-reels/synthetic-read/900001.mp4":{"sha256":"79f33ad2b4550d449a6925b2fcbbb6fe017a3ff2fbf7cd4b1a2147f9c39cd844","byteLength":1647},"media/school/language/korean-language-reels/synthetic-read/900002.mp4":{"sha256":"9029e427713fccf68d1ce1ee4fcd4dd4b2a238b2d7487ccdc570f5770b3ee155","byteLength":1647}};
    const schoolRemainingTextPins = {"data/content/school/language/korean-language-reels/reels/synthetic-read/900001.reel.yml":{"sha256":"c30c184501d2823cc3df7ae5f031c73ee8b7944067b3d3d0ee3892af052d4e3e","byteLength":284},"data/content/school/language/korean-language-reels/reels/synthetic-read/900002.reel.yml":{"sha256":"76e580f04045212acc7da8c79d568af261e4d2f8c5bf60732a6cb9ca763d60ca","byteLength":283}};
    const schoolRemainingMedia = Object.hasOwn(schoolRemainingMediaPins,destination) && row.sha256 === schoolRemainingMediaPins[destination].sha256 && row.byteLength === schoolRemainingMediaPins[destination].byteLength;
    const schoolRemainingText = Object.hasOwn(schoolRemainingTextPins,destination) && row.sha256 === schoolRemainingTextPins[destination].sha256 && row.byteLength === schoolRemainingTextPins[destination].byteLength;
    const storedMediaPins = {"media/img/art/synthetic-read-still/blue-room.png":{"sha256":"8a6197d8f867762d84b16685ae3799086e556a65773226d4b12edc7de1e29c95","byteLength":77},"media/img/art/synthetic-read-still/garden.png":{"sha256":"a5459ddfbc5da952a9559e40d65ca15384a4f180d1420d917eb1a1aefc0b3efc","byteLength":77},"media/audio/feedback/school/20251001090000_synthetic_reading.wav":{"sha256":"7e1cadde739b9bf60d71ec7aeb1fbf7f93b7ca77965b7ec309714d768d7c8616","byteLength":1644},"media/audio/feedback/fitness/20251001100000_synthetic_training.wav":{"sha256":"a5a31651779766fe600b6eba70759dcdb5163b6bfa098fa122e3962c6769dc19","byteLength":1644},"data/users/user_1/lifelog/nutrition/photos/ph_SyntheticBreakfast.jpg":{"sha256":"5a8e783fb608405a048ca1f18fac5d6c586a410d032b9dc908aa57478889db06","byteLength":633},"data/users/user_1/lifelog/nutrition/photos/ph_SyntheticBreakfast.thumb.jpg":{"sha256":"e3e7875bb2d592e63658f1d95bccbff8b4e4305a417f1d8e0ee385c9470bb410","byteLength":633},"data/users/user_1/lifelog/nutrition/photos/ph_SyntheticLunch.jpg":{"sha256":"d2bb612e42515272b4cf624aab977f4dbb566229e8d6c2830d13ac01c521b947","byteLength":632},"data/users/user_2/lifelog/nutrition/photos/ph_SyntheticBreakfast.jpg":{"sha256":"93373298ed1f2dcedd050b09bfc1bcceb119b726981f5bd72b40f01a0aa4f009","byteLength":632},"media/audio/ambient/synthetic-read-calm.wav":{"sha256":"6d2b1431feb1c26ebfcad0e97a43471e8d9490637f4eef498ca32a8450e775d8","byteLength":1644},"media/audio/ambient/0017-synthetic-read-calm.wav":{"sha256":"6d2b1431feb1c26ebfcad0e97a43471e8d9490637f4eef498ca32a8450e775d8","byteLength":1644}};
    const storedMedia = Object.hasOwn(storedMediaPins, destination) && row.sha256 === storedMediaPins[destination].sha256 && row.byteLength === storedMediaPins[destination].byteLength;
    const storedMediaTimed = storedMedia && ["media/img/art/synthetic-read-still/blue-room.png", "media/img/art/synthetic-read-still/garden.png", "media/audio/feedback/school/20251001090000_synthetic_reading.wav", "media/audio/feedback/fitness/20251001100000_synthetic_training.wav", "data/users/user_1/lifelog/nutrition/photos/ph_SyntheticBreakfast.jpg", "data/users/user_1/lifelog/nutrition/photos/ph_SyntheticBreakfast.thumb.jpg", "data/users/user_1/lifelog/nutrition/photos/ph_SyntheticLunch.jpg", "data/users/user_2/lifelog/nutrition/photos/ph_SyntheticBreakfast.jpg"] .includes(destination);
    const householdListImage = ['media/img/lists/synthetic-breakfast.png','media/img/lists/synthetic-reading.png','media/img/lists/synthetic-weekly.png'].includes(destination);
    const householdListNote = destination === 'media/img/lists/synthetic-note.txt';
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
    if (row.mtimeMs !== undefined) assert.ok(binary && (schoolRemainingMedia || storedMediaTimed || householdListImage || gamingSchoolImage || mediaNavigationImage) && row.mtimeMs === 1759276800000, 'Unreviewed fixture mtime');
    if (schoolRemainingMedia || storedMediaTimed || householdListImage || gamingSchoolImage || mediaNavigationImage) assert.equal(row.mtimeMs, 1759276800000, 'Exact image fixture mtime required');
    const healthAuditJournalPins = {"data/users/user_1/lifelog/nutrition/auditor-journal/2025-10.synthetic-readiness.jsonl":{"sha256":"a1e161acf8fff994007e6031ecd201c97e92de68e68006902105069998473230","byteLength":2134},"data/users/user_1/lifelog/nutrition/auditor-journal/2025-10.synthetic-secondary.jsonl":{"sha256":"4c071540f722283c390337b6af8226a187171582ef6d7b19d27e5bb8932ebfa3","byteLength":349}};
    const healthAuditJournalText = Object.hasOwn(healthAuditJournalPins, destination) && row.sha256 === healthAuditJournalPins[destination].sha256 && row.byteLength === healthAuditJournalPins[destination].byteLength;
    if (healthAuditJournalText) assert.ok(Object.hasOwn(fixture.fixtureFiles, "data/users/user_1/profile.yml"), "Reviewed audit journal requires projected owner");
    const adminSceneIndexText = ["media/games/_common/catalog/synthetic-daily-scenes/catalog.yml","media/games/_common/catalog/synthetic-daily-scenes/scenes.yml","media/games/_common/catalog/synthetic-daily-scenes/reading-room.yml","media/games/_common/catalog/synthetic-daily-scenes/garden-path.yml","media/games/_common/catalog/synthetic-evening-scenes/catalog.yml","media/games/_common/catalog/synthetic-evening-scenes/scenes.yml","media/games/_common/catalog/synthetic-evening-scenes/quiet-room.yml"].includes(destination);
    const emulatorStoredText = ["media/emulation/synthetic-daily-console/catalog.yml", "media/emulation/input.yml", "media/emulation/consoles.yml", "media/emulation/settings.yml", "media/emulation/_engine/loader.js", "media/emulation/_engine/localization/en.json"].includes(destination);
    const schoolPosterJPEG = ["media/school/math/synthetic-poster-shapes/poster.jpg", "media/school/math/synthetic-poster-counting/poster.jpg", "media/school/programs/story-time/poster.jpg", "media/school/programs/word-ladder/poster.jpg", "media/school/programs/story-time/synthetic-evening/poster.jpg", "media/school/programs/word-ladder/synthetic-korean/poster.jpg"].includes(destination);
    const emulatorStoredPNG = ["media/emulation/synthetic-daily-console/cover.png", "media/emulation/synthetic-daily-console/bezel.png", "media/emulation/synthetic-daily-console/logo.png"].includes(destination);
    const emulatorOpaquePins = {"media/emulation/synthetic-daily-console/pocket-trail.gb":{"sha256":"2f620d39b3edbf55680f641997fe2a9da62c87e97e1a942ad2b277f8250a5bc2","byteLength":69},"media/emulation/synthetic-daily-console/saves/user_1/pocket-trail.srm":{"sha256":"11a1f8add11fcd631a88c6fa5db084b106ac653d82565e45319ea1d0a5ae40d9","byteLength":32},"media/emulation/synthetic-daily-console/states/user_2/pocket-trail/slot-1.state":{"sha256":"1108c1c7392c985392baa1835dc202a1d28356a8dd7033863c18336f7899a5fc","byteLength":31}};
    const emulatorOpaque = Object.hasOwn(emulatorOpaquePins, destination) && row.sha256 === emulatorOpaquePins[destination].sha256 && row.byteLength === emulatorOpaquePins[destination].byteLength;
    const studyRecording = destination === "media/school/language/daily-korean/recordings/user_1/0002-KR.wav";
    const cueAudio = destination === 'media/school/_ux/ding.mp3';
    // One exact authored EDL text fixture: complete bytes bound, no media subtree grant.
    const remainingContentFilterEDL = !binary && destination === "media/content-filter/edl/910001.edl.yml" && row.sha256 === "15a01a89abf474e272d4dfb44ca190acc89a6953ba86664d834353f93d87a5cc" && row.byteLength === 362;
    assert.ok(binary ? gratitudeFont || schoolRemainingMedia || storedMedia || householdListImage || schoolPosterJPEG || emulatorStoredPNG || emulatorOpaque || householdStaticPNG || curationUsageImage || mediaNavigationImage || mediaNavigationAudio || studyRecording || gamingSchoolImage || payload || asset || promptAudio || cueAudio : remainingContentFilterEDL || schoolRemainingText || householdListNote || healthAuditJournalText || adminSceneIndexText || emulatorStoredText || curationUsageText || gamingStored || pianoLesson || languageCorpus || producer || composer || deck || attempts || bypass || lexicon || manifest || race || memo, 'Unreviewed raw destination');
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
      const signature = gratitudeFont ? bytes.subarray(0,4).toString('hex')==='00010000'&&createHash('sha256').update(bytes).digest('hex')===row.sha256 : schoolRemainingMedia ? bytes.subarray(4,8).toString('ascii') === 'ftyp' : emulatorOpaque ? createHash('sha256').update(bytes).digest('hex') === emulatorOpaquePins[destination].sha256 : ((storedMedia && destination.endsWith('.wav')) || studyRecording || destination === "media/audio/readalong/synthetic-media-navigation/chapter/0001-synthetic-reading.wav") ? bytes.length>=44 && bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WAVE' && bytes.readUInt32LE(4)+8===bytes.length
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
  const selected = [...(fixture.rawBinaryFiles ?? []).filter(row => row.mtimeMs !== undefined), ...validateFixedConfigMetadata(fixture).map(row=>({...row,base64:Buffer.from(JSON.stringify(fixture.fixtureFiles[row.destination],null,2)+'\n').toString('base64')}))];
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

// One reviewed synthetic Admin packet only. Metadata belongs to fixture inputs, never response masks.
export function validateFixedConfigMetadata(fixture) {
  const rows=fixture.fixedConfigMetadata ?? [];
  assert.ok(Array.isArray(rows),'Fixed configuration metadata must be an array');
  if(!rows.length)return [];
  assert.equal(createHash('sha256').update(JSON.stringify(fixture)).digest('hex'), 'a560a0bd7d863c7e4b8a27d7882b3584feda76121c1140c6ad10b2e00942b230', 'Unreviewed fixed configuration fixture');
  assert.deepEqual(rows,[{"destination":"data/system/config/system.yml","sha256":"9415b5b5dd1d163436debe3f0a3a1864265b637a0942bbbbcc2331c78c164601","byteLength":259,"mtimeMs":1759276800000},{"destination":"data/household/household.yml","sha256":"e8165fc7033400356869ab33ae0d2598bb0ec9ef132ac5f5b5c15afa4f8f5b8c","byteLength":91,"mtimeMs":1759276800000},{"destination":"data/users/user_1/profile.yml","sha256":"c6c84ac068683e98f5db567c6b52e2405f6c8d7cca3086fbb998c4b401e14be4","byteLength":101,"mtimeMs":1759276800000},{"destination":"data/system/config/auth.yml","sha256":"1c7ac01924ad32cda69b8f41a2170c40f953d176f53368c8cc5575195febb3b6","byteLength":546,"mtimeMs":1759276800000},{"destination":"data/system/config/domains.yml","sha256":"4980a3c6aaeafd832c2624319116a71ec9916ad85b28f2f29b9ea53d8d9ad26d","byteLength":81,"mtimeMs":1759276800000},{"destination":"data/system/config/services.yml","sha256":"ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356","byteLength":3,"mtimeMs":1759276800000},{"destination":"data/system/config/adapters.yml","sha256":"ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356","byteLength":3,"mtimeMs":1759276800000},{"destination":"data/system/config/bots.yml","sha256":"ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356","byteLength":3,"mtimeMs":1759276800000},{"destination":"data/system/secrets.yml","sha256":"ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356","byteLength":3,"mtimeMs":1759276800000},{"destination":"data/household/integrations.yml","sha256":"34e7ffebf094aa2eea6f26daada6cd19a6967c0bd90eff554eb7bd9569334bda","byteLength":358,"mtimeMs":1759276800000},{"destination":"data/household/hardware/devices.yml","sha256":"698b1fb4670c582e6ca6c7ef252313f9f1ac91bb8e67d8821ac0d1aa7dad60a7","byteLength":20,"mtimeMs":1759276800000},{"destination":"data/household/fitness/config.yml","sha256":"06b41f18245c0d673782662d7f6539c0e903d80f195687c2175e6ab42e89bb92","byteLength":125,"mtimeMs":1759276800000},{"destination":"data/household/finance/config.yml","sha256":"7b4c09893f40bf260eef844a3ade0b9f6c5de991305023116537e01254268245","byteLength":125,"mtimeMs":1759276800000},{"destination":"data/household/gratitude/config.yml","sha256":"06324bd739beb6646aa90c26ee9e63cb7bc8852b544b1df9a0c218f42a0c59ad","byteLength":127,"mtimeMs":1759276800000},{"destination":"data/household/harvest/config.yml","sha256":"fc04460edaec5429f4ccc5bdc1cf31e6ff5f21cbd75c4f6bff5617a13db3088e","byteLength":126,"mtimeMs":1759276800000},{"destination":"data/household/media/app.yml","sha256":"b74b5fb1736641eacf01d65a54985b5790410114725cbe0f72ec5af6f1139996","byteLength":123,"mtimeMs":1759276800000},{"destination":"data/household/entropy/config.yml","sha256":"523db561862c8c07e94d5e0a4824fda2f3808aede3f4f261caf4d4c99160fa3d","byteLength":125,"mtimeMs":1759276800000},{"destination":"data/household/piano/config.yml","sha256":"33f8fc71f16f8a373393bdebac8d48f07f871e8627f238dd3bc45283ca9beb00","byteLength":123,"mtimeMs":1759276800000},{"destination":"data/system/config/readiness-display.yml","sha256":"b25360760fc83fb8748d8929ee177b598f527e1103e6569189c2c11f4dede886","byteLength":89,"mtimeMs":1759276800000},{"destination":"data/system/config/readiness-library.yml","sha256":"8172dcf2c7484a4530bdbe117be8f1384d2e575a8f95c0f8dffa45be14121dcd","byteLength":118,"mtimeMs":1759276800000}],'Exact configuration metadata rows required');
  for(const row of rows){
    assert.ok(Object.hasOwn(fixture.fixtureFiles,row.destination),'Metadata must address its authored JSON fixture');
    const bytes=Buffer.from(JSON.stringify(fixture.fixtureFiles[row.destination],null,2)+'\n');
    assert.equal(bytes.length,row.byteLength);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
  }
  return rows;
}
