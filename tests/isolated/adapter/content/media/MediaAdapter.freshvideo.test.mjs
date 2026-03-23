import { describe, it, expect, vi } from 'vitest';
import { MediaAdapter } from '#adapters/content/media/media/MediaAdapter.mjs';
import path from 'path';

/**
 * Mock filesystem where files live under video/news/ but the input ID
 * uses the shorter news/ path (relying on MEDIA_PREFIXES fallback).
 *
 * Directory structure:
 *   <mediaBase>/video/news/testchannel/20260310.mp4
 *   <mediaBase>/video/news/testchannel/20260322.mp4
 */
function makeMediaAdapter({ watchedKeys = [] } = {}) {
  const mediaBase = '/fake/media';

  // Build a fake filesystem map
  const dirs = new Set([
    path.join(mediaBase, 'video', 'news', 'testchannel'),
  ]);
  const files = new Map([
    [path.join(mediaBase, 'video', 'news', 'testchannel', '20260310.mp4'), { size: 1000, isDirectory: () => false, mtimeMs: 1 }],
    [path.join(mediaBase, 'video', 'news', 'testchannel', '20260322.mp4'), { size: 2000, isDirectory: () => false, mtimeMs: 2 }],
  ]);

  const adapter = new MediaAdapter({ mediaBasePath: mediaBase });

  // Override resolvePath to use our fake filesystem
  adapter.resolvePath = (mediaKey) => {
    mediaKey = mediaKey.replace(/^\//, '');
    const normalizedKey = path.normalize(mediaKey).replace(/^(\.\.[/\\])+/, '');

    // Try MEDIA_PREFIXES: ['', 'audio', 'video', 'img']
    for (const prefix of ['', 'audio', 'video', 'img']) {
      const candidate = prefix
        ? path.join(mediaBase, prefix, normalizedKey)
        : path.join(mediaBase, normalizedKey);

      if (dirs.has(candidate) || files.has(candidate)) {
        return { path: candidate, prefix };
      }
    }
    return null;
  };

  // Stub getList to return directory contents
  adapter.getList = async (id) => {
    const localId = id.replace(/^(files|media|local|file|fs):/, '');
    const resolved = adapter.resolvePath(localId);
    if (!resolved) return [];

    // Return items in alphabetical order (simulating real fs)
    const dirPath = resolved.path;
    const entries = [...files.keys()]
      .filter(f => path.dirname(f) === dirPath)
      .map(f => path.basename(f))
      .sort();

    // Build PlayableItem-like objects
    return entries.map(entry => {
      const childLocalId = localId ? `${localId}/${entry}` : entry;
      return {
        id: `files:${childLocalId}`,
        localId: childLocalId,
        source: 'files',
        title: path.basename(entry, '.mp4'),
        itemType: 'leaf',
        getLocalId() { return this.localId; },
        isPlayable() { return true; },
        mediaUrl: `/api/v1/proxy/media/stream/${encodeURIComponent(childLocalId)}`,
        metadata: { type: 'video', mimeType: 'video/mp4' },
      };
    });
  };

  // Stub getItem to return PlayableItem-like objects
  adapter.getItem = async (id) => {
    const localId = id.replace(/^(files|media|local):/, '');
    const resolved = adapter.resolvePath(localId);
    if (!resolved) return null;

    const stat = files.get(resolved.path);
    if (stat && !stat.isDirectory()) {
      return {
        id: `files:${localId}`,
        localId,
        source: 'files',
        title: path.basename(localId, '.mp4'),
        itemType: 'leaf',
        getLocalId() { return this.localId; },
        isPlayable() { return true; },
        mediaUrl: `/api/v1/proxy/media/stream/${encodeURIComponent(localId)}`,
        metadata: { type: 'video', mimeType: 'video/mp4' },
      };
    }

    // Directory
    if (dirs.has(resolved.path)) {
      return {
        id: `files:${localId}`,
        localId,
        source: 'files',
        title: path.basename(localId),
        itemType: 'container',
        getLocalId() { return this.localId; },
        isPlayable() { return false; },
      };
    }

    return null;
  };

  // Stub mediaProgressMemory
  adapter.mediaProgressMemory = {
    get(key) {
      const cleanKey = key.replace(/^(files|media):/, '');
      const percent = watchedKeys.includes(cleanKey) ? 95 : 0;
      return { percent };
    },
  };

  return adapter;
}

describe('MediaAdapter freshvideo detection via media: prefix', () => {
  it('picks latest video when input uses news/ path (no video/ prefix)', async () => {
    const adapter = makeMediaAdapter();
    // This is the exact path that comes from "media:news/testchannel" in a program list
    const result = await adapter.resolvePlayables('news/testchannel');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toContain('20260322');
  });

  it('picks latest video when input uses full video/news/ path', async () => {
    const adapter = makeMediaAdapter();
    const result = await adapter.resolvePlayables('video/news/testchannel');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toContain('20260322');
  });

  it('skips watched and picks next unwatched', async () => {
    const adapter = makeMediaAdapter({
      watchedKeys: ['news/testchannel/20260322.mp4'],
    });
    const result = await adapter.resolvePlayables('news/testchannel');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toContain('20260310');
  });

  it('returns all items for non-news media paths (no freshvideo)', async () => {
    // Create adapter with files under audio/ instead of video/news/
    const mediaBase = '/fake/media';
    const adapter = new MediaAdapter({ mediaBasePath: mediaBase });

    adapter.resolvePath = (key) => {
      const norm = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
      const candidate = path.join(mediaBase, 'audio', norm);
      if (norm === 'playlist') return { path: candidate, prefix: 'audio' };
      if (norm.startsWith('playlist/')) return { path: candidate, prefix: 'audio' };
      return null;
    };

    adapter.getList = async () => [
      { id: 'files:playlist/track1.mp3', localId: 'playlist/track1.mp3', itemType: 'leaf', getLocalId() { return this.localId; }, isPlayable() { return true; }, metadata: {} },
      { id: 'files:playlist/track2.mp3', localId: 'playlist/track2.mp3', itemType: 'leaf', getLocalId() { return this.localId; }, isPlayable() { return true; }, metadata: {} },
    ];

    adapter.getItem = async (id) => {
      const localId = id.replace(/^(files|media|local):/, '');
      const resolved = adapter.resolvePath(localId);
      if (!resolved) return null;
      // Directory path returns container (not playable) so resolvePlayables falls through to getList
      if (localId === 'playlist') {
        return { id: `files:${localId}`, localId, itemType: 'container', isPlayable() { return false; }, metadata: {} };
      }
      return { id: `files:${localId}`, localId, itemType: 'leaf', isPlayable() { return true; }, metadata: {} };
    };

    const result = await adapter.resolvePlayables('playlist');
    // Non-news path should return ALL items (no freshvideo strategy)
    expect(result.length).toBeGreaterThan(1);
  });
});
