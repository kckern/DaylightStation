import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { libraryScoreLocalPath, practiceKeyOfScore } from './practiceKey.mjs';

describe('libraryScoreLocalPath', () => {
  it('gives the media-relative path of a library score', () => {
    assert.equal(libraryScoreLocalPath('files:docs/sheet-music/classical/fur-elise.musicxml'),
      'docs/sheet-music/classical/fur-elise.musicxml');
    assert.equal(libraryScoreLocalPath('files:docs/sheet-music/a.mxl'), 'docs/sheet-music/a.mxl');
  });

  it('refuses other folders, look-alike folders and bare ids', () => {
    for (const id of [
      'files:docs/other/x.mxl',
      'files:docs/sheet-musical/x.mxl',
      'files:docs/sheet-music',
      'docs/sheet-music/a.mxl',
      'plex:12345',
      '',
      null,
      undefined,
    ]) assert.equal(libraryScoreLocalPath(id), null, String(id));
  });

  it("refuses '', '.' and '..' path segments", () => {
    for (const id of [
      'files:docs/sheet-music/',
      'files:docs/sheet-music//a.mxl',
      'files:docs/sheet-music/./a.mxl',
      'files:docs/sheet-music/../other/a.mxl',
      'files:docs/sheet-music/t/..',
      'files:docs/sheet-music/t/',
    ]) assert.equal(libraryScoreLocalPath(id), null, id);
  });
});

describe('practiceKeyOfScore', () => {
  it('slugs an id', () => {
    assert.equal(practiceKeyOfScore('files:docs/sheet-music/Für Elise.mxl'), 'files-docs-sheet-music-f-r-elise-mxl');
  });
});
