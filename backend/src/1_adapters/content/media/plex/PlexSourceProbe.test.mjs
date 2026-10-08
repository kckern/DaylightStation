import { describe, it, expect, vi } from 'vitest';
import { PlexSourceProbe } from './PlexSourceProbe.mjs';

// checkFiles=1 is Plex STATTING the file. On 2026-09-29 Plex could stat a Bluey
// episode (accessible: true) while every direct play of its part answered 404 —
// the stall ladder then skipped the episode at 90%. The probe must also ask for
// the part itself before it calls the file readable.
function clientWith({ parts, partStatus }) {
  return {
    request: vi.fn(async () => ({
      MediaContainer: { Metadata: [{ title: 'Ticklecrabs', grandparentTitle: 'Bluey (2018)', Media: [{ Part: parts }] }] },
    })),
    partStatus: partStatus ? vi.fn(partStatus) : undefined,
  };
}

const accessiblePart = { key: '/library/parts/494586/1599193403/file.mp4', file: '/data/x.mp4', exists: true, accessible: true };

describe('PlexSourceProbe', () => {
  it('calls a statted-accessible part unreadable when Plex refuses to serve it (404)', async () => {
    const client = clientWith({ parts: [accessiblePart], partStatus: async () => 404 });
    const result = await new PlexSourceProbe({ client }).probe('59546');
    expect(client.partStatus).toHaveBeenCalledWith('/library/parts/494586/1599193403/file.mp4');
    expect(result).toMatchObject({ state: 'unreadable', reason: 'part-refused', partStatus: 404, path: '/data/x.mp4' });
  });

  it('treats a 403 on the part as refused too', async () => {
    const client = clientWith({ parts: [accessiblePart], partStatus: async () => 403 });
    expect((await new PlexSourceProbe({ client }).probe('59546')).state).toBe('unreadable');
  });

  it('stays readable when the part answers 206 or 200', async () => {
    for (const status of [206, 200]) {
      const client = clientWith({ parts: [accessiblePart], partStatus: async () => status });
      expect((await new PlexSourceProbe({ client }).probe('59546')).state).toBe('readable');
    }
  });

  it('keeps the checkFiles answer when the part request itself fails (never escalates on its own error)', async () => {
    const client = clientWith({ parts: [accessiblePart], partStatus: async () => { throw new Error('timeout'); } });
    expect((await new PlexSourceProbe({ client }).probe('59546')).state).toBe('readable');
  });

  it('does not probe the part when checkFiles already says unreadable or missing', async () => {
    for (const part of [{ ...accessiblePart, accessible: false }, { ...accessiblePart, exists: false }]) {
      const client = clientWith({ parts: [part], partStatus: async () => 206 });
      await new PlexSourceProbe({ client }).probe('59546');
      expect(client.partStatus).not.toHaveBeenCalled();
    }
  });

  it('works with a client that cannot probe parts (unchanged behaviour)', async () => {
    const client = clientWith({ parts: [accessiblePart] });
    expect((await new PlexSourceProbe({ client }).probe('59546')).state).toBe('readable');
  });
  it('says not-a-leaf for a container (show/season) instead of a silent unknown', async () => {
    for (const type of ['show', 'season', 'artist', 'album', 'collection', 'playlist']) {
      const client = {
        request: vi.fn(async () => ({ MediaContainer: { Metadata: [{ type, title: 'Bluey', ratingKey: '59493' }] } })),
        partStatus: vi.fn(),
      };
      const result = await new PlexSourceProbe({ client }).probe('59493');
      expect(result).toMatchObject({ state: 'unknown', reason: 'not-a-leaf', itemType: type });
      expect(client.partStatus).not.toHaveBeenCalled();
    }
  });

  it('an item Plex has no metadata for says no-metadata (deleted), distinct from an outage', async () => {
    const client = { request: vi.fn(async () => ({ MediaContainer: { Metadata: [] } })) };
    expect(await new PlexSourceProbe({ client }).probe('1')).toMatchObject({ state: 'unknown', reason: 'no-metadata' });
  });

  it('an item with no Media at all is also not-a-leaf', async () => {
    const client = { request: vi.fn(async () => ({ MediaContainer: { Metadata: [{ type: 'episode', title: 'x' }] } })) };
    expect((await new PlexSourceProbe({ client }).probe('1')).reason).toBe('not-a-leaf');
  });
});
