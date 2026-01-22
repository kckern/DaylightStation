// backend/src/4_api/routers/localContent.mjs
import express from 'express';
import path from 'path';
import { parseFile } from 'music-metadata';
import { lookupReference, generateReference } from 'scripture-guide';
import { dirExists, listDirs, getStats, findMediaFileByPrefix } from '../../0_infrastructure/utils/FileIO.mjs';
import { generatePlaceholderImage } from '../../0_infrastructure/utils/placeholderImage.mjs';

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
 * @returns {express.Router}
 */
export function createLocalContentRouter(config) {
  const { registry, dataPath, mediaBasePath } = config;
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
  router.get('/scripture/*', async (req, res) => {
    try {
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
        media_key: `${volume}/${version}/${verseId}`,
        mediaUrl: `/media/audio/scripture/${volume}/${version}/${verseId}`,
        duration: item.duration,
        verses: item.metadata?.verses || []
      });
    } catch (err) {
      console.error('[localContent] scripture error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/hymn/:number
   * Returns hymn with lyrics (legacy parity with /data/hymn/:number)
   */
  router.get('/hymn/:number', async (req, res) => {
    try {
      const { number } = req.params;
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`hymn:${number}`);
      if (!item) {
        return res.status(404).json({ error: 'Hymn not found', number });
      }

      // Legacy parity: use hymn_num, legacy mediaUrl format
      const hymnNumber = item.metadata.number || parseInt(number, 10);

      // Look up actual media file for correct URL and duration (legacy behavior)
      // Try _ldsgc subdirectory first, then root hymn directory
      let mediaUrl = null;
      let duration = item.duration || item.metadata.duration || 0;

      if (mediaBasePath) {
        const preferences = ['_ldsgc', ''];
        for (const pref of preferences) {
          const searchDir = pref
            ? path.join(mediaBasePath, 'audio', 'songs', 'hymn', pref)
            : path.join(mediaBasePath, 'audio', 'songs', 'hymn');
          const mediaFilePath = findMediaFileByPrefix(searchDir, hymnNumber);
          if (mediaFilePath) {
            const subDir = pref ? `${pref}/` : '';
            const filename = path.basename(mediaFilePath, path.extname(mediaFilePath));
            mediaUrl = `/media/audio/songs/hymn/${subDir}${filename}`;

            // Get duration from media file if not already set
            if (!duration) {
              try {
                const metadata = await parseFile(mediaFilePath, { native: true });
                duration = parseInt(metadata?.format?.duration) || 0;
              } catch (e) {
                // Ignore metadata parsing errors
              }
            }
            break;
          }
        }
      }

      res.json({
        title: item.title,
        number: hymnNumber,
        hymn_num: hymnNumber,
        media_key: item.id,
        verses: item.metadata.verses,
        mediaUrl,
        duration
      });
    } catch (err) {
      console.error('[localContent] hymn error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/primary/:number
   * Returns primary song with lyrics (legacy parity with /data/primary/:number)
   */
  router.get('/primary/:number', async (req, res) => {
    try {
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

      // Look up actual media file for correct URL and duration (legacy behavior)
      let mediaUrl = null;
      let duration = item.duration || item.metadata.duration || 0;

      if (mediaBasePath) {
        const searchDir = path.join(mediaBasePath, 'audio', 'songs', 'primary');
        const mediaFilePath = findMediaFileByPrefix(searchDir, songNumber);
        if (mediaFilePath) {
          const filename = path.basename(mediaFilePath, path.extname(mediaFilePath));
          mediaUrl = `/media/audio/songs/primary/${filename}`;

          // Get duration from media file if not already set
          if (!duration) {
            try {
              const metadata = await parseFile(mediaFilePath, { native: true });
              duration = parseInt(metadata?.format?.duration) || 0;
            } catch (e) {
              // Ignore metadata parsing errors
            }
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
    } catch (err) {
      console.error('[localContent] primary error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/talk/*
   * Returns talk with paragraphs for ContentScroller
   */
  router.get('/talk/*', async (req, res) => {
    try {
      const path = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`talk:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Talk not found', path });
      }

      res.json({
        title: item.title,
        speaker: item.metadata.speaker,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        date: item.metadata.date,
        description: item.metadata.description,
        content: item.metadata.content || []
      });
    } catch (err) {
      console.error('[localContent] talk error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/poem/*
   * Returns poem with stanzas for ContentScroller
   */
  router.get('/poem/*', async (req, res) => {
    try {
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
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        verses: item.metadata.verses
      });
    } catch (err) {
      console.error('[localContent] poem error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/cover/*
   * Returns cover art from embedded ID3 or placeholder
   */
  router.get('/cover/*', async (req, res) => {
    const mediaKey = req.params[0] || '';

    if (!mediaKey) {
      return res.status(400).json({ error: 'No media key provided' });
    }

    // Try filesystem adapter for cover art extraction
    const fsAdapter = registry.get('filesystem');

    if (fsAdapter?.getCoverArt) {
      try {
        const coverArt = await fsAdapter.getCoverArt(mediaKey);

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

  return router;
}
