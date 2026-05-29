import { describe, it, expect } from 'vitest';
import { buildRiderToast } from './buildRiderToast.js';

const resolvers = {
  resolveUserName: (uid) => ({ felix: 'Felix' }[uid] || uid),
  resolveEquipmentName: (eid) => ({ niceday: 'NiceDay' }[eid] || eid),
};

describe('buildRiderToast', () => {
  it('builds an avatar/title/subtitle payload from a rider_select event', () => {
    const toast = buildRiderToast({ userId: 'felix', equipmentId: 'niceday' }, resolvers);
    expect(toast).toEqual({
      avatarUrl: '/api/v1/static/img/users/felix',
      title: 'Felix',
      subtitle: 'is riding the NiceDay',
      variant: 'success',
    });
  });

  it('falls back to raw ids when resolvers do not recognize them', () => {
    const toast = buildRiderToast({ userId: 'guest1', equipmentId: 'mystery' }, resolvers);
    expect(toast.title).toBe('guest1');
    expect(toast.subtitle).toBe('is riding the mystery');
    expect(toast.avatarUrl).toBe('/api/v1/static/img/users/guest1');
  });
});
