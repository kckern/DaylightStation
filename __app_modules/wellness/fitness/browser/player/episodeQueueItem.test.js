import { describe, expect, it } from 'vitest';
import {
  buildEpisodeQueueItem,
  gridGroupIdOf,
  originTileImage,
  browseContainerIdOf,
} from './episodeQueueItem.js';
import { buildVirtualSeasons } from '../lib/playlistVirtualSeasons.js';

const displayUrl = (id) => `/display/${id}`;
const normalizeUrl = (url) => `norm:${url}`;

// A playlist page whose top-rated item is from a different show than the one
// being launched: the page poster is that other show's.
const playlistInfo = { type: 'playlist', title: 'Warmups', image: '/thumb/playlist' };
const apiItems = [
  { id: 'plex:100', label: 'Cardio', userRating: 10, parentId: 21, parentTitle: 'Program', grandparentId: 20, grandparentTitle: 'Other Show', thumbId: 901 },
  { id: 'plex:200', label: 'Warm-up', parentId: 11, parentTitle: 'Extras', parentIndex: 2, grandparentId: 10, grandparentTitle: 'Own Show', thumbId: 902, duration: 655 },
];
const apiParents = {
  11: { index: 2, title: 'Extras', thumbnail: '/thumb/season-11', type: 'season' },
  21: { index: 1, title: 'Program', thumbnail: '/thumb/season-21', type: 'season' },
};

const launchFromPlaylist = () => {
  const { groups, items } = buildVirtualSeasons(apiItems, 20, { sortByRating: true, resolveShowImage: displayUrl });
  const episode = items.find((it) => it.id === 'plex:200');
  const item = buildEpisodeQueueItem({
    episode,
    container: { id: 'plex:500', info: playlistInfo },
    parents: apiParents,
    groups,
    plexId: '200',
    mediaUrl: '/stream/200',
    displayUrl,
    normalizeUrl,
  });
  return { groups, episode, item };
};

describe('buildEpisodeQueueItem — episode launched from a playlist', () => {
  it('takes season and show identity from the episode, not the playlist page', () => {
    const { groups, item } = launchFromPlaylist();
    // Precondition: the page poster really is the other show's.
    expect(groups['virtual-season-1'].thumbnail).toBe('/display/20');

    expect(item).toMatchObject({
      parentId: 11,
      season: 'Extras',
      parentTitle: 'Extras',
      seasonImage: 'norm:/thumb/season-11',
      parentImage: 'norm:/thumb/season-11',
      grandparentId: 10,
      showId: 10,
      grandparentTitle: 'Own Show',
      show: 'Own Show',
      showImage: '/display/10',
      title: 'Warm-up',
    });
  });

  it('carries the playlist and page as launchContext', () => {
    const { item } = launchFromPlaylist();
    expect(item.launchContext).toEqual({
      type: 'playlist',
      id: '500',
      title: 'Warmups',
      image: 'norm:/thumb/playlist',
      groupId: 'virtual-season-1',
      groupTitle: '1–2',
    });
  });

  it('first timeline tile uses the episode’s own season art', () => {
    const { item, groups } = launchFromPlaylist();
    expect(originTileImage(item)).toBe('norm:/thumb/season-11');
    expect(originTileImage(item)).not.toBe(groups['virtual-season-1'].thumbnail);
  });

  it('back-navigation returns to the playlist, history stays with the show', () => {
    const { item } = launchFromPlaylist();
    expect(browseContainerIdOf(item)).toBe('500');
    expect(item.grandparentId).toBe(10);
  });

  it('a playlist never stands in for a missing show', () => {
    const { items, groups } = buildVirtualSeasons([{ id: 'plex:300', label: 'Clip' }], 20);
    const item = buildEpisodeQueueItem({
      episode: items[0], container: { id: '500', info: playlistInfo }, parents: null, groups, plexId: '300', displayUrl,
    });
    expect(item.grandparentId).toBeUndefined();
    expect(item.showId).toBeUndefined();
    expect(item.grandparentTitle).toBe('');
    expect(item.seasonImage).toBeUndefined();
    expect(item.showImage).toBeUndefined();
    expect(item.launchContext.id).toBe('500');
  });
});

describe('buildEpisodeQueueItem — episode launched from its own show', () => {
  const info = { type: 'show', title: 'Own Show', image: '/thumb/show' };

  it('keeps the show-page behaviour', () => {
    const item = buildEpisodeQueueItem({
      episode: { id: 'plex:200', label: 'Warm-up', parentId: 11, thumbId: 902 },
      container: { id: '10', info },
      parents: apiParents,
      plexId: '200',
      resumeSeconds: 30,
      watchProgress: 12,
      nogovern: true,
      labels: ['a'],
      displayUrl,
      normalizeUrl,
    });
    expect(item).toMatchObject({
      id: '200', contentId: 'plex:200', plex: '200', source: 'plex',
      title: 'Warm-up', show: 'Own Show', season: 'Extras',
      grandparentId: '10', grandparentTitle: 'Own Show',
      parentId: 11, seasonImage: 'norm:/thumb/season-11',
      image: '/display/902', seconds: 30, watchSeconds: 30, watchProgress: 12,
      nogovern: true, labels: ['a'], type: 'episode',
    });
    expect(item.launchContext).toEqual({ type: 'show', id: '10', title: 'Own Show', image: 'norm:/thumb/show' });
    expect(browseContainerIdOf(item)).toBe('10');
  });

  it('falls back to the season id for art when the parents map lacks it', () => {
    const item = buildEpisodeQueueItem({
      episode: { id: 'plex:200', label: 'x', parentId: 77 }, container: { id: '10', info }, plexId: '200', displayUrl,
    });
    expect(item.seasonImage).toBe('/display/77');
  });
});

describe('helpers', () => {
  it('gridGroupIdOf prefers the page tag over the real season', () => {
    expect(gridGroupIdOf({ groupId: 'virtual-season-2', parentId: 11 })).toBe('virtual-season-2');
    expect(gridGroupIdOf({ parentId: 11 })).toBe(11);
    expect(gridGroupIdOf(null)).toBeNull();
  });

  it('originTileImage: season, then show, then own frame', () => {
    expect(originTileImage({ seasonImage: 's', showImage: 'g', image: 'i' })).toBe('s');
    expect(originTileImage({ showImage: 'g', image: 'i' })).toBe('g');
    expect(originTileImage({ image: 'i' })).toBe('i');
    expect(originTileImage(null)).toBeNull();
  });

  it('browseContainerIdOf falls back for items built elsewhere', () => {
    expect(browseContainerIdOf({ showId: '9', grandparentId: '8' })).toBe('9');
    expect(browseContainerIdOf({ grandparentId: '8' })).toBe('8');
    expect(browseContainerIdOf({})).toBeNull();
  });
});
