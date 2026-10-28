import { describe, it, expect, vi } from 'vitest';
import { homeDashboardEntitiesHandler, presentHomeEntity } from './entities.mjs';

const entity = {
  id: 'light.kitchen', domain: 'light', name: 'Kitchen', state: 'on', stateClass: 'on', type: 'light',
  room: { id: 'kitchen', name: 'Kitchen', source: 'provider' }, unit: null, deviceClass: null,
  lastChanged: 't1', controllable: true, detail: { brightnessPct: 78 },
};

describe('homeDashboardEntitiesHandler', () => {
  it('presents every entity field the dashboard reads', () => {
    expect(presentHomeEntity(entity)).toEqual(entity);
    expect(presentHomeEntity({ ...entity, room: null }).room).toBeNull();
  });

  it('serves the use case result uncached', async () => {
    const operation = { execute: vi.fn().mockResolvedValue({ entities: [entity], rooms: [{ id: 'kitchen', name: 'Kitchen' }], types: [], stateClasses: [], haUrl: null }) };
    const res = { set: vi.fn(), json: vi.fn() };
    await homeDashboardEntitiesHandler({ operation })({}, res);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json.mock.calls[0][0]).toEqual({ entities: [entity], rooms: [{ id: 'kitchen', name: 'Kitchen' }], types: [], stateClasses: [], haUrl: null });
  });

  it('requires its use case', () => {
    expect(() => homeDashboardEntitiesHandler({})).toThrow(/operation required/);
  });
});
