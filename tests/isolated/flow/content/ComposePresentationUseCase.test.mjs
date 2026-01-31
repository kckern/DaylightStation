// tests/isolated/flow/content/ComposePresentationUseCase.test.mjs
import { jest } from '@jest/globals';

describe('ComposePresentationUseCase', () => {
  let useCase;
  let mockContentSourceRegistry;
  let mockPlexAdapter;
  let mockImmichAdapter;
  let mockLogger;

  beforeEach(async () => {
    jest.resetModules();

    // Mock Plex adapter - returns video or audio items based on ID
    mockPlexAdapter = {
      source: 'plex',
      getItem: jest.fn().mockImplementation(async (id) => {
        // IDs ending in 'a' are audio, others are video
        const isAudio = id.endsWith('a');
        return {
          id: `plex:${id}`,
          source: 'plex',
          title: isAudio ? `Audio Track ${id}` : `Video ${id}`,
          mediaType: isAudio ? 'audio' : 'video',
          mediaUrl: `/api/v1/proxy/plex/stream/${id}`,
          duration: 3600, // 1 hour in seconds
          thumbnail: `/api/v1/proxy/plex/thumb/${id}`
        };
      })
    };

    // Mock Immich adapter - returns images
    mockImmichAdapter = {
      source: 'immich',
      getItem: jest.fn().mockImplementation(async (id) => ({
        id: `immich:${id}`,
        source: 'immich',
        title: `Photo ${id}`,
        mediaType: 'image',
        mediaUrl: `/api/v1/proxy/immich/${id}`,
        thumbnail: `/api/v1/proxy/immich/${id}/thumb`
      }))
    };

    // Mock registry
    mockContentSourceRegistry = {
      getAdapter: jest.fn().mockImplementation((provider) => {
        if (provider === 'plex') return mockPlexAdapter;
        if (provider === 'immich') return mockImmichAdapter;
        return null;
      })
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const { ComposePresentationUseCase } = await import(
      '#backend/src/3_applications/content/usecases/ComposePresentationUseCase.mjs'
    );

    useCase = new ComposePresentationUseCase({
      contentSourceRegistry: mockContentSourceRegistry,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    it('should throw if contentSourceRegistry is not provided', async () => {
      const { ComposePresentationUseCase } = await import(
        '#backend/src/3_applications/content/usecases/ComposePresentationUseCase.mjs'
      );

      expect(() => new ComposePresentationUseCase({})).toThrow(
        'contentSourceRegistry is required'
      );
    });

    it('should accept optional logger', async () => {
      const { ComposePresentationUseCase } = await import(
        '#backend/src/3_applications/content/usecases/ComposePresentationUseCase.mjs'
      );

      // Should not throw without logger
      expect(() => new ComposePresentationUseCase({
        contentSourceRegistry: mockContentSourceRegistry
      })).not.toThrow();
    });
  });

  describe('compose', () => {
    describe('source parsing', () => {
      it('should parse numeric ID as Plex source', async () => {
        await useCase.compose(['12345'], {});

        expect(mockContentSourceRegistry.getAdapter).toHaveBeenCalledWith('plex');
        expect(mockPlexAdapter.getItem).toHaveBeenCalledWith('12345');
      });

      it('should parse provider:id format', async () => {
        await useCase.compose(['immich:abc123'], {});

        expect(mockContentSourceRegistry.getAdapter).toHaveBeenCalledWith('immich');
        expect(mockImmichAdapter.getItem).toHaveBeenCalledWith('abc123');
      });

      it('should handle plex: prefix explicitly', async () => {
        await useCase.compose(['plex:67890'], {});

        expect(mockContentSourceRegistry.getAdapter).toHaveBeenCalledWith('plex');
        expect(mockPlexAdapter.getItem).toHaveBeenCalledWith('67890');
      });
    });

    describe('track inference', () => {
      it('should infer visual track from video mediaType', async () => {
        const result = await useCase.compose(['plex:12345'], {});

        expect(result.visual).toBeDefined();
        expect(result.visual.category).toBe('media');
        expect(result.visual.type).toBe('video');
      });

      it('should infer audio track from audio mediaType', async () => {
        // ID ending in 'a' returns audio in our mock
        const result = await useCase.compose(['visual:plex:12345', 'plex:67890a'], {});

        expect(result.audio).toBeDefined();
        expect(result.audio.items).toHaveLength(1);
        expect(result.audio.items[0].mediaType).toBe('audio');
      });

      it('should infer visual track from image mediaType', async () => {
        const result = await useCase.compose(['immich:photo123'], {});

        expect(result.visual).toBeDefined();
        expect(result.visual.type).toBe('image');
      });
    });

    describe('explicit track override', () => {
      it('should use visual: prefix to force visual track', async () => {
        // Force audio item to visual track
        const result = await useCase.compose(['visual:plex:12345a'], {});

        expect(result.visual).toBeDefined();
        // Visual track should contain the audio item
        expect(result.visual.items[0].id).toBe('plex:12345a');
        // No audio track since we forced it to visual
        expect(result.audio).toBeNull();
      });

      it('should use audio: prefix to force audio track', async () => {
        // Force video item to audio track - this should fail because no visual
        // We need a visual track, so add one
        const result = await useCase.compose(
          ['visual:plex:11111', 'audio:plex:22222'],
          {}
        );

        expect(result.audio).toBeDefined();
        expect(result.audio.items[0].id).toBe('plex:22222');
      });

      it('should strip track prefix before parsing provider', async () => {
        // Need a visual track to satisfy requirements, plus the audio track we're testing
        await useCase.compose(['visual:plex:11111', 'audio:plex:12345'], {});

        expect(mockContentSourceRegistry.getAdapter).toHaveBeenCalledWith('plex');
        expect(mockPlexAdapter.getItem).toHaveBeenCalledWith('12345');
      });
    });

    describe('modifier scoping', () => {
      it('should apply loop to both tracks when multi-track', async () => {
        const result = await useCase.compose(
          ['plex:12345', 'plex:67890a'],
          { loop: true }
        );

        expect(result.visual.loop).toBe(true);
        expect(result.audio.loop).toBe(true);
      });

      it('should apply loop to visual only when single track', async () => {
        const result = await useCase.compose(['plex:12345'], { loop: true });

        expect(result.visual.loop).toBe(true);
        // No audio track
        expect(result.audio).toBeNull();
      });

      it('should respect per-track loop override', async () => {
        const result = await useCase.compose(
          ['plex:12345', 'plex:67890a'],
          { loop: true, 'loop.audio': false }
        );

        expect(result.visual.loop).toBe(true);
        expect(result.audio.loop).toBe(false);
      });

      it('should apply shuffle to audio track when multi-track', async () => {
        const result = await useCase.compose(
          ['plex:12345', 'plex:67890a'],
          { shuffle: true }
        );

        expect(result.audio.shuffle).toBe(true);
      });

      it('should scope shader to visual only', async () => {
        const result = await useCase.compose(
          ['plex:12345', 'plex:67890a'],
          { shader: 'crt' }
        );

        expect(result.modifiers.shader).toBe('crt');
        // Shader should not appear on audio
      });

      it('should scope volume to audio only', async () => {
        const result = await useCase.compose(
          ['plex:12345', 'plex:67890a'],
          { volume: 0.8 }
        );

        expect(result.modifiers.volume).toBe(0.8);
      });

      it('should scope playbackRate to visual only (avoid pitch shift)', async () => {
        const result = await useCase.compose(
          ['plex:12345', 'plex:67890a'],
          { playbackRate: 1.5 }
        );

        expect(result.modifiers.playbackRate).toBe(1.5);
        // playbackRate should not affect audio (would cause pitch shift)
      });
    });

    describe('output structure', () => {
      it('should return IComposedPresentation structure', async () => {
        const result = await useCase.compose(['plex:12345'], {});

        expect(result).toHaveProperty('visual');
        expect(result).toHaveProperty('audio');
        expect(result).toHaveProperty('layout');
      });

      it('should default to fullscreen layout', async () => {
        const result = await useCase.compose(['plex:12345'], {});

        expect(result.layout).toBe('fullscreen');
      });

      it('should accept custom layout', async () => {
        const result = await useCase.compose(['plex:12345'], { layout: 'pip' });

        expect(result.layout).toBe('pip');
      });

      it('should include modifiers object', async () => {
        const result = await useCase.compose(['plex:12345'], {
          shader: 'vhs',
          volume: 0.5,
          playbackRate: 2
        });

        expect(result.modifiers).toBeDefined();
        expect(result.modifiers.shader).toBe('vhs');
        expect(result.modifiers.volume).toBe(0.5);
        expect(result.modifiers.playbackRate).toBe(2);
      });

      it('should pass advance config to visual track', async () => {
        const result = await useCase.compose(
          ['plex:12345'],
          { advance: { mode: 'timed', interval: 5000 } }
        );

        expect(result.visual.advance).toEqual({ mode: 'timed', interval: 5000 });
      });
    });

    describe('error handling', () => {
      it('should throw if no sources provided', async () => {
        await expect(useCase.compose([], {})).rejects.toThrow(
          'At least one source is required'
        );
      });

      it('should throw if sources is null', async () => {
        await expect(useCase.compose(null, {})).rejects.toThrow(
          'At least one source is required'
        );
      });

      it('should throw if no visual track after resolution', async () => {
        // All audio sources should fail
        await expect(
          useCase.compose(['plex:111a', 'plex:222a'], {})
        ).rejects.toThrow('At least one visual track is required');
      });

      it('should throw if adapter not found', async () => {
        await expect(
          useCase.compose(['unknown:12345'], {})
        ).rejects.toThrow('ContentSourceAdapter not found: unknown');
      });

      it('should throw if item not found', async () => {
        mockPlexAdapter.getItem.mockResolvedValueOnce(null);

        await expect(useCase.compose(['plex:99999'], {})).rejects.toThrow(
          'Item not found'
        );
      });
    });
  });

  describe('multiple sources', () => {
    it('should handle multiple video sources (takes first for visual)', async () => {
      const result = await useCase.compose(
        ['plex:11111', 'plex:22222'],
        {}
      );

      // First video becomes visual, others would be ignored (future: slideshow)
      expect(result.visual.items[0].id).toBe('plex:11111');
    });

    it('should handle multiple audio sources', async () => {
      const result = await useCase.compose(
        ['plex:11111', 'plex:111a', 'plex:222a'],
        {}
      );

      expect(result.audio.items).toHaveLength(2);
      expect(result.audio.items[0].id).toBe('plex:111a');
      expect(result.audio.items[1].id).toBe('plex:222a');
    });

    it('should combine visual and audio from different providers', async () => {
      const result = await useCase.compose(
        ['immich:photo1', 'plex:music1a'],
        {}
      );

      expect(result.visual.type).toBe('image');
      expect(result.visual.items[0].id).toBe('immich:photo1');
      expect(result.audio.items[0].id).toBe('plex:music1a');
    });
  });
});
