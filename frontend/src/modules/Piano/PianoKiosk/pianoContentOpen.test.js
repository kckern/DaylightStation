import { describe, it, expect, vi, beforeEach } from 'vitest';

const info = vi.fn();
const warnFn = vi.fn();
const child = vi.fn(() => ({ info, debug: vi.fn(), warn: warnFn, error: vi.fn() }));
const getLoggerMock = vi.fn(() => ({ child }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: (...args) => getLoggerMock(...args),
}));

import { isSheetMusicContentId, sheetMusicViewPath, openPianoContent } from './pianoContentOpen.js';

describe('isSheetMusicContentId', () => {
  it('is true for an explicit source:localId id', () => {
    expect(isSheetMusicContentId('hymn:12')).toBe(true);
  });

  it('is true when the localId itself contains a colon-free path', () => {
    expect(isSheetMusicContentId('files:docs/sheet-music/fur-elise.musicxml')).toBe(true);
  });

  it('is false for a bare colon-less id (legacy plex default, ambiguous mode)', () => {
    expect(isSheetMusicContentId('359812')).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(isSheetMusicContentId('')).toBe(false);
  });

  it('is false for a leading-colon id (no source before the colon)', () => {
    expect(isSheetMusicContentId(':12')).toBe(false);
  });

  it('is false for a trailing-colon id with no localId', () => {
    expect(isSheetMusicContentId('hymn:')).toBe(false);
  });

  it('is false for non-string input', () => {
    expect(isSheetMusicContentId(null)).toBe(false);
    expect(isSheetMusicContentId(undefined)).toBe(false);
    expect(isSheetMusicContentId(12)).toBe(false);
  });
});

describe('sheetMusicViewPath', () => {
  it('builds the absolute SheetMusic view route, id used verbatim', () => {
    expect(sheetMusicViewPath('/piano', 'hymn:12')).toBe('/piano/sheetmusic/view/hymn:12');
  });

  it('preserves slashes in the id (a file path)', () => {
    expect(sheetMusicViewPath('/piano/yellow-room', 'files:docs/sheet-music/fur-elise.musicxml'))
      .toBe('/piano/yellow-room/sheetmusic/view/files:docs/sheet-music/fur-elise.musicxml');
  });
});

describe('openPianoContent', () => {
  let navigate;

  beforeEach(() => {
    info.mockClear();
    warnFn.mockClear();
    navigate = vi.fn();
  });

  it('navigates to the SheetMusic view route for a sheet-music-shaped contentId', () => {
    const opened = openPianoContent({ contentId: 'hymn:12', basePath: '/piano', navigate });

    expect(opened).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/piano/sheetmusic/view/hymn:12');
    expect(info).toHaveBeenCalledWith('piano-content-open', { contentId: 'hymn:12', mode: 'sheetmusic', play: null });
  });

  // Remote-play (2026-08-23): a `play` mode rides as a query param the viewer
  // consumes once, so the bus can say "open this AND perform it".
  it('appends ?play= when a play mode is given', () => {
    const opened = openPianoContent({
      contentId: 'files:docs/sheet-music/green-hill-zone.mxl',
      basePath: '/piano', navigate, play: 'listen',
    });

    expect(opened).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      '/piano/sheetmusic/view/files:docs/sheet-music/green-hill-zone.mxl?play=listen',
    );
  });

  it('warns and no-ops for a contentId with no reachable resolver', () => {
    const opened = openPianoContent({ contentId: '359812', basePath: '/piano', navigate });

    expect(opened).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(warnFn).toHaveBeenCalledWith('piano-launch-content-open-unreachable', { contentId: '359812' });
  });
});
