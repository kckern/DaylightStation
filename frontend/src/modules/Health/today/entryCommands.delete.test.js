import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

const { deleteEntry, deleteConfirmBody, entryChildCount, entryLabel } = await import('./entryCommands.js');

const group = (children) => ({ uuid: 'g1', kind: 'group', name: 'Asian Chicken Plate', children });

describe('delete confirmation copy', () => {
  it('names what cascades, so the sentence matches the gesture', () => {
    expect(deleteConfirmBody(group([{ uuid: 'c1' }, { uuid: 'c2' }, { uuid: 'c3' }, { uuid: 'c4' }])))
      .toContain('“Asian Chicken Plate” and its 4 items');
    expect(deleteConfirmBody(group([{ uuid: 'c1' }]))).toContain('and its 1 item?');
    expect(deleteConfirmBody({ uuid: 'r1', name: 'Hearty' })).toBe('Delete “Hearty”? You can undo this straight after.');
  });

  it('counts children only for a row something MARKED as a group', () => {
    // Deliberately NOT LogTable's has-children test. LogTable renders anything
    // with children as a group so nothing vanishes from the screen; this decides
    // what a destructive sentence claims, so it follows the stricter rule the
    // backend cascade uses. Promising to delete "its 2 items" for a row the
    // server will not cascade is the failure worth preventing.
    expect(entryChildCount({ kind: 'item', children: [{ uuid: 'c1' }, { uuid: 'c2' }] })).toBe(0);
    expect(entryChildCount(group([{ uuid: 'c1' }, { uuid: 'c2' }]))).toBe(2);
    expect(entryChildCount(group(undefined))).toBe(0);
  });

  it('falls back to a readable subject rather than an empty quote', () => {
    expect(entryLabel({ uuid: 'r1' })).toBe('this entry');
    expect(entryLabel({ uuid: 'r1', item: 'Eggs' })).toBe('Eggs');
  });
});

describe('deleteEntry', () => {
  beforeEach(() => apiMock.mockReset());

  it('trusts the SERVER for what was removed, not the child list on screen', async () => {
    // The screen may be stale, collapsed, or showing a subset. Undo has to restore
    // exactly what went away, so affectedIds is authoritative over anything local.
    apiMock.mockResolvedValue({ affectedIds: ['g1', 'c1', 'c2', 'c3', 'c4'] });
    const result = await deleteEntry(group([{ uuid: 'c1' }]));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrilist/g1', {}, 'DELETE');
    expect(result).toEqual({ entryIds: ['g1', 'c1', 'c2', 'c3', 'c4'], label: 'Asian Chicken Plate' });
  });

  it('still offers an Undo target when the server reports no ids', async () => {
    apiMock.mockResolvedValue({});
    expect(await deleteEntry({ uuid: 'r1', name: 'Hearty' }))
      .toEqual({ entryIds: ['r1'], label: 'Hearty' });
  });

  it('propagates a failure instead of reporting a delete that did not happen', async () => {
    // `mockRejectedValue` here builds a rejected promise vitest sees as unhandled
    // before the assertion attaches to it, failing the run on a rejection the test
    // is deliberately causing. Throwing from the implementation rejects only when
    // called, which is what the caller actually experiences.
    apiMock.mockImplementationOnce(async () => { throw Object.assign(new Error('offline'), { status: 503 }); });
    await expect(deleteEntry({ uuid: 'r1', name: 'Hearty' })).rejects.toThrow('offline');
  });
});
