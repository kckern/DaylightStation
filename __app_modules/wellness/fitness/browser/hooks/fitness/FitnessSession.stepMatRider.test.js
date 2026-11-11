import { describe, expect, it } from 'vitest';
import { FitnessSession } from "./FitnessSession.js";

/**
 * A step mat cannot sense who is on it. It has a rider (a face on its card,
 * per-person step credit) only when someone explicitly picks one on the card's
 * picker in THIS session. Bikes keep their config `rider:` default.
 */
const MAT = { id: 'step_mat', name: 'Step Mat', type: 'pressure_mat', pressure_mat: 'mat-1', rider: 'alex' };
const BIKE = { id: 'tricycle', name: 'Tricycle', type: 'bike', rider: 'rider_c' };
const step = (session, steps, timestamp) => session.ingestPressureMat(
  { id: 'mat-1', type: 'presence', event: 'pressed', steps, stomps: 0 }, { timestamp });

describe('step-mat rider is an explicit in-session pick only', () => {
  it('ignores a config rider default on a mat but keeps it on a bike', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([MAT, BIKE]);
    session.sessionId = 'fs_20261111100000';
    expect(session.getEquipmentRider('step_mat')).toBeNull();
    expect(session.getEquipmentRider('tricycle')).toBe('rider_c');
    step(session, 5, 1000);
    expect(session.getPressureMatTracker('step_mat').snapshot(1000).users).toEqual({});
    session.destroy();
  });

  it('ignores a rider_select broadcast aimed at a mat', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([MAT]);
    session.sessionId = 'fs_20261111100000';
    session._deviceRouter.route?.({ topic: 'rider_select', equipmentId: 'step_mat', userId: 'alex' });
    session.setEquipmentRider('step_mat', 'alex'); // the router's own call
    expect(session.getEquipmentRider('step_mat')).toBeNull();
    expect(session.getEquipmentUser('step_mat')).toBeNull();
    session.destroy();
  });

  it('a card pick credits that person and shows them; unassign clears it', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([MAT]);
    session.sessionId = 'fs_20261111100000';
    session.setEquipmentUser('step_mat', 'rider_b');
    expect(session.getEquipmentUser('step_mat')).toBe('rider_b');
    step(session, 5, 1000);
    expect(session.getPressureMatTracker('step_mat').snapshot(1000).users).toEqual({ rider_b: { steps: 1, stomps: 0 } });
    session.setEquipmentUser('step_mat', null);
    expect(session.getEquipmentUser('step_mat')).toBeNull();
    session.destroy();
  });

  it('a pick ends with the session; the next session starts with no rider', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([MAT, BIKE]);
    session.sessionId = 'fs_20261111100000';
    session.setEquipmentUser('step_mat', 'rider_b');
    session.reset();
    session.sessionId = 'fs_20261111120000';
    expect(session.getEquipmentUser('step_mat')).toBeNull();
    expect(session.getEquipmentRider('tricycle')).toBe('rider_c');
    session.destroy();
  });

  it('keeps a restored pick only when it was made in that same session', () => {
    const first = new FitnessSession();
    const now = Date.now();
    first.setEquipmentCatalog([MAT]);
    first.sessionId = 'fs_20261111100000';
    first.startTime = now - 5000;
    first.setEquipmentUser('step_mat', 'rider_b');
    step(first, 5, now);
    const saved = JSON.parse(JSON.stringify(first.summary));

    const resumed = new FitnessSession();
    resumed.setEquipmentCatalog([MAT]);
    resumed._hydrateFromSession(saved);
    expect(resumed.getEquipmentUser('step_mat')).toBe('rider_b');

    // A record whose assignee was never picked in that session (config default,
    // legacy record) restores totals but no rider.
    const legacy = JSON.parse(JSON.stringify(saved));
    legacy.metadata.pressure_mats.mats.forEach((mat) => { delete mat.riderPickedInSession; });
    const fromLegacy = new FitnessSession();
    fromLegacy.setEquipmentCatalog([MAT]);
    fromLegacy._hydrateFromSession(legacy);
    expect(fromLegacy.getEquipmentUser('step_mat')).toBeNull();
    expect(fromLegacy.getPressureMatSnapshots(now).step_mat.sessionSteps).toBe(1);

    // A pick carried from a different session id does not apply.
    const foreign = JSON.parse(JSON.stringify(saved));
    foreign.metadata.pressure_mats.mats.forEach((mat) => { mat.riderPickedInSession = 'fs_20260101000000'; });
    const fromForeign = new FitnessSession();
    fromForeign.setEquipmentCatalog([MAT]);
    fromForeign._hydrateFromSession(foreign);
    expect(fromForeign.getEquipmentUser('step_mat')).toBeNull();
    [first, resumed, fromLegacy, fromForeign].forEach((s) => s.destroy());
  });

  it('governance sees no mat rider without a pick', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([MAT, BIKE]);
    session.sessionId = 'fs_20261111100000';
    expect(session._equipmentRiderMap()).toEqual({ tricycle: 'rider_c' });
    session.setEquipmentUser('step_mat', 'rider_b');
    expect(session._equipmentRiderMap()).toEqual({ tricycle: 'rider_c', step_mat: 'rider_b' });
    session.destroy();
  });
});
