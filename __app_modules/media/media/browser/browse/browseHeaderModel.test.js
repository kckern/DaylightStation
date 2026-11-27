import { describe, it, expect } from 'vitest';
import { headerFacts, parentOf, ancestorsOf, soleSeasonOf, pathFor, contentIdFromPath, headerArt, sectionsFor, watchState, watchedSubtitle, unwatchedCount } from './browseHeaderModel.js';

const SHOW = {
  id: 'plex:59493', type: 'show', title: 'Bluey (2018)',
  metadata: {
    type: 'show', year: 2018, contentRating: 'TV-Y', genres: ['Animation', 'Comedy', 'Family', 'Short'],
    seasonCount: 4, leafCount: 155, childCount: 155, librarySectionTitle: 'TV Shows',
  },
};
const AUTHOR = { id: 'plex:196996', type: 'artist', title: 'Mario Livio', metadata: { type: 'artist', countries: ['Romania'], librarySectionTitle: 'Audiobooks', childCount: 0 } };
const BOOK = { id: 'plex:505133', type: 'album', title: 'Is God a Mathematician?', metadata: { type: 'album', year: 2009, librarySectionTitle: 'Audiobooks', parentTitle: 'Mario Livio', parentRatingKey: '196996', leafCount: 1 } };
const TRACK = { id: 'plex:505134', type: 'track', title: 'Is God a Mathematician?', metadata: { type: 'track', librarySectionTitle: 'Audiobooks', artist: 'Mario Livio', artistId: '196996', album: 'Is God a Mathematician?', albumId: '505133' } };
const EPISODE = { id: 'plex:266151', type: 'episode', title: 'Hospital', metadata: { type: 'episode', grandparentTitle: 'Bluey (2018)', grandparentId: '59493', parentTitle: 'Season 1', parentId: '59494', parentThumb: '/api/v1/proxy/plex/library/metadata/59494/thumb/1' } };
const SEASON = { id: 'plex:59494', type: 'season', title: 'Season 1', metadata: { type: 'season', parentTitle: 'Bluey (2018)', parentRatingKey: '59493', leafCount: 52 } };

describe('headerFacts', () => {
  it('a show: kind, year, rating, three genres, seasons and episodes', () => {
    expect(headerFacts(SHOW)).toEqual(['TV Show', '2018', 'TV-Y', 'Animation, Comedy, Family', '4 seasons', '155 episodes']);
  });
  it('a show with one season says so in the singular', () => {
    expect(headerFacts({ ...SHOW, metadata: { ...SHOW.metadata, seasonCount: 1, leafCount: 18 } })).toContain('1 season');
  });
  it('an audiobook author is an Author from a country, with the books counted from the list', () => {
    expect(headerFacts(AUTHOR, { itemCount: 2 })).toEqual(['Author', 'Romania', '2 books']);
  });
  it('a music artist counts albums', () => {
    expect(headerFacts({ ...AUTHOR, metadata: { ...AUTHOR.metadata, librarySectionTitle: 'Music', genres: ['Rock'] } }, { itemCount: 13 }))
      .toEqual(['Artist', 'Romania', 'Rock', '13 albums']);
  });
  it('an audiobook album is a Book with its year and length', () => {
    expect(headerFacts(BOOK, { durationSeconds: 32681 })).toEqual(['Book', '2009', '9 hr 5 min']);
  });
  it('a season counts its episodes', () => {
    expect(headerFacts(SEASON)).toEqual(['Season', '52 episodes']);
  });
  it('never repeats a count of zero', () => {
    expect(headerFacts({ id: 'plex:1', type: 'collection', title: 'x', metadata: { childCount: 0 } })).toEqual(['Collection']);
  });
});

describe('parentOf', () => {
  it('a track links its author with the author image', () => {
    expect(parentOf(TRACK)).toEqual({ contentId: 'plex:196996', title: 'Mario Livio', role: 'Author', thumbnail: '/api/v1/proxy/plex/library/metadata/196996/thumb' });
  });
  it('an album links its author/artist', () => {
    expect(parentOf(BOOK)).toMatchObject({ contentId: 'plex:196996', title: 'Mario Livio', role: 'Author' });
    expect(parentOf({ ...BOOK, metadata: { ...BOOK.metadata, librarySectionTitle: 'Music' } }).role).toBe('Artist');
  });
  it('an episode links its show; a season links its show', () => {
    expect(parentOf(EPISODE)).toMatchObject({ contentId: 'plex:59493', title: 'Bluey (2018)', role: 'Show' });
    expect(parentOf(SEASON)).toMatchObject({ contentId: 'plex:59493', title: 'Bluey (2018)', role: 'Show' });
  });
  it('a top-level item has none', () => {
    expect(parentOf(SHOW)).toBeNull();
    expect(parentOf(AUTHOR)).toBeNull();
    expect(parentOf(null)).toBeNull();
  });
});

describe('ancestorsOf (breadcrumbs for a page opened by its address)', () => {
  it('an episode: show, then season', () => {
    expect(ancestorsOf(EPISODE)).toEqual([
      { contentId: 'plex:59493', title: 'Bluey (2018)' },
      { contentId: 'plex:59494', title: 'Season 1' },
    ]);
  });
  it('a track: author, then book', () => {
    expect(ancestorsOf(TRACK).map((a) => a.title)).toEqual(['Mario Livio', 'Is God a Mathematician?']);
  });
  it('an album: its artist; a show: nothing (never a library or a Devices crumb)', () => {
    expect(ancestorsOf(BOOK)).toEqual([{ contentId: 'plex:196996', title: 'Mario Livio' }]);
    expect(ancestorsOf(SHOW)).toEqual([]);
  });
});

describe('soleSeasonOf', () => {
  const season = { id: 'plex:457030', itemType: 'container', type: 'season', title: 'Season 1', metadata: { type: 'season' } };
  it('a show whose only child is a season opens that season', () => {
    expect(soleSeasonOf({ type: 'show' }, [season], 1)).toBe(season);
  });
  it('not for two seasons, a partial page, or a non-show', () => {
    expect(soleSeasonOf({ type: 'show' }, [season, { ...season, id: 'plex:2' }], 2)).toBeNull();
    expect(soleSeasonOf({ type: 'show' }, [season], 3)).toBeNull();
    expect(soleSeasonOf({ type: 'artist' }, [season], 1)).toBeNull();
    expect(soleSeasonOf({ type: 'show' }, [{ ...season, type: 'episode', metadata: { type: 'episode' } }], 1)).toBeNull();
  });
});

describe('paths and art', () => {
  it('maps content ids and browse paths both ways', () => {
    expect(pathFor('plex:457029')).toBe('plex/457029');
    expect(contentIdFromPath('plex/457029')).toBe('plex:457029');
    expect(contentIdFromPath('/plex/457029/')).toBe('plex:457029');
    expect(contentIdFromPath('plex')).toBeNull();
    expect(contentIdFromPath('')).toBeNull();
  });
  it('a header uses the poster, else the art', () => {
    expect(headerArt({ thumbnail: '/t', metadata: { art: '/a' } })).toBe('/t');
    expect(headerArt({ metadata: { art: '/a' } })).toBe('/a');
    expect(headerArt({})).toBeNull();
  });
});

describe('sectionsFor (person pages by kind)', () => {
  const book = (id) => ({ id, type: 'album', metadata: { type: 'album' } });
  it('an author lists Books then Chapters, natural order kept, empty kinds left out', () => {
    const rows = [book('a'), { id: 't', type: 'track', metadata: { type: 'track' } }, book('b')];
    const sections = sectionsFor(AUTHOR, rows);
    expect(sections.map((s) => `${s.label} (${s.items.length})`)).toEqual(['Books (2)', 'Chapters (1)']);
    expect(sections[0].items.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('a music artist says Albums; other pages have no sections', () => {
    expect(sectionsFor({ ...AUTHOR, metadata: { ...AUTHOR.metadata, librarySectionTitle: 'Music' } }, [book('a')])[0].label).toBe('Albums');
    expect(sectionsFor(SHOW, [book('a')])).toBeNull();
    expect(sectionsFor(AUTHOR, [])).toBeNull();
  });
});

describe('watch marks (jellyfin study rec 11)', () => {
  const ep = (id, watchProgress, duration = 600) => ({ id, type: 'episode', itemType: 'leaf', watchProgress, duration });
  it('a row is watched at 90 %, partial with the time left before', () => {
    expect(watchState(ep('a', 95))).toEqual({ kind: 'watched' });
    expect(watchState(ep('b', 50))).toEqual({ kind: 'partial', leftSeconds: 300 });
    expect(watchState(ep('c', 0))).toBeNull();
    expect(watchState({ itemType: 'container', watchProgress: 100 })).toBeNull();
    expect(watchedSubtitle('Episode · 10 min', { kind: 'watched' })).toBe('Watched · Episode · 10 min');
    expect(watchedSubtitle('Episode · 10 min', { kind: 'partial', leftSeconds: 300 })).toBe('Episode · 10 min · 5 min left');
  });
  it('a season counts the episodes not yet watched, on a complete list only', () => {
    const rows = [ep('a', 95), ep('b', 50), ep('c', 0)];
    expect(unwatchedCount(rows, 3)).toBe(2);
    expect(unwatchedCount(rows, 10)).toBeNull();
    expect(headerFacts(SEASON, { unwatched: 2 })).toEqual(['Season', '52 episodes', '2 unwatched']);
    expect(headerFacts(SEASON, { unwatched: 0 })).toContain('All watched');
  });
});
