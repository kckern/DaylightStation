import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));

import useInvadersBoost, { selectPartner } from './useInvadersBoost.js';

const equipment = [{ id: 'bike_a', cadence: 7 }, { id: 'bike_b', cadence: 9 }];
const session = (riders, cadence) => ({ getEquipmentRider: (id) => riders[id] || null, getEquipmentCadence: (id) => cadence[id] || { connected: false, rpm: 0 } });

describe('partner boost input', () => {
  it('picks a connected bike rider who is not the shooter', () => {
    const s = session({ bike_a: 'shooter', bike_b: 'partner' }, { bike_a: { connected: true, rpm: 70 }, bike_b: { connected: true, rpm: 82 } });
    expect(selectPartner(equipment, s, 'shooter')).toMatchObject({ riderId: 'partner', equipmentId: 'bike_b' });
  });
  it('has no partner without a ridden, connected bike', () => {
    expect(selectPartner(equipment, session({}, {}), 'shooter')).toBeNull();
    expect(selectPartner(equipment, session({ bike_a: 'partner' }, { bike_a: { connected: true, rpm: 60, transportStalled: true } }), 'shooter')).toBeNull();
  });
  it('reads live cadence each time it is asked, and null when there is no partner', () => {
    const cadence = { bike_a: { connected: true, rpm: 60 } };
    const s = session({ bike_a: 'partner' }, cadence);
    const { result } = renderHook(() => useInvadersBoost({ equipment, session: s, shooterId: 'shooter' }));
    expect(result.current.partner).toMatchObject({ riderId: 'partner' });
    expect(result.current.readRpm()).toBe(60);
    cadence.bike_a = { connected: true, rpm: 95 };
    expect(result.current.readRpm()).toBe(95);
    cadence.bike_a = { connected: false, rpm: 0 };
    expect(result.current.readRpm()).toBeNull();
    cadence.bike_a = { connected: true, rpm: 70, transportStalled: true };
    expect(result.current.readRpm()).toBeNull();
  });
  it('finds a partner who starts pedalling after the game has rendered', () => {
    const riders = {}; const cadence = {};
    const { result } = renderHook(() => useInvadersBoost({ equipment, session: session(riders, cadence), shooterId: 'shooter' }));
    expect(result.current.partner).toBeNull();
    expect(result.current.readRpm()).toBeNull();
    riders.bike_b = 'partner';
    cadence.bike_b = { connected: true, rpm: 77 };
    expect(result.current.readRpm()).toBe(77);
    expect(result.current.readPartner()).toMatchObject({ riderId: 'partner', equipmentId: 'bike_b' });
    expect(mockLog.info).toHaveBeenCalledWith('skyline_invaders.boost.partner', expect.objectContaining({ riderId: 'partner', equipmentId: 'bike_b' }));
  });
  it('keeps the same partner through a dropout, and when another bike joins', () => {
    const riders = { bike_b: 'partner' };
    const cadence = { bike_b: { connected: true, rpm: 80 } };
    const { result, rerender } = renderHook(() => useInvadersBoost({ equipment, session: session(riders, cadence), shooterId: 'shooter' }));
    expect(result.current.readRpm()).toBe(80);
    cadence.bike_b = { connected: false, rpm: 0 };
    riders.bike_a = 'other';
    cadence.bike_a = { connected: true, rpm: 50 };
    rerender();
    expect(result.current.readRpm()).toBeNull();            // the partner's own bike, not the newcomer's
    cadence.bike_b = { connected: true, rpm: 88 };
    expect(result.current.readRpm()).toBe(88);
    expect(result.current.readPartner()).toMatchObject({ riderId: 'partner' });
  });
  it('never takes the shooter as the partner when the shooter changes', () => {
    const riders = { bike_a: 'kid' };
    const cadence = { bike_a: { connected: true, rpm: 80 } };
    const { result, rerender } = renderHook(({ shooterId }) => useInvadersBoost({ equipment, session: session(riders, cadence), shooterId }), { initialProps: { shooterId: 'shooter' } });
    expect(result.current.readRpm()).toBe(80);
    rerender({ shooterId: 'kid' });
    expect(result.current.partner).toBeNull();
    expect(result.current.readRpm()).toBeNull();
  });
});
