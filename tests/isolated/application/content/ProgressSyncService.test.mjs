import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { ProgressSyncService } from '#apps/content/services/ProgressSyncService.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

// ── Mock factories ───────────────────────────────────────────────────

function createMockRemoteProgressProvider() {
  return {
    getProgress: jest.fn(),
    updateProgress: jest.fn(),
  };
}

function createMockMediaProgressMemory() {
  const store = new Map();
  return {
    get: jest.fn(async (itemId) => store.get(itemId) || null),
    set: jest.fn(async (state, storagePath) => store.set(state.itemId, state)),
    _store: store,
  };
}

function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function createService(overrides = {}) {
  const remoteProgressProvider = createMockRemoteProgressProvider();
  const mediaProgressMemory = createMockMediaProgressMemory();
  const logger = createMockLogger();

  const service = new ProgressSyncService({
    remoteProgressProvider,
    mediaProgressMemory,
    logger,
    ...overrides,
  });

  return { service, remoteProgressProvider, mediaProgressMemory, logger };
}

// ── Helper: build a MediaProgress with sensible defaults ─────────────

function makeLocalProgress(overrides = {}) {
  return new MediaProgress({
    itemId: 'abs:book-1',
    playhead: 600,
    duration: 36000,
    playCount: 1,
    lastPlayed: '2026-02-10T12:00:00Z',
    watchTime: 600,
    ...overrides,
  });
}

function makeRemoteProgress(overrides = {}) {
  return {
    currentTime: 900,
    isFinished: false,
    lastUpdate: Math.floor(new Date('2026-02-11T12:00:00Z').getTime() / 1000),
    duration: 36000,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ProgressSyncService', () => {
  let service, remoteProgressProvider, mediaProgressMemory, logger;

  beforeEach(() => {
    jest.useFakeTimers();
    ({ service, remoteProgressProvider, mediaProgressMemory, logger } = createService());
  });

  afterEach(() => {
    service.dispose();
    jest.useRealTimers();
  });

  // ── reconcileOnPlay ──────────────────────────────────────────────

  describe('reconcileOnPlay', () => {
    it('returns local when remote fetch fails (network error)', async () => {
      const local = makeLocalProgress();
      mediaProgressMemory._store.set('abs:book-1', local);
      remoteProgressProvider.getProgress.mockRejectedValue(new Error('Network error'));

      const result = await service.reconcileOnPlay('abs:book-1', 'plex/audiobooks', 'li_abc123');

      expect(result).toBeDefined();
      expect(result.itemId).toBe('abs:book-1');
      expect(result.playhead).toBe(600);
    });

    it('returns remote values when local is null', async () => {
      // No local progress in store
      const remote = makeRemoteProgress({ currentTime: 900 });
      remoteProgressProvider.getProgress.mockResolvedValue(remote);

      const result = await service.reconcileOnPlay('abs:book-1', 'plex/audiobooks', 'li_abc123');

      expect(result).toBeDefined();
      expect(result.playhead).toBe(900);
    });

    it('saves session-start bookmark when local has playhead > 0', async () => {
      const local = makeLocalProgress({ playhead: 600 });
      mediaProgressMemory._store.set('abs:book-1', local);
      remoteProgressProvider.getProgress.mockResolvedValue(null);

      await service.reconcileOnPlay('abs:book-1', 'plex/audiobooks', 'li_abc123');

      // Check that set was called (saving the bookmark)
      expect(mediaProgressMemory.set).toHaveBeenCalled();
      const savedProgress = mediaProgressMemory.set.mock.calls[0][0];
      expect(savedProgress.bookmark).toBeDefined();
      expect(savedProgress.bookmark.playhead).toBe(600);
      expect(savedProgress.bookmark.reason).toBe('session-start');
    });

    it('updates local when remote wins (remote is newer)', async () => {
      const local = makeLocalProgress({
        playhead: 300,
        lastPlayed: '2026-02-09T12:00:00Z',
      });
      mediaProgressMemory._store.set('abs:book-1', local);

      const remote = makeRemoteProgress({
        currentTime: 900,
        lastUpdate: Math.floor(new Date('2026-02-11T12:00:00Z').getTime() / 1000),
      });
      remoteProgressProvider.getProgress.mockResolvedValue(remote);

      const result = await service.reconcileOnPlay('abs:book-1', 'plex/audiobooks', 'li_abc123');

      expect(result).toBeDefined();
      expect(result.playhead).toBe(900);
      // Should have updated the local store with remote values
      expect(mediaProgressMemory.set).toHaveBeenCalled();
    });

    it('returns null when both local and remote are null', async () => {
      // No local in store, remote returns null
      remoteProgressProvider.getProgress.mockResolvedValue(null);

      const result = await service.reconcileOnPlay('abs:book-1', 'plex/audiobooks', 'li_abc123');

      expect(result).toBeNull();
    });

    it('initializes skepticalMap entry with resolved playhead and storagePath', async () => {
      const local = makeLocalProgress({ playhead: 600 });
      mediaProgressMemory._store.set('abs:book-1', local);
      remoteProgressProvider.getProgress.mockResolvedValue(null);

      await service.reconcileOnPlay('abs:book-1', 'plex/audiobooks', 'li_abc123');

      const tracking = service._skepticalMap.get('abs:book-1');
      expect(tracking).toBeDefined();
      expect(tracking.lastCommittedPlayhead).toBe(600);
      expect(tracking.storagePath).toBe('plex/audiobooks');
    });

    it('buffers remote write-back when local wins', async () => {
      const local = makeLocalProgress({
        playhead: 900,
        lastPlayed: '2026-02-11T14:00:00Z',
      });
      mediaProgressMemory._store.set('abs:book-1', local);

      const remote = makeRemoteProgress({
        currentTime: 300,
        lastUpdate: Math.floor(new Date('2026-02-09T12:00:00Z').getTime() / 1000),
      });
      remoteProgressProvider.getProgress.mockResolvedValue(remote);

      const result = await service.reconcileOnPlay('abs:book-1', 'plex/audiobooks', 'li_abc123');

      expect(result.playhead).toBe(900);
      // Should have buffered a write-back to remote
      expect(service._debounceMap.has('abs:book-1')).toBe(true);
    });
  });

  // ── onProgressUpdate ─────────────────────────────────────────────

  describe('onProgressUpdate', () => {
    it('buffers small jump for debounced remote write', async () => {
      // Set up skeptical tracking with a close playhead
      service._skepticalMap.set('abs:book-1', {
        lastCommittedPlayhead: 600,
        watchTimeAccumulated: 0,
        storagePath: 'plex/audiobooks',
      });

      await service.onProgressUpdate('abs:book-1', 'li_abc123', {
        playhead: 650,
        duration: 36000,
        percent: 2,
        watchTime: 50,
      });

      expect(service._debounceMap.has('abs:book-1')).toBe(true);
      const entry = service._debounceMap.get('abs:book-1');
      expect(entry.latestProgress.currentTime).toBe(650);
    });

    it('enters skeptical state on large jump (debounceMap is empty)', async () => {
      service._skepticalMap.set('abs:book-1', {
        lastCommittedPlayhead: 600,
        watchTimeAccumulated: 0,
        storagePath: 'plex/audiobooks',
      });

      await service.onProgressUpdate('abs:book-1', 'li_abc123', {
        playhead: 5000,
        duration: 36000,
        percent: 14,
        watchTime: 5,
      });

      // Should NOT buffer because large jump + insufficient watch time
      expect(service._debounceMap.has('abs:book-1')).toBe(false);
    });

    it('commits after sufficient watch time post-jump', async () => {
      service._skepticalMap.set('abs:book-1', {
        lastCommittedPlayhead: 600,
        watchTimeAccumulated: 0,
        storagePath: 'plex/audiobooks',
      });

      // First update: large jump, not yet committed
      await service.onProgressUpdate('abs:book-1', 'li_abc123', {
        playhead: 5000,
        duration: 36000,
        percent: 14,
        watchTime: 30,
      });
      expect(service._debounceMap.has('abs:book-1')).toBe(false);

      // Second update: still accumulating, now >= 60s total
      await service.onProgressUpdate('abs:book-1', 'li_abc123', {
        playhead: 5060,
        duration: 36000,
        percent: 14,
        watchTime: 35,
      });

      // watchTimeAccumulated = 30 + 35 = 65 >= 60, should now be committed
      expect(service._debounceMap.has('abs:book-1')).toBe(true);
      const tracking = service._skepticalMap.get('abs:book-1');
      expect(tracking.lastCommittedPlayhead).toBe(5060);
    });

    it('saves pre-jump bookmark on large jump with existing progress', async () => {
      // Pre-populate a local progress so the bookmark save can find it
      const existing = makeLocalProgress({ playhead: 600 });
      mediaProgressMemory._store.set('abs:book-1', existing);

      service._skepticalMap.set('abs:book-1', {
        lastCommittedPlayhead: 600,
        watchTimeAccumulated: 0,
        storagePath: 'plex/audiobooks',
      });

      await service.onProgressUpdate('abs:book-1', 'li_abc123', {
        playhead: 5000,
        duration: 36000,
        percent: 14,
        watchTime: 5,
      });

      // The pre-jump bookmark is fire-and-forget — flush microtask queue
      // Use multiple microtask flushes to let the chained .then() resolve
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Should have saved a pre-jump bookmark via mediaProgressMemory
      expect(mediaProgressMemory.set).toHaveBeenCalled();
      const savedProgress = mediaProgressMemory.set.mock.calls[0][0];
      expect(savedProgress.bookmark).toBeDefined();
      expect(savedProgress.bookmark.reason).toBe('pre-jump');
      expect(savedProgress.bookmark.playhead).toBe(600);
    });

    it('passes storagePath to mediaProgressMemory in pre-jump bookmark', async () => {
      const existing = makeLocalProgress({ playhead: 600 });
      mediaProgressMemory._store.set('abs:book-1', existing);

      service._skepticalMap.set('abs:book-1', {
        lastCommittedPlayhead: 600,
        watchTimeAccumulated: 0,
        storagePath: 'plex/audiobooks',
      });

      await service.onProgressUpdate('abs:book-1', 'li_abc123', {
        playhead: 5000,
        duration: 36000,
        percent: 14,
        watchTime: 5,
      });

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Verify get was called with storagePath
      expect(mediaProgressMemory.get).toHaveBeenCalledWith('abs:book-1', 'plex/audiobooks');
      // Verify set was called with storagePath
      expect(mediaProgressMemory.set).toHaveBeenCalled();
      const setCall = mediaProgressMemory.set.mock.calls[0];
      expect(setCall[1]).toBe('plex/audiobooks');
    });

    it('creates skepticalMap entry if not present', async () => {
      await service.onProgressUpdate('abs:book-1', 'li_abc123', {
        playhead: 100,
        duration: 36000,
        percent: 0,
        watchTime: 10,
      });

      expect(service._skepticalMap.has('abs:book-1')).toBe(true);
    });
  });

  // ── flush ────────────────────────────────────────────────────────

  describe('flush', () => {
    it('writes all pending debounced updates', async () => {
      remoteProgressProvider.updateProgress.mockResolvedValue(undefined);

      // Manually populate the debounce map with pending writes
      service._debounceMap.set('abs:book-1', {
        timer: setTimeout(() => {}, 30000),
        localId: 'li_abc123',
        latestProgress: { currentTime: 900, isFinished: false },
      });
      service._debounceMap.set('abs:book-2', {
        timer: setTimeout(() => {}, 30000),
        localId: 'li_def456',
        latestProgress: { currentTime: 1200, isFinished: true },
      });

      await service.flush(5000);

      expect(remoteProgressProvider.updateProgress).toHaveBeenCalledTimes(2);
      expect(remoteProgressProvider.updateProgress).toHaveBeenCalledWith('li_abc123', { currentTime: 900, isFinished: false });
      expect(remoteProgressProvider.updateProgress).toHaveBeenCalledWith('li_def456', { currentTime: 1200, isFinished: true });
      expect(service._debounceMap.size).toBe(0);
    });

    it('handles remote errors during flush gracefully (does not throw)', async () => {
      remoteProgressProvider.updateProgress.mockRejectedValue(new Error('Remote server down'));

      service._debounceMap.set('abs:book-1', {
        timer: setTimeout(() => {}, 30000),
        localId: 'li_abc123',
        latestProgress: { currentTime: 900, isFinished: false },
      });

      // Should not throw
      await expect(service.flush(5000)).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });

    it('resolves immediately when debounce map is empty', async () => {
      await expect(service.flush(5000)).resolves.not.toThrow();
      expect(remoteProgressProvider.updateProgress).not.toHaveBeenCalled();
    });
  });

  // ── dispose ──────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears all debounce timers', () => {
      service._debounceMap.set('abs:book-1', {
        timer: setTimeout(() => {}, 30000),
        localId: 'li_abc123',
        latestProgress: { currentTime: 900, isFinished: false },
      });

      service.dispose();

      expect(service._debounceMap.size).toBe(0);
    });

    it('clears skeptical map', () => {
      service._skepticalMap.set('abs:book-1', {
        lastCommittedPlayhead: 600,
        watchTimeAccumulated: 0,
        storagePath: 'plex/audiobooks',
      });

      service.dispose();

      expect(service._skepticalMap.size).toBe(0);
    });
  });
});
