import { describe, it, expect } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

describe('FitnessSession — equipmentRider', () => {
  it('starts with no rider claimed (null)', () => {
    const session = new FitnessSession();
    expect(session.getEquipmentRider('niceday')).toBeNull();
  });

  it('records a claim and reads it back', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'felix');
    expect(session.getEquipmentRider('niceday')).toBe('felix');
  });

  it('reassigns the claim to the last user set', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'felix');
    session.setEquipmentRider('niceday', 'milo');
    expect(session.getEquipmentRider('niceday')).toBe('milo');
  });

  it('unclaims the bike when set with a falsy userId', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'felix');
    session.setEquipmentRider('niceday', null);
    expect(session.getEquipmentRider('niceday')).toBeNull();
    // must not have stored the string "null"
    session.setEquipmentRider('niceday', '');
    expect(session.getEquipmentRider('niceday')).toBeNull();
  });

  it('updates the claim when a rider_select event is routed', () => {
    const session = new FitnessSession();
    session.ingestData({ topic: 'rider_select', equipmentId: 'niceday', userId: 'kckern', action: '3_single' });
    expect(session.getEquipmentRider('niceday')).toBe('kckern');
  });
});
