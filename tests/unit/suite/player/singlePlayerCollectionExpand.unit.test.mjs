/**
 * Unit tests for SinglePlayer collection expansion logic
 *
 * Tests the detection logic that determines whether a media info response
 * is playable (video/audio) or a collection that needs expansion.
 *
 * @see frontend/src/modules/Player/components/SinglePlayer.jsx
 */

describe('SinglePlayer Collection Expansion Logic', () => {
  /**
   * The isPlayable check from SinglePlayer.jsx (line ~225):
   * const isPlayable = info.media_url || ['dash_video', 'video', 'audio'].includes(info.media_type);
   */
  const isPlayable = (info) =>
    Boolean(info.media_url) || ['dash_video', 'video', 'audio'].includes(info.media_type);

  describe('isPlayable detection', () => {
    describe('should return false for collection responses', () => {
      test('collection with no media_url and no playable media_type', () => {
        const collectionInfo = {
          title: 'Movies Collection',
          media_type: 'collection',
          items: []
        };
        expect(isPlayable(collectionInfo)).toBe(false);
      });

      test('folder with no media_url and folder media_type', () => {
        const folderInfo = {
          title: 'My Folder',
          media_type: 'folder',
          path: '/some/path'
        };
        expect(isPlayable(folderInfo)).toBe(false);
      });

      test('show with no media_url and show media_type', () => {
        const showInfo = {
          title: 'TV Show',
          media_type: 'show',
          seasons: 5
        };
        expect(isPlayable(showInfo)).toBe(false);
      });

      test('season with no media_url and season media_type', () => {
        const seasonInfo = {
          title: 'Season 1',
          media_type: 'season',
          episodes: 10
        };
        expect(isPlayable(seasonInfo)).toBe(false);
      });

      test('undefined media_type with no media_url', () => {
        const emptyInfo = {
          title: 'Unknown'
        };
        expect(isPlayable(emptyInfo)).toBe(false);
      });

      test('null media_type with no media_url', () => {
        const nullInfo = {
          title: 'Unknown',
          media_type: null
        };
        expect(isPlayable(nullInfo)).toBe(false);
      });
    });

    describe('should return true for video responses', () => {
      test('video with media_url', () => {
        const videoInfo = {
          title: 'Movie',
          media_type: 'video',
          media_url: '/proxy/plex/stream/12345'
        };
        expect(isPlayable(videoInfo)).toBe(true);
      });

      test('dash_video type', () => {
        const dashInfo = {
          title: 'Movie (DASH)',
          media_type: 'dash_video',
          media_url: '/proxy/plex/stream/12345/dash'
        };
        expect(isPlayable(dashInfo)).toBe(true);
      });

      test('video type without media_url (still playable by type)', () => {
        const videoTypeOnly = {
          title: 'Video',
          media_type: 'video'
        };
        expect(isPlayable(videoTypeOnly)).toBe(true);
      });

      test('dash_video type without media_url (still playable by type)', () => {
        const dashTypeOnly = {
          title: 'DASH Video',
          media_type: 'dash_video'
        };
        expect(isPlayable(dashTypeOnly)).toBe(true);
      });
    });

    describe('should return true for audio responses', () => {
      test('audio with media_url', () => {
        const audioInfo = {
          title: 'Song',
          media_type: 'audio',
          media_url: '/proxy/filesystem/stream/music/song.mp3'
        };
        expect(isPlayable(audioInfo)).toBe(true);
      });

      test('audio type without media_url (still playable by type)', () => {
        const audioTypeOnly = {
          title: 'Audio',
          media_type: 'audio'
        };
        expect(isPlayable(audioTypeOnly)).toBe(true);
      });
    });

    describe('should return true when media_url is present regardless of type', () => {
      test('collection type but has media_url', () => {
        const weirdCollection = {
          title: 'Weird Collection',
          media_type: 'collection',
          media_url: '/proxy/some/stream'
        };
        expect(isPlayable(weirdCollection)).toBe(true);
      });

      test('unknown type but has media_url', () => {
        const unknownWithUrl = {
          title: 'Unknown',
          media_type: 'unknown',
          media_url: '/proxy/stream'
        };
        expect(isPlayable(unknownWithUrl)).toBe(true);
      });

      test('no type but has media_url', () => {
        const noTypeWithUrl = {
          title: 'Media',
          media_url: '/proxy/stream'
        };
        expect(isPlayable(noTypeWithUrl)).toBe(true);
      });
    });
  });

  describe('Plex ID extraction fallback chain', () => {
    /**
     * The plex ID extraction from SinglePlayer.jsx (line ~233):
     * const firstItemPlex = firstItem.plex || firstItem.play?.plex || firstItem.metadata?.plex;
     */
    const extractPlexId = (item) =>
      item.plex || item.play?.plex || item.metadata?.plex || null;

    test('extracts plex ID from top-level plex property', () => {
      const item = {
        title: 'Movie',
        plex: '12345'
      };
      expect(extractPlexId(item)).toBe('12345');
    });

    test('falls back to play.plex when plex is missing', () => {
      const item = {
        title: 'Movie',
        play: { plex: '67890' }
      };
      expect(extractPlexId(item)).toBe('67890');
    });

    test('falls back to metadata.plex when plex and play.plex are missing', () => {
      const item = {
        title: 'Movie',
        metadata: { plex: 'abcde' }
      };
      expect(extractPlexId(item)).toBe('abcde');
    });

    test('top-level plex takes precedence over play.plex', () => {
      const item = {
        title: 'Movie',
        plex: '12345',
        play: { plex: '67890' }
      };
      expect(extractPlexId(item)).toBe('12345');
    });

    test('play.plex takes precedence over metadata.plex', () => {
      const item = {
        title: 'Movie',
        play: { plex: '67890' },
        metadata: { plex: 'abcde' }
      };
      expect(extractPlexId(item)).toBe('67890');
    });

    test('returns null when no plex ID is found', () => {
      const item = {
        title: 'Movie',
        id: 'some-id'
      };
      expect(extractPlexId(item)).toBeNull();
    });

    test('returns null for empty object', () => {
      expect(extractPlexId({})).toBeNull();
    });

    test('handles missing play object gracefully', () => {
      const item = {
        title: 'Movie',
        metadata: { plex: 'abcde' }
      };
      // Should not throw, should fall through to metadata.plex
      expect(extractPlexId(item)).toBe('abcde');
    });

    test('handles missing metadata object gracefully', () => {
      const item = {
        title: 'Movie',
        play: { plex: '67890' }
      };
      // Should not throw, should return play.plex
      expect(extractPlexId(item)).toBe('67890');
    });

    test('handles null plex values correctly', () => {
      const item = {
        title: 'Movie',
        plex: null,
        play: { plex: '67890' }
      };
      // null is falsy, so it should fall back to play.plex
      expect(extractPlexId(item)).toBe('67890');
    });

    test('handles empty string plex values correctly', () => {
      const item = {
        title: 'Movie',
        plex: '',
        play: { plex: '67890' }
      };
      // Empty string is falsy, so it should fall back to play.plex
      expect(extractPlexId(item)).toBe('67890');
    });
  });

  describe('Edge cases', () => {
    test('isPlayable handles empty object', () => {
      expect(isPlayable({})).toBe(false);
    });

    test('isPlayable handles null/undefined media_url', () => {
      expect(isPlayable({ media_url: null })).toBe(false);
      expect(isPlayable({ media_url: undefined })).toBe(false);
    });

    test('isPlayable handles empty string media_url', () => {
      // Empty string is falsy, so should return false unless type is playable
      expect(isPlayable({ media_url: '' })).toBe(false);
      expect(isPlayable({ media_url: '', media_type: 'video' })).toBe(true);
    });
  });
});
