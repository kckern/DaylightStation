import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useQueueController } from './useQueueController.js';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({ items: [{ id: 'plex:42', contentId: 'plex:42', mediaType: 'video' }] })),
}));

describe('quality intent on expanded screen queues', () => {
  it('preserves forced conversion and disabled adaptation on the active item and snapshot', async () => {
    const { result } = renderHook(() => useQueueController({ play: {
      contentId: 'plex:42', maxResolution: '720', maxVideoBitrate: 4000, transcode: 'force', adaptive: false,
    } }));
    await waitFor(() => expect(result.current.playQueue).toHaveLength(1));
    expect(result.current.playQueue[0]).toMatchObject({ transcode: 'force', adaptive: false, maxResolution: '720', maxVideoBitrate: 4000 });
    expect(result.current.queueSnapshot.items[0]).toMatchObject({ transcode: 'force', adaptive: false });
    act(() => result.current.playNow({ contentId: 'plex:43', maxResolution: '480', adaptive: false, transcode: 'force' }));
    expect(result.current.playQueue[0]).toMatchObject({ contentId: 'plex:43', maxResolution: '480', adaptive: false, transcode: 'force' });
  });
});
