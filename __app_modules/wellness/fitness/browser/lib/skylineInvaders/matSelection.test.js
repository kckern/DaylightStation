import { describe, expect, it } from 'vitest';
import { listInvadersMats, selectInvadersMat } from './matSelection.js';

const equipment = [
  { id: 'bike', cadence: 7 },
  { id: 'step-mat', type: 'pressure_mat', pressure_mat: 'mat-a1' },
  { id: 'mat-two', sensor: { type: 'pressure_mat', pressure_mat: 'mat-b2' } },
  { id: 'broken-mat', type: 'pressure_mat' },
];
const session = { getEquipmentRider: (id) => (id === 'mat-two' ? 'kid' : null) };

describe('mat selection', () => {
  it('lists configured mats with both ids and the in-session rider', () => {
    expect(listInvadersMats(equipment, session)).toEqual([
      { equipmentId: 'step-mat', matId: 'mat-a1', riderId: null },
      { equipmentId: 'mat-two', matId: 'mat-b2', riderId: 'kid' },
    ]);
  });
  it('reads the other spellings of a mat entry, and ids as strings', () => {
    expect(listInvadersMats([{ id: 3, type: 'step_mat', pressureMat: 7 }], null)).toEqual([
      { equipmentId: '3', matId: '7', riderId: null },
    ]);
    expect(listInvadersMats(null, session)).toEqual([]);
  });
  it('prefers the asked-for mat, then one with a rider, then the first', () => {
    expect(selectInvadersMat(equipment, session, 'step-mat').equipmentId).toBe('step-mat');
    expect(selectInvadersMat(equipment, session).equipmentId).toBe('mat-two');
    expect(selectInvadersMat(equipment, { getEquipmentRider: () => null }).equipmentId).toBe('step-mat');
    expect(selectInvadersMat([], session)).toBeNull();
  });
});
