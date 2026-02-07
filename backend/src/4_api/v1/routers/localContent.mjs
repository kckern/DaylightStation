// backend/src/4_api/routers/localContent.mjs
import express from 'express';
import path from 'path';
import { parseFile } from 'music-metadata';
import { lookupReference, generateReference } from 'scripture-guide';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { dirExists, listDirs, getStats, findMediaFileByPrefix, fileExists } from '#system/utils/FileIO.mjs';
import { generatePlaceholderImage } from '#system/utils/placeholderImage.mjs';

// Volume to first verse_id mapping (for determining volume from verse_id)
const VOLUME_RANGES = {
  ot: { start: 1, end: 23145 },
  nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc: { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 }
};

/**
 * Get volume name from verse_id
 */
function getVolumeFromVerseId(verseId) {
  const id = parseInt(verseId, 10);
  for (const [volume, range] of Object.entries(VOLUME_RANGES)) {
    if (id >= range.start && id <= range.end) {
      return volume;
    }
  }
  return null;
}

/**
 * Get default version for a volume (first directory found)
 */
function getDefaultVersion(dataPath, volume) {
  const volumePath = path.join(dataPath, 'content', 'scripture', volume);
  if (!dirExists(volumePath)) return null;
  const dirs = listDirs(volumePath);
  return dirs[0] || null;
}

/**
 * Resolve scripture input to volume/version/verse_id path
 * Supports: "1-nephi-1", "bom", "37707", "bom/sebom/31103"
 */
function resolveScripturePath(input, dataPath) {
  // Already a full path (volume/version/verseId)
  if (input.includes('/')) {
    const parts = input.split('/');
    if (parts.length === 3) {
      return { volume: parts[0], version: parts[1], verseId: parts[2] };
    }
  }

  // Try as reference string (e.g., "1-nephi-1")
  try {
    const ref = lookupReference(input);
    // scripture-guide returns verse_ids array, get first one
    const verseId = ref?.verse_ids?.[0];
    if (verseId) {
      const volume = getVolumeFromVerseId(verseId);
      const version = getDefaultVersion(dataPath, volume);
      return { volume, version, verseId: String(verseId) };
    }
  } catch (e) {
    // Not a valid reference, continue
  }

  // Try as verse_id directly
  const asNumber = parseInt(input, 10);
  if (!isNaN(asNumber) && asNumber > 0) {
    const volume = getVolumeFromVerseId(asNumber);
    const version = getDefaultVersion(dataPath, volume);
    return { volume, version, verseId: String(asNumber) };
  }

  // Try as volume name (return first verse in that volume)
  if (VOLUME_RANGES[input]) {
    const version = getDefaultVersion(dataPath, input);
    return { volume: input, version, verseId: String(VOLUME_RANGES[input].start) };
  }

  return null;
}

/**
 * Create LocalContent API router for scripture, hymns, talks, poetry
 *
 * These endpoints return content-specific response shapes for ContentScroller.
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @param {string} config.dataPath - Base data path
 * @param {string} config.mediaBasePath - Base path for media files
 * @param {Object} [config.mediaProgressMemory] - Media progress memory for watch history
 * @returns {express.Router}
 */
export function createLocalContentRouter(config) {
  const { registry, dataPath, mediaBasePath, mediaProgressMemory } = config;
  const router = express.Router();

  /**
   * GET /api/local-content/scripture/*
   * Returns scripture with verse timings for ContentScroller
   *
   * Supports multiple input formats for legacy parity:
   * - /scripture/1-nephi-1 (reference string)
   * - /scripture/37707 (verse_id)
   * - /scripture/bom (volume - returns first chapter)
   * - /scripture/bom/sebom/31103 (full path)
   */
  router.get('/scripture/*', asyncHandler(async (req, res) => {
      const input = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      // Resolve input to path
      const resolved = resolveScripturePath(input, dataPath || adapter.dataPath);
      if (!resolved || !resolved.volume || !resolved.version || !resolved.verseId) {
        return res.status(400).json({ error: 'Invalid scripture reference', input });
      }

      const { volume, version, verseId } = resolved;
      const scripturePath = `${volume}/${version}/${verseId}`;
      const item = await adapter.getItem(`scripture:${scripturePath}`);

      if (!item) {
        return res.status(404).json({ error: 'Scripture not found', input, resolved: scripturePath });
      }

      // Generate reference string if not in metadata
      let reference = item.metadata?.reference;
      if (!reference) {
        try {
          reference = generateReference(verseId).replace(/:1$/, '');
        } catch (e) {
          reference = input;
        }
      }

      // Response shape for ContentScroller scripture mode (legacy parity)
      res.json({
        input,
        reference,
        volume,
        version,
        verse_id: verseId,
        assetId: `${volume}/${version}/${verseId}`,
        mediaUrl: `/api/v1/proxy/local-content/stream/scripture/${volume}/${version}/${verseId}`,
        duration: item.duration,
        verses: item.metadata?.verses || []
      });
  }));

  /**
   * GET /api/local-content/hymn/:number
   * Returns hymn with lyrics (legacy parity with /data/hymn/:number)
   */
  router.get('/hymn/:number', asyncHandler(async (req, res) => {
      const { number } = req.params;
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`hymn:${number}`);
      if (!item) {
        return res.status(404).json({ error: 'Hymn not found', number });
      }

      // Legacy parity: use hymn_num, use new streaming endpoint
      const hymnNumber = item.metadata.number || parseInt(number, 10);

      // Use the new streaming endpoint - it finds the file by prefix
      const mediaUrl = `/api/v1/proxy/local-content/stream/hymn/${number}`;
      let duration = item.duration || item.metadata.duration || 0;

      // Get duration from media file if not already set
      if (!duration && mediaBasePath) {
        const preferences = ['_ldsgc', ''];
        for (const pref of preferences) {
          const searchDir = pref
            ? path.join(mediaBasePath, 'audio', 'songs', 'hymn', pref)
            : path.join(mediaBasePath, 'audio', 'songs', 'hymn');
          const mediaFilePath = findMediaFileByPrefix(searchDir, hymnNumber);
          if (mediaFilePath) {
            try {
              const metadata = await parseFile(mediaFilePath, { native: true });
              duration = parseInt(metadata?.format?.duration) || 0;
            } catch (e) {
              // Ignore metadata parsing errors
            }
            break;
          }
        }
      }

      res.json({
        title: item.title,
        number: hymnNumber,
        hymn_num: hymnNumber,
        assetId: item.id,
        verses: item.metadata.verses,
        mediaUrl,
        duration
      });
  }));

  /**
   * GET /api/local-content/primary/:number
   * Returns primary song with lyrics (legacy parity with /data/primary/:number)
   */
  router.get('/primary/:number', asyncHandler(async (req, res) => {
      const { number } = req.params;
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`primary:${number}`);
      if (!item) {
        return res.status(404).json({ error: 'Primary song not found', number });
      }

      // Legacy parity: use song_number, legacy mediaUrl format
      const songNumber = item.metadata.number || parseInt(number, 10);

      // Use the new streaming endpoint - it finds the file by prefix
      const mediaUrl = `/api/v1/proxy/local-content/stream/primary/${number}`;
      let duration = item.duration || item.metadata.duration || 0;

      // Get duration from media file if not already set
      if (!duration && mediaBasePath) {
        const searchDir = path.join(mediaBasePath, 'audio', 'songs', 'primary');
        const mediaFilePath = findMediaFileByPrefix(searchDir, songNumber);
        if (mediaFilePath) {
          try {
            const metadata = await parseFile(mediaFilePath, { native: true });
            duration = parseInt(metadata?.format?.duration) || 0;
          } catch (e) {
            // Ignore metadata parsing errors
          }
        }
      }

      res.json({
        title: item.title,
        number: songNumber,
        song_number: songNumber,
        verses: item.metadata.verses,
        mediaUrl,
        duration
      });
  }));

  /**
   * GET /api/local-content/talk/*
   * Returns talk with paragraphs for ContentScroller
   * If path refers to a conference/series, auto-selects next unwatched talk
   */
  router.get('/talk/*', asyncHandler(async (req, res) => {
      const talkPath = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      let item = await adapter.getItem(`talk:${talkPath}`);
      if (!item) {
        return res.status(404).json({ error: 'Talk not found', path: talkPath });
      }

      // If this is a container (conference/series), auto-select next unwatched talk
      // Series contain conferences which contain talks — may need to recurse
      if (item.itemType === 'container' || !item.mediaUrl) {
        const list = await adapter.getList(`talk:${talkPath}`);
        let children = list?.children || [];

        // If children are containers (series → conferences), pick the latest and recurse
        if (children.length > 0 && !children.some(c => c.mediaUrl)) {
          const sorted = [...children].sort((a, b) => {
            const aId = a.localId || a.id || '';
            const bId = b.localId || b.id || '';
            return bId.localeCompare(aId);
          });
          const latestConf = sorted[0];
          const confId = latestConf.id?.replace('talk:', '') || latestConf.localId;
          if (confId) {
            const confList = await adapter.getList(`talk:${confId}`);
            children = confList?.children || [];
          }
        }

        // Filter to children that have an actual video file on disk
        if (mediaBasePath) {
          children = children.filter(child => {
            const mediaFile = child.metadata?.mediaFile;
            return mediaFile && fileExists(path.join(mediaBasePath, mediaFile));
          });
        }

        // Use watch history to find next unwatched talk
        let selectedItem = null;
        if (mediaProgressMemory && children.length > 0) {
          const allProgress = await mediaProgressMemory.getAll('talk');

          // Build watch map: normalize keys to conferenceId/talkNum
          const watchMap = new Map();
          for (const p of allProgress) {
            const key = p.itemId || '';
            let talkId = null;
            if (key.startsWith('plex:video/talks/')) {
              talkId = key.replace('plex:video/talks/', '');
            } else if (key.startsWith('plex:talks/')) {
              talkId = key.replace('plex:talks/', '');
            } else if (key.startsWith('talk:')) {
              talkId = key.replace('talk:', '');
            }
            if (talkId) {
              const parts = talkId.split('/');
              if (parts.length >= 2) {
                const normalized = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
                const existing = watchMap.get(normalized) || 0;
                const percent = p.percent || 0;
                if (percent > existing) {
                  watchMap.set(normalized, percent);
                }
              }
            }
          }

          // Sort children by talk number (ascending, sequential order)
          const sortedChildren = [...children].sort((a, b) => {
            const aNum = parseInt((a.localId || '').split('/').pop(), 10) || 0;
            const bNum = parseInt((b.localId || '').split('/').pop(), 10) || 0;
            return aNum - bNum;
          });

          // Helper to normalize a child's localId for watch map lookup
          const normalizeTalkId = (localId) => {
            const parts = (localId || '').split('/');
            return `${parts[parts.length - 2] || ''}/${parts[parts.length - 1] || ''}`;
          };

          // Prefer in-progress talks (started but not finished, >0% and <90%)
          const inProgress = sortedChildren.find(child => {
            const normalized = normalizeTalkId(child.localId);
            const percent = watchMap.get(normalized) || 0;
            return percent > 0 && percent < 90;
          });

          if (inProgress) {
            selectedItem = inProgress;
          } else {
            // Next completely unwatched talk (<90%)
            const unwatched = sortedChildren.find(child => {
              const normalized = normalizeTalkId(child.localId);
              const percent = watchMap.get(normalized) || 0;
              return percent < 90;
            });
            selectedItem = unwatched || sortedChildren[0]; // fallback to first if all watched
          }
        }

        if (selectedItem) {
          item = selectedItem;
        } else {
          // Fallback when no mediaProgressMemory: first playable
          const firstPlayable = children.find(child => child.mediaUrl);
          if (firstPlayable) {
            item = firstPlayable;
          } else if (children.length > 0) {
            const firstChild = children[0];
            const childId = firstChild.localId || firstChild.id?.replace('talk:', '');
            if (childId) {
              item = await adapter.getItem(`talk:${childId}`);
            }
          }
        }

        if (!item || !item.mediaUrl) {
          return res.status(404).json({ error: 'No playable talks found in conference', path: talkPath });
        }
      }

      // Get duration from mp4 file if not already set
      let duration = item.duration || 0;
      if (!duration && mediaBasePath) {
        const mediaFile = item.metadata?.mediaFile;
        if (mediaFile) {
          const mediaFilePath = path.join(mediaBasePath, mediaFile);
          if (fileExists(mediaFilePath)) {
            try {
              const meta = await parseFile(mediaFilePath, { native: true });
              duration = Math.round(meta?.format?.duration) || 0;
            } catch (e) {
              // Ignore metadata parsing errors
            }
          }
        }
      }

      res.json({
        title: item.title,
        speaker: item.metadata?.speaker,
        assetId: item.id,
        mediaUrl: item.mediaUrl,
        duration,
        date: item.metadata?.date,
        description: item.metadata?.description,
        content: item.metadata?.content || []
      });
  }));

  /**
   * GET /api/local-content/poem/*
   * Returns poem with stanzas for ContentScroller
   */
  router.get('/poem/*', asyncHandler(async (req, res) => {
      const path = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`poem:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Poem not found', path });
      }

      res.json({
        title: item.title,
        author: item.metadata.author,
        condition: item.metadata.condition,
        also_suitable_for: item.metadata.also_suitable_for,
        poem_id: item.metadata.poem_id,
        assetId: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        verses: item.metadata.verses
      });
  }));

  /**
   * GET /api/local-content/cover/*
   * Returns cover art from embedded ID3 or placeholder
   */
  router.get('/cover/*', async (req, res) => {
    const mediaKey = req.params[0] || '';

    if (!mediaKey) {
      return res.status(400).json({ error: 'No media key provided' });
    }

    // Try media adapter for cover art extraction
    const mediaAdapter = registry.get('media');

    if (mediaAdapter?.getCoverArt) {
      try {
        const coverArt = await mediaAdapter.getCoverArt(mediaKey);

        if (coverArt) {
          res.set({
            'Content-Type': coverArt.mimeType,
            'Content-Length': coverArt.buffer.length,
            'Cache-Control': 'public, max-age=86400'
          });
          return res.send(coverArt.buffer);
        }
      } catch (err) {
        console.error('[localContent] cover art extraction error:', err.message);
      }
    }

    // Generate placeholder
    const placeholder = generatePlaceholderImage(mediaKey);
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': placeholder.length,
      'Cache-Control': 'public, max-age=86400'
    });
    return res.send(placeholder);
  });

  /**
   * GET /api/local-content/collection-icon/:adapter/:collection
   * Serves the SVG icon for a content collection from the data mount.
   * Resolution: manifest `icon` field → convention `icon.svg` → 404
   */
  router.get('/collection-icon/:adapter/:collection', asyncHandler(async (req, res) => {
    const { adapter: adapterName, collection } = req.params;
    const adapter = registry.get(adapterName);

    if (!adapter?.resolveCollectionIcon) {
      return res.status(404).json({ error: 'Adapter not found or does not support icons' });
    }

    const iconPath = adapter.resolveCollectionIcon(collection);
    if (!iconPath) {
      return res.status(404).json({ error: 'No icon found for collection', collection });
    }

    const ext = path.extname(iconPath).toLowerCase();
    const mimeTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    res.set('Content-Type', mimeTypes[ext] || 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(iconPath);
  }));

  /**
   * GET /api/local-content/collection/:name
   * Returns all items in a collection (hymn, primary, talk, scripture, poem)
   * Used by admin UI for sibling browsing
   */
  router.get('/collection/:name', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const adapter = registry.get('local-content');

    if (!adapter) {
      return res.status(500).json({ error: 'LocalContent adapter not configured' });
    }

    const items = await adapter.listCollection(name);
    res.json({
      collection: name,
      items: items.map(item => ({
        id: item.id,
        source: name,
        localId: item.localId,
        title: item.title,
        type: item.type || item.itemType || null,
        thumbnail: item.thumbnail || null,
      }))
    });
  }));

  return router;
}

export default createLocalContentRouter;
