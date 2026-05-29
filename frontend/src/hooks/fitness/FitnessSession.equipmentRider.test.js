import { describe, it, expect } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

describe('FitnessSession — equipmentRider', () => {
  it('starts with no rider claimed (null)', () => {
    const session = new FitnessSession();
    expect(session.getEquipmentRider('niceday')).toBeNull();
  });

  it('records a claim and reads it back', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'user_2');
    expect(session.getEquipmentRider('niceday')).toBe('user_2');
  });

  it('reassigns the claim to the last user set', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'user_2');
    session.setEquipmentRider('niceday', 'user_3');
    expect(session.getEquipmentRider('niceday')).toBe('user_3');
  });

  it('updates the claim when a rider_select event is routed', () => {
    const session = new FitnessSession();
    session.ingestData({ topic: 'rider_select', equipmentId: 'niceday', userId: 'kckern', action: '3_single' });
    expect(session.getEquipmentRider('niceday')).toBe('kckern');
  });
});
