import { describe, it, expect, vi, beforeEach } from 'vitest';
const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
import { useCompositionsApi } from './useCompositionsApi.js';

beforeEach(() => api.mockReset());

describe('useCompositionsApi', () => {
  it('lists via GET', async () => {
    api.mockResolvedValue({ compositions: [{ id: 'a' }] });
    const c = useCompositionsApi('kc');
    expect(await c.list()).toEqual([{ id: 'a' }]);
    expect(api).toHaveBeenCalledWith('/api/v1/piano/users/kc/compositions');
  });
  it('saves via PUT with body', async () => {
    api.mockResolvedValue({ ok: true, revision: 2 });
    const c = useCompositionsApi('kc');
    await c.save('x', { musicxml: '<x/>', meta: {}, revision: 1 });
    expect(api).toHaveBeenCalledWith('/api/v1/piano/users/kc/compositions/x', { musicxml: '<x/>', meta: {}, revision: 1 }, 'PUT');
  });
});
