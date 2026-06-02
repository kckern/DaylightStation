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

  it('moves a rider off any other equipment (a user can only be on one bike)', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'felix');
    session.setEquipmentRider('cycle_ace', 'felix'); // same user → moves
    expect(session.getEquipmentRider('niceday')).toBeNull();
    expect(session.getEquipmentRider('cycle_ace')).toBe('felix');
  });

  it('does not disturb other riders when moving a user', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'felix');
    session.setEquipmentRider('cycle_ace', 'milo');
    session.setEquipmentRider('tricycle', 'felix'); // felix moves off niceday only
    expect(session.getEquipmentRider('niceday')).toBeNull();
    expect(session.getEquipmentRider('cycle_ace')).toBe('milo');
    expect(session.getEquipmentRider('tricycle')).toBe('felix');
  });

  it('updates the claim when a rider_select event is routed', () => {
    const session = new FitnessSession();
    session.ingestData({ topic: 'rider_select', equipmentId: 'niceday', userId: 'kckern', action: '3_single' });
    expect(session.getEquipmentRider('niceday')).toBe('kckern');
  });
});
