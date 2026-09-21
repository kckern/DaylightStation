import { describe, expect, it } from 'vitest';
import { AUTOPLAY_ACTIONS, autoplayToAction, parseAutoplayParams } from './parseAutoplayParams.js';

describe('parseAutoplayParams queue operation routing', () => {
  it('routes cold URL queue+op=add through media:queue-op with its dispatch correlator', () => {
    const parsed = parseAutoplayParams(
      '?queue=plex%3A123&op=add&dispatchId=dispatch-cold-1&shader=dark',
      AUTOPLAY_ACTIONS,
    );

    expect(autoplayToAction(parsed)).toEqual({
      event: 'media:queue-op',
      payload: {
        op: 'add', contentId: 'plex:123', commandId: 'dispatch-cold-1', shader: 'dark',
      },
    });
  });

  it('routes correlated cold URL Play through the acknowledged play-now owner path', () => {
    const parsed = parseAutoplayParams(
      '?play=plex%3A456&dispatchId=dispatch-cold-play',
      AUTOPLAY_ACTIONS,
    );

    expect(autoplayToAction(parsed)).toEqual({
      event: 'media:queue-op',
      payload: { op: 'play-now', contentId: 'plex:456', commandId: 'dispatch-cold-play' },
    });
  });
});
