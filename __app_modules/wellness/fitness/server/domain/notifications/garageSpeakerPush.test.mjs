import { describe, it, expect } from 'vitest';
import { composeGarageSpeakerGaveUpPush } from './garageSpeakerPush.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const clean = (push) => {
  expect(findPushTextDefects(push.title)).toEqual([]);
  expect(findPushTextDefects(push.message)).toEqual([]);
};

describe('composeGarageSpeakerGaveUpPush', () => {
  it('says the cycles did not bring it back', () => {
    const push = composeGarageSpeakerGaveUpPush({ reason: 'no_power_after_cycle', cycle: 2, durationS: 150 });
    expect(push.title).toBe('🔇 Garage speaker out');
    expect(push.message).toContain('did not come back after 2 power cycles');
    expect(push.data).toMatchObject({ tag: 'garage-speaker-recovery', channel: 'Household alerts', importance: 'high' });
    clean(push);
  });

  it('says the hourly cap stopped it', () => {
    const push = composeGarageSpeakerGaveUpPush({ reason: 'cap_reached', cyclesLastHour: 2, durationS: 30 });
    expect(push.message).toContain('already power-cycled 2 times this hour');
    clean(push);
  });

  it('reads cleanly with no numbers at all', () => {
    const push = composeGarageSpeakerGaveUpPush({ reason: 'no_power_after_cycle' });
    expect(push.message).toMatch(/^The garage speaker is silent and did not come back after a power cycle\./);
    clean(push);
    clean(composeGarageSpeakerGaveUpPush({ reason: 'cap_reached' }));
  });
});
