import { describe, it, expect } from 'vitest';
import { buildRiderToast } from "./buildRiderToast.js";

const resolvers = {
  resolveUserName: (uid) => ({ user_2: 'User_2' }[uid] || uid),
  resolveEquipmentName: (eid) => ({ bike_a: 'Bike A' }[eid] || eid),
};

describe('buildRiderToast', () => {
  it('builds an avatar/title/subtitle payload from a rider_select event', () => {
    const toast = buildRiderToast({ userId: 'user_2', equipmentId: 'bike_a' }, resolvers);
    expect(toast).toEqual({
      avatarUrl: '/api/v1/static/img/users/user_2',
      title: 'User_2',
      subtitle: 'is riding the Bike A',
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
