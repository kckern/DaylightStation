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

  it('unclaims the bike when set with a falsy userId', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'user_2');
    session.setEquipmentRider('niceday', null);
    expect(session.getEquipmentRider('niceday')).toBeNull();
    // must not have stored the string "null"
    session.setEquipmentRider('niceday', '');
    expect(session.getEquipmentRider('niceday')).toBeNull();
  });

  it('moves a rider off any other equipment (a user can only be on one bike)', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'user_2');
    session.setEquipmentRider('cycle_ace', 'user_2'); // same user → moves
    expect(session.getEquipmentRider('niceday')).toBeNull();
    expect(session.getEquipmentRider('cycle_ace')).toBe('user_2');
  });

  it('does not disturb other riders when moving a user', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'user_2');
    session.setEquipmentRider('cycle_ace', 'user_3');
    session.setEquipmentRider('tricycle', 'user_2'); // user_2 moves off niceday only
    expect(session.getEquipmentRider('niceday')).toBeNull();
    expect(session.getEquipmentRider('cycle_ace')).toBe('user_3');
    expect(session.getEquipmentRider('tricycle')).toBe('user_2');
  });

  it('updates the claim when a rider_select event is routed', () => {
    const session = new FitnessSession();
    session.ingestData({ topic: 'rider_select', equipmentId: 'niceday', userId: 'user_1', action: '3_single' });
    expect(session.getEquipmentRider('niceday')).toBe('user_1');
  });
});

/**
 * A standing rider declared in config.
 *
 * The case it exists for: equipment with exactly one real rider and no physical
 * selector wired to it. Before this, such equipment was permanently unclaimed,
 * and a `cadence_floor` stands down as `unclaimed` before it looks at cadence at
 * all — so a gate could watch a bike being ridden for half an hour and never
 * once apply.
 */
describe('FitnessSession — riders declared in config', () => {
  const catalog = [
    { id: 'tricycle', rider: 'rider_a' },
    { id: 'niceday' },
    { id: 'step_mat', rider: '  rider_b  ' },
  ];

  it('claims the declared rider when the catalog is applied', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog(catalog);
    expect(session.getEquipmentRider('tricycle')).toBe('rider_a');
  });

  it('trims the declared rider rather than storing the padding', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog(catalog);
    expect(session.getEquipmentRider('step_mat')).toBe('rider_b');
  });

  it('leaves equipment without a declared rider unclaimed', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog(catalog);
    expect(session.getEquipmentRider('niceday')).toBeNull();
  });

  it('is a DEFAULT, not a lock — a live claim still wins', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog(catalog);
    session.setEquipmentRider('tricycle', 'rider_c');
    expect(session.getEquipmentRider('tricycle')).toBe('rider_c');
  });

  it('does not drag a moved rider back when config is re-applied mid-session', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog(catalog);
    session.setEquipmentRider('tricycle', 'rider_c');
    // A config refresh is not a new workout; re-seeding here would yank the
    // rider off the machine they just moved to.
    session.setEquipmentCatalog(catalog);
    expect(session.getEquipmentRider('tricycle')).toBe('rider_c');
  });

  it('re-seeds after the equipment is explicitly unclaimed', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog(catalog);
    session.setEquipmentRider('tricycle', null);
    expect(session.getEquipmentRider('tricycle')).toBeNull();
    session.setEquipmentCatalog(catalog);
    expect(session.getEquipmentRider('tricycle')).toBe('rider_a');
  });
});
