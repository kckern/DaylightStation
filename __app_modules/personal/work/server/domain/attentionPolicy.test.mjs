import { it, expect } from 'vitest';
import { attentionEligibility, mergeAttentionHistory } from './attentionPolicy.mjs';
const now = Date.parse('2026-11-17T16:00:00Z');
const policy = {
  maxProactiveUnitsPerDay: 2,
  maxHousekeepingPer7Days: 1,
  itemCooldownDays: 30
};
const delivery = {
  id: 'one',
  day: '2026-11-17',
  channel: 'morning',
  questionUnits: 2,
  status: 'delivered',
  deliveredAt: now - 1000,
  expiresAt: now + 1000
};
it('counts acknowledged and pending capacity separately and coalesces cross-owner receipts', () => {
  const rows = mergeAttentionHistory([{
    ...delivery,
    id: 'reservation'
  }], {
    deliveries: [{
      ...delivery,
      id: 'kb',
      reservationId: 'reservation'
    }],
    reservations: []
  });
  expect(rows).toHaveLength(1);
  expect(attentionEligibility({
    records: rows,
    policy,
    day: '2026-11-17',
    asOf: now,
    channel: 'housekeeping',
    questionUnits: 1
  })).toMatchObject({
    allowed: false,
    reason: 'daily_budget',
    exposedUnits: 2
  });
  expect(attentionEligibility({
    records: [{
      ...delivery,
      status: 'quarantined',
      deliveredAt: null
    }],
    policy,
    day: '2026-11-17',
    asOf: now,
    channel: 'review',
    questionUnits: 1
  })).toMatchObject({
    allowed: false,
    exposedUnits: 0
  });
});
it('uses acknowledged history for rolling housekeeping/item cooldown, not generation', () => {
  const input = {
    policy,
    day: '2026-11-17',
    asOf: now,
    channel: 'housekeeping',
    flowType: 'housekeeping',
    refKey: 'item',
    questionUnits: 1
  };
  const old = {
    ...delivery,
    channel: 'housekeeping',
    questionUnits: 1,
    day: '2026-11-16',
    refKey: 'item',
    deliveredAt: now - 86400000
  };
  expect(attentionEligibility({
    ...input,
    records: [old]
  }).reason).toBe('weekly_housekeeping');
  expect(attentionEligibility({
    ...input,
    records: [{
      ...old,
      deliveredAt: now - 8 * 86400000
    }]
  }).reason).toBe('item_cooldown');
  expect(attentionEligibility({
    ...input,
    records: [{
      ...old,
      status: 'cancelled',
      deliveredAt: null
    }]
  }).allowed).toBe(true);
  expect(attentionEligibility({
    ...input,
    records: [delivery],
    channel: 'direct_request'
  }).allowed).toBe(true);
});
