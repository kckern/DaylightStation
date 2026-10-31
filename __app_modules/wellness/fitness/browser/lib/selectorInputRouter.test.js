import { describe, it, expect, vi } from 'vitest';
import { createSelectorInputRouter } from './selectorInputRouter.js';
import { dispatchRiderSelection } from './riderSelection.js';

const input = { selectorId: 'pad', equipmentId: 'bike', userId: 'other-child', action: '2_single' };
describe('scoped selector routing', () => {
  it('captures before assignment and leaves another bike on the default path', () => {
    const router = createSelectorInputRouter(), onInput = vi.fn(() => true);
    const release = router.capture({ selectorId: 'pad', equipmentId: 'bike', onInput });
    const ingest = vi.fn(), emit = vi.fn(), toast = vi.fn();
    dispatchRiderSelection(input, { route: router.route, ingest, emit, toast });
    expect(onInput).toHaveBeenCalledExactlyOnceWith(input);
    expect(ingest).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
    const other = { ...input, selectorId: 'other', equipmentId: 'bike2' };
    dispatchRiderSelection(other, { route: router.route, ingest, emit, toast });
    expect(ingest).toHaveBeenCalledExactlyOnceWith(other);
    release(); release();
    expect(router.route(input)).toBe(false);
  });
  it('claims the first input exactly once and rejects conflicting captures', () => {
    const router = createSelectorInputRouter(), handled = vi.fn(() => true);
    const stop = router.onUnclaimed(data => { router.capture({ ...data, onInput: handled }); return true; });
    expect(router.route(input)).toBe(true); expect(handled).not.toHaveBeenCalled();
    expect(router.route(input)).toBe(true); expect(handled).toHaveBeenCalledOnce();
    expect(() => router.capture({ ...input, onInput: handled })).toThrow(/captured/i);
    stop(); router.clear(); expect(router.route(input)).toBe(false);
  });
  it('never assigns an unmapped gesture outside a capture', () => {
    const ingest = vi.fn(), emit = vi.fn(), toast = vi.fn();
    dispatchRiderSelection({ ...input, userId: undefined, action: '4_long' }, { ingest, emit, toast });
    expect(ingest).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
  });
});
