import { describe, expect, it, vi } from 'vitest';
import { ContentAccessService } from './ContentAccessService.mjs';

describe('ContentAccessService', () => {
  it('resolves display metadata without exposing the adapter to HTTP', async () => {
    const contentCatalog = {
      getThumbnailUrl: vi.fn().mockResolvedValue(null),
      getItem: vi.fn().mockResolvedValue({ title: 'Work', thumbnail: 'https://host/thumb' }),
    };
    const service = new ContentAccessService({
      contentIdResolver: { resolve: () => ({ source: 'plex', localId: '7' }) },
      contentCatalog,
    });
    await expect(service.display('plex:7', 'plex', '7')).resolves.toEqual({
      kind: 'found', source: 'plex', localId: '7', thumbnailUrl: 'https://host/thumb', title: 'Work',
    });
    expect(contentCatalog.getItem).toHaveBeenCalledWith({ source: 'plex', localId: '7' }, 'plex:7');
  });

  it('preserves queue fallback order and delegates queue resolution', async () => {
    const contentCatalog = {
      getItem: vi.fn(),
      resolvePlayables: vi.fn().mockResolvedValue({ items: ['raw'], audio: { mode: 'stereo' } }),
    };
    const resolver = { resolve: vi.fn((id) => id === 'query:fhe' ? { source: 'query', localId: 'fhe' } : null) };
    const queueService = { resolveQueue: vi.fn().mockResolvedValue([{ id: 'plex:1' }]) };
    const service = new ContentAccessService({ contentIdResolver: resolver, contentCatalog, queueService });
    const result = await service.queue({ compoundId: 'fhe', parsedSource: 'fhe', localId: null, shuffle: true });
    expect(resolver.resolve.mock.calls.map(([id]) => id)).toEqual(['fhe', 'fhe', 'query:fhe']);
    expect(result).toMatchObject({ kind: 'found', source: 'query', finalId: 'query:fhe', audio: { mode: 'stereo' } });
    expect(queueService.resolveQueue).toHaveBeenCalledWith({ items: ['raw'], audio: { mode: 'stereo' } }, 'query', { shuffle: true });
  });

  describe('station sequences', () => {
    const track = (id) => ({ id, source: 'plex' });
    const ids = (items) => items.map((it) => it.id);
    const playlist = () => Object.assign(['plex:j1', 'plex:s1', 'plex:s2', 'plex:s3', 'plex:s4'].map(track), { audio: null });

    function build({ sequence = { head: 1, idents: { every: [2, 2], pool: ['plex:j2'] } }, store, catalogExtra = {} } = {}) {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const contentCatalog = {
        getItem: vi.fn(),
        resolvePlayables: vi.fn(async (resolved, id) => {
          if (id === 'plex:757556') return playlist();
          if (id in catalogExtra) return catalogExtra[id];
          return [track(id)];
        }),
      };
      const resolver = { resolve: vi.fn((id) => {
        const [source, localId] = String(id).split(':');
        return localId ? { source, localId } : null;
      }) };
      // A watch-aware shuffle stand-in: reverses, so a jingle in its input would move.
      const queueService = { resolveQueue: vi.fn(async (items) => [...items].reverse()) };
      const sequenceStore = store ?? { lookup: vi.fn(() => sequence) };
      const service = new ContentAccessService({
        contentIdResolver: resolver, contentCatalog, queueService, sequenceStore, random: () => 0, logger,
      });
      return { service, queueService, logger, sequenceStore };
    }

    const run = (service) => service.queue({ compoundId: 'plex:757556', parsedSource: 'plex', localId: '757556', shuffle: true });

    it('pins the jingle, orders only the songs, and interleaves station IDs', async () => {
      const { service, queueService, logger } = build();
      const result = await run(service);
      const [restArg, source, opts] = queueService.resolveQueue.mock.calls[0];
      expect(ids(restArg)).toEqual(['plex:s1', 'plex:s2', 'plex:s3', 'plex:s4']);
      expect(source).toBe('plex');
      expect(opts).toEqual({ shuffle: true });
      expect(ids(result.items)).toEqual(['plex:j1', 'plex:s4', 'plex:s3', 'plex:j2', 'plex:s2', 'plex:s1']);
      expect(logger.info).toHaveBeenCalledWith('station.sequence.applied', {
        containerId: 'plex:757556', path: 'queue', shuffle: true, head: 1, songs: 4, idents: 1,
      });
    });

    it('drops an unresolvable station ID with a warn and still plays', async () => {
      const { service, logger } = build({
        sequence: { head: 1, idents: { every: [2, 2], pool: ['plex:gone'] } },
        catalogExtra: { 'plex:gone': [] },
      });
      const result = await run(service);
      expect(ids(result.items)).toEqual(['plex:j1', 'plex:s4', 'plex:s3', 'plex:s2', 'plex:s1']);
      expect(logger.warn).toHaveBeenCalledWith('station.ident.unresolved', { containerId: 'plex:757556', id: 'plex:gone' });
    });

    it('falls back to the plain queue when the store throws', async () => {
      const { service, queueService } = build({ store: { lookup: () => { throw new Error('boom'); } } });
      const result = await run(service);
      expect(ids(queueService.resolveQueue.mock.calls[0][0])).toHaveLength(5);
      expect(ids(result.items)[4]).toBe('plex:j1');
    });

    it('falls back to the plain queue when sequencing fails midway', async () => {
      const { service, logger } = build();
      service.queueService.resolveQueue
        .mockRejectedValueOnce(new Error('memory down'))
        .mockImplementationOnce(async (items) => items);
      const result = await run(service);
      expect(ids(result.items)).toEqual(['plex:j1', 'plex:s1', 'plex:s2', 'plex:s3', 'plex:s4']);
      expect(logger.warn).toHaveBeenCalledWith('station.sequence.failed', { containerId: 'plex:757556', error: 'memory down' });
    });

    it('leaves a container with no sequence exactly as before', async () => {
      const { service, queueService } = build({ sequence: null });
      const result = await run(service);
      expect(queueService.resolveQueue.mock.calls[0][0]).toHaveLength(5);
      expect(ids(result.items)[0]).toBe('plex:s4');
    });
  });
});
