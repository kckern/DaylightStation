import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkCollision,
  checkFilename,
  checkUploadXml,
  isAllowedFolder,
  scoreHeader,
  sheetMusicCollectionRefs,
  suggestFilename,
} from './musicXmlUpload.mjs';
import { practiceKeyOfScore } from './practiceKey.mjs';

const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>';
const REST = '<note><rest/><duration>4</duration></note>';
const partwise = (body, header = '') => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">${header}<part-list/><part id="P1"><measure number="1">${body}</measure></part></score-partwise>`;

describe('checkUploadXml', () => {
  it('accepts a partwise score with a sounding note and reads its header', () => {
    const header = '<work><work-title>F&#252;r Elise</work-title></work>'
      + '<identification><creator type="composer">Ludwig van Beethoven</creator></identification>';
    assert.deepEqual(checkUploadXml(`﻿${partwise(REST + NOTE, header)}`),
      { ok: true, title: 'Für Elise', composer: 'Ludwig van Beethoven' });
  });

  it('gives null title and composer when the header has none', () => {
    assert.deepEqual(checkUploadXml(partwise(NOTE)), { ok: true, title: null, composer: null });
  });

  it('refuses text with no XML root', () => {
    for (const text of ['', '   ', 'hello world', '{"score":1}', 'PK\u0003\u0004binary']) {
      assert.deepEqual(checkUploadXml(text), { ok: false, code: 'not-xml' }, JSON.stringify(text));
    }
    assert.deepEqual(checkUploadXml(null), { ok: false, code: 'not-xml' });
  });

  it('refuses timewise scores', () => {
    assert.deepEqual(checkUploadXml('<?xml version="1.0"?><score-timewise><measure>' + NOTE + '</measure></score-timewise>'),
      { ok: false, code: 'timewise' });
  });

  it('refuses XML that is not a partwise score', () => {
    assert.deepEqual(checkUploadXml('<?xml version="1.0"?><html><body>x</body></html>'), { ok: false, code: 'not-partwise' });
    assert.deepEqual(checkUploadXml('<score-partwise-ish/>'), { ok: false, code: 'not-partwise' });
  });

  it('refuses a score with only rests or no notes', () => {
    assert.deepEqual(checkUploadXml(partwise(REST + REST)), { ok: false, code: 'no-notes' });
    assert.deepEqual(checkUploadXml(partwise('')), { ok: false, code: 'no-notes' });
    // <notehead>, <notations> and <note-size> are not notes.
    assert.deepEqual(checkUploadXml(partwise('<notations/><notehead>x</notehead><note-size>1</note-size>')),
      { ok: false, code: 'no-notes' });
  });
});

describe('scoreHeader', () => {
  it('falls back to movement-title and decodes CDATA', () => {
    assert.deepEqual(scoreHeader('<movement-title><![CDATA[A & B]]></movement-title>'), { title: 'A & B', composer: null });
  });
});

describe('suggestFilename', () => {
  it('kebab-cases title and composer, stripping diacritics', () => {
    assert.equal(suggestFilename({ title: 'Für Élise', composer: 'Ludwig van Beethoven', ext: '.musicxml' }),
      'fur-elise-ludwig-van-beethoven.musicxml');
  });

  it('uses the given extension, with or without a dot', () => {
    assert.equal(suggestFilename({ title: 'Old Tune', ext: 'mxl' }), 'old-tune.mxl');
    assert.equal(suggestFilename({ title: 'Old Tune', ext: '.MXL' }), 'old-tune.mxl');
  });

  it('falls back to untitled-score for a title with no ASCII letters', () => {
    assert.equal(suggestFilename({ title: '아리랑', ext: '.musicxml' }), 'untitled-score.musicxml');
    assert.equal(suggestFilename({ title: '아리랑', composer: 'Trad. Korea', ext: '.musicxml' }),
      'untitled-score-trad-korea.musicxml');
    assert.equal(suggestFilename({ title: '아리랑', composer: '작자 미상', ext: '.mxl' }), 'untitled-score.mxl');
    assert.equal(suggestFilename({ ext: '.mxl' }), 'untitled-score.mxl');
  });

  it('collapses punctuation runs and trims dashes', () => {
    assert.equal(suggestFilename({ title: '  --Sonata No. 14 (Op. 27/2)!! ', ext: '.musicxml' }),
      'sonata-no-14-op-27-2.musicxml');
  });

  it('caps the stem at 80 characters on a dash boundary', () => {
    const name = suggestFilename({ title: Array.from({ length: 20 }, () => 'abcdefg').join(' '), ext: '.musicxml' });
    const stem = name.replace(/\.musicxml$/, '');
    assert.ok(stem.length <= 80, `${stem.length}`);
    assert.match(stem, /^(abcdefg-)*abcdefg$/);
    assert.equal(stem.length, 79); // 10 words of 7 plus 9 dashes
  });

  it('hard-cuts one long word', () => {
    const name = suggestFilename({ title: 'x'.repeat(200), ext: '.mxl' });
    assert.equal(name, `${'x'.repeat(80)}.mxl`);
  });

  it('always produces a name checkFilename accepts', () => {
    for (const title of ['Für Élise', '아리랑', '---', 'ÆØÅ', '42']) {
      assert.equal(checkFilename(suggestFilename({ title, ext: '.musicxml' })), null, title);
    }
  });
});

describe('checkFilename', () => {
  it('accepts lower-kebab musicxml and mxl names', () => {
    for (const name of ['fur-elise.musicxml', 'a.mxl', '9-to-5.mxl']) assert.equal(checkFilename(name), null, name);
  });

  it('refuses everything else', () => {
    for (const name of ['Fur-Elise.musicxml', 'fur elise.musicxml', '-a.mxl', 'a.xml', 'a.MXL', 'a_b.mxl',
      '../a.mxl', 'dir/a.mxl', '.mxl', '', null, undefined, 42]) {
      assert.deepEqual(checkFilename(name), { code: 'bad-filename' }, String(name));
    }
  });
});

describe('checkCollision', () => {
  const existing = [
    'files:docs/sheet-music/classical/fur-elise.musicxml',
    'files:docs/sheet-music/folk/old-tune.mxl',
  ];

  it('passes a new name', () => {
    assert.equal(checkCollision({ folder: 'classical', filename: 'gymnopedie.mxl', existingIds: existing }), null);
  });

  it('refuses the same stem in the same folder, in either format', () => {
    assert.deepEqual(checkCollision({ folder: 'classical', filename: 'fur-elise.musicxml', existingIds: existing }),
      { code: 'basename-exists' });
    assert.deepEqual(checkCollision({ folder: 'classical', filename: 'fur-elise.mxl', existingIds: existing }),
      { code: 'basename-exists' });
    assert.deepEqual(checkCollision({ folder: 'folk', filename: 'old-tune.musicxml', existingIds: existing }),
      { code: 'basename-exists' });
  });

  it('allows the same stem in another folder when the slugs differ', () => {
    assert.equal(checkCollision({ folder: 'beginner', filename: 'fur-elise.musicxml', existingIds: existing }), null);
  });

  it('refuses an id whose practice key another id already has, in any folder', () => {
    // "folk-old" + "tune" and "folk" + "old-tune" slug alike.
    const ids = ['files:docs/sheet-music/folk-old/tune.mxl'];
    assert.equal(practiceKeyOfScore('files:docs/sheet-music/folk/old-tune.mxl'), practiceKeyOfScore(ids[0]));
    assert.deepEqual(checkCollision({ folder: 'folk', filename: 'old-tune.mxl', existingIds: ids }), { code: 'slug-collides' });
  });

  it('refuses an id whose practice key reaches 120 characters', () => {
    const prefixKey = practiceKeyOfScore('files:docs/sheet-music/classical/');
    const fits = 'a'.repeat(119 - prefixKey.length - '-musicxml'.length - 1);
    assert.equal(checkCollision({ folder: 'classical', filename: `${fits}.musicxml`, existingIds: [] }), null);
    const atCap = `${fits}a.musicxml`;
    assert.equal(practiceKeyOfScore(`files:docs/sheet-music/classical/${atCap}`).length, 120);
    assert.deepEqual(checkCollision({ folder: 'classical', filename: atCap, existingIds: [] }), { code: 'slug-too-long' });
  });
});

describe('isAllowedFolder', () => {
  const refs = ['files:docs/sheet-music/classical', 'files:docs/sheet-music/christmas/', 'plex:999', 'files:docs/other/beginner'];

  it('accepts a configured library folder', () => {
    assert.equal(isAllowedFolder('classical', refs), true);
    assert.equal(isAllowedFolder('christmas', refs), true);
  });

  it('refuses unknown, non-library, nested and traversal folders', () => {
    for (const folder of ['studies', 'beginner', '999', '', '.', '..', '../classical', 'classical/x', 'a\\b', null, undefined]) {
      assert.equal(isAllowedFolder(folder, refs), false, String(folder));
    }
  });

  it('refuses a folder that only matches the last segment of a nested ref', () => {
    assert.equal(isAllowedFolder('waltzes', ['files:docs/sheet-music/classical/waltzes']), false);
  });

  it('accepts { ref } objects as well as strings', () => {
    assert.equal(isAllowedFolder('studies', [{ label: 'Studies', ref: 'files:docs/sheet-music/studies' }]), true);
  });
});

describe('sheetMusicCollectionRefs', () => {
  it('reads grouped collections', () => {
    assert.deepEqual(sheetMusicCollectionRefs({ collections: [
      { label: 'Classical', ref: 'files:docs/sheet-music/classical' }, { label: 'No ref' }, null,
    ] }), ['files:docs/sheet-music/classical']);
  });

  it('reads the legacy single collection', () => {
    const refs = sheetMusicCollectionRefs({ collection: 'files:docs/sheet-music/beginner' });
    assert.deepEqual(refs, ['files:docs/sheet-music/beginner']);
    assert.equal(isAllowedFolder('beginner', refs), true);
  });

  it('is empty without config', () => {
    assert.deepEqual(sheetMusicCollectionRefs(undefined), []);
    assert.deepEqual(sheetMusicCollectionRefs({}), []);
  });
});

describe('linear-time screening of hostile input', () => {
  const BOUND_MS = 300;
  const timed = (fn) => { const t = performance.now(); const result = fn(); return { result, ms: performance.now() - t }; };
  const NOTE_LINE = '<note><pitch><step>C</step></pitch></note>';
  const cases = [
    ['unterminated <note ', '<score-partwise>' + '<note '.repeat(200_000), 'no-notes'],
    ['unclosed <note>', '<score-partwise>' + '<note>'.repeat(200_000), 'no-notes'],
    ['repeated unclosed <work-title>', '<score-partwise><work><work-title>'.repeat(100_000), 'no-notes'],
    ['unterminated <creator ', '<score-partwise><identification>' + '<creator '.repeat(200_000), 'no-notes'],
    ['header traps before a real note', `<score-partwise>${'<work-title>'.repeat(100_000)}${'<creator '.repeat(100_000)}<part-list/>${NOTE_LINE}`, null],
    ['many rest notes', '<score-partwise>' + '<note><rest/></note>'.repeat(100_000), 'no-notes'],
    ['notes with a rest only at the end', '<score-partwise>' + '<note>'.repeat(100_000) + '</note><rest/>', null],
  ];
  for (const [name, xml, code] of cases) {
    it(`${name} finishes in under ${BOUND_MS} ms`, (t) => {
      const { result, ms } = timed(() => checkUploadXml(xml));
      t.diagnostic(`${name}: ${ms.toFixed(1)} ms over ${(xml.length / 1e6).toFixed(2)} MB`);
      assert.ok(ms < BOUND_MS, `${name} took ${ms.toFixed(0)} ms`);
      assert.equal(result.ok ? null : result.code, code);
    });
  }

  it('scoreHeader stays fast on a large hostile header', (t) => {
    const xml = '<work-title>'.repeat(300_000) + '<creator type="composer" '.repeat(50_000) + '<movement-title>'.repeat(300_000);
    const { result, ms } = timed(() => scoreHeader(xml));
    t.diagnostic(`scoreHeader: ${ms.toFixed(1)} ms`);
    assert.ok(ms < BOUND_MS, `${ms.toFixed(0)} ms`);
    assert.deepEqual(result, { title: null, composer: null });
  });
});

describe('scoreHeader bounds', () => {
  it('reads only the header before the first part', () => {
    assert.deepEqual(scoreHeader('<score-partwise><part-list/><part id="P1"><work-title>Inside</work-title></part>'),
      { title: null, composer: null });
    assert.deepEqual(scoreHeader('<score-partwise><work-title>Top</work-title><part id="P1"/>'), { title: 'Top', composer: null });
  });

  it('skips a self-closing or overlong element and keeps looking', () => {
    const long = 'x'.repeat(5000);
    assert.equal(scoreHeader(`<work-title/><work-title>${long}</work-title><movement-title>Fallback</movement-title>`).title, 'Fallback');
  });

  it('picks the composer among several creators and ignores tag case', () => {
    const xml = '<IDENTIFICATION><Creator type="lyricist">Words</Creator><CREATOR TYPE="composer">Tune Maker</CREATOR></IDENTIFICATION>';
    assert.equal(scoreHeader(xml.replace('TYPE', 'type')).composer, 'Tune Maker');
  });

  it('does not take <work-titles> or <creatorx> for the tags', () => {
    assert.deepEqual(scoreHeader('<work-titles>No</work-titles><creatorx type="composer">No</creatorx>'), { title: null, composer: null });
  });
});

describe('exact close tags and leading whitespace', () => {
  it('does not take </notehead> for the close of a note', () => {
    assert.deepEqual(checkUploadXml('<score-partwise><note><notehead>x</notehead><rest/></note></score-partwise>'),
      { ok: false, code: 'no-notes' });
    assert.equal(checkUploadXml('<score-partwise><note><notehead>x</notehead><pitch/></note></score-partwise>').ok, true);
  });

  it('does not take </work-titles> for the close of a work title', () => {
    assert.equal(scoreHeader('<work-title>A<work-titles>B</work-titles>C</work-title>').title, 'ABC');
  });

  it('skips 32 MB of leading whitespace quickly', (t) => {
    const xml = `﻿${' \n\t'.repeat(32 * 1024 * 1024 / 3)}<score-partwise><note><pitch/></note></score-partwise>`;
    const start = performance.now();
    const result = checkUploadXml(xml);
    const ms = performance.now() - start;
    t.diagnostic(`32 MB leading whitespace: ${ms.toFixed(1)} ms`);
    assert.ok(ms < 100, `${ms.toFixed(0)} ms`);
    assert.equal(result.ok, true);
  });

  it('refuses a root pushed past the 64 KiB prefix', () => {
    const tail = '<score-partwise><note><pitch/></note></score-partwise>';
    // Only prolog and a comment in the prefix: no element at all.
    assert.deepEqual(checkUploadXml(`<?xml version="1.0"?><!--${'x'.repeat(70 * 1024)}-->${tail}`), { ok: false, code: 'not-xml' });
    // An element in the prefix, but the root is beyond it.
    assert.deepEqual(checkUploadXml(`<?xml version="1.0"?><!DOCTYPE x [<!ELEMENT a ANY>]>${'<a/>'.repeat(20 * 1024)}${tail}`),
      { ok: false, code: 'not-partwise' });
  });
});
