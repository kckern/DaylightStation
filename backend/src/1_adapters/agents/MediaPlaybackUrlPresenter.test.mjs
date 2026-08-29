import { describe, expect, it } from 'vitest';
import { streamRef } from '#apps/common/resources/publicResourceRefs.mjs';
import { MediaPlaybackUrlPresenter } from './MediaPlaybackUrlPresenter.mjs';

describe('MediaPlaybackUrlPresenter', () => {
  const presenter = new MediaPlaybackUrlPresenter({ baseUrl: 'http://daylight.local/' });

  it('preserves supplied absolute and relative media URLs', () => {
    expect(presenter.present({ playable: { mediaUrl: 'https://media.local/file.mp3' }, stream: streamRef('plex', '1') }))
      .toBe('https://media.local/file.mp3');
    expect(presenter.present({ playable: { mediaUrl: '/custom/file.mp3' }, stream: streamRef('plex', '1') }))
      .toBe('http://daylight.local/custom/file.mp3');
  });

  it('projects the unchanged fallback stream URL', () => {
    expect(presenter.present({ playable: {}, stream: streamRef('plex', '11') }))
      .toBe('http://daylight.local/api/v1/stream/plex/11');
  });
});
