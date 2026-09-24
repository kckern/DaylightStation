import { describe, it, expect } from 'vitest';
import { SessionEntity, SessionEntityRegistry } from './SessionEntity.js';

describe('SessionEntity as a stint record', () => {
  it('carries startTick and an empty relabel history', () => {
    const e = new SessionEntity({ profileId: 'kid-a', name: 'Kid A', deviceId: 'D2', startTime: 1000, startTick: 139 });
    expect(e.startTick).toBe(139);
    expect(e.relabeledFrom).toEqual([]);
    expect(e.summary).not.toHaveProperty('rings');
  });

  it('relabel keeps the stint open and records prior occupants in order', () => {
    const reg = new SessionEntityRegistry();
    const e = reg.create({ profileId: 'kid-a', name: 'Kid A', deviceId: 'D2', startTime: 1000, startTick: 139 });
    reg.relabel(e.entityId, { profileId: 'kid-b', name: 'Kid B' });
    reg.relabel(e.entityId, { profileId: 'kid-a', name: 'Kid A' });
    expect(e.status).toBe('active');
    expect(e.profileId).toBe('kid-a');
    expect(e.relabeledFrom).toEqual(['kid-a', 'kid-b']);
    expect(reg.getByDevice('D2')).toBe(e);
  });

  it('end records the reason', () => {
    const e = new SessionEntity({ profileId: 'kid-a', deviceId: 'D2', startTime: 1000, startTick: 0 });
    e.end({ status: 'superseded', timestamp: 2000, reason: 'handover' });
    expect(e.summary).toMatchObject({ status: 'superseded', endTime: 2000, endReason: 'handover' });
  });

  it('round-trips through JSON', () => {
    const e = new SessionEntity({ profileId: 'kid-a', deviceId: 'D2', startTime: 1000, startTick: 5 });
    e.relabel({ profileId: 'kid-b', name: 'Kid B' });
    const back = SessionEntity.fromJSON(JSON.parse(JSON.stringify(e.toJSON())));
    expect(back.startTick).toBe(5);
    expect(back.relabeledFrom).toEqual(['kid-a']);
  });
});
