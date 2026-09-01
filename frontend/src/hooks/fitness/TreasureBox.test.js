import { describe, expect, it, vi } from 'vitest';
import { FitnessTreasureBox } from './TreasureBox.js';

describe('FitnessTreasureBox ring award callback', () => {
  it('publishes a canonical completed award after totals have been updated', () => {
    const box = new FitnessTreasureBox({ startTime: Date.now(), timebase: {} });
    box.perUser.set('user_4', { profileId: 'user_4', totalRings: 100 });
    box.totalRings = 300;
    const onAward = vi.fn();
    box.setRingAwardCallback(onAward);

    box._awardRings('user_4', { id: 'hot', name: 'Hot', rings: 5, color: 'orange' });

    expect(onAward).toHaveBeenCalledOnce();
    expect(onAward).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_4', zone: 'hot', color: 'orange', rings: 5,
      userTotal: 105, totalRings: 305,
    }));
  });
});
