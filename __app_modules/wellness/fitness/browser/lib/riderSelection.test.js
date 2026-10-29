import { it, expect, vi } from 'vitest';
import { dispatchRiderSelection } from './riderSelection.js';
it('always ingests assignment, then lets an active app consume only its cosmetic toast', () => {
 const data = { equipmentId: 'bike', userId: 'rider' };
 const order = [];
 const ingest = vi.fn(() => order.push('ingest'));
 const emit = vi.fn(() => { order.push('emit'); return true; });
 const toast = vi.fn();
 dispatchRiderSelection(data, { ingest, emit, toast });
 expect(order).toEqual(['ingest', 'emit']);
 expect(ingest).toHaveBeenCalledWith(data);
 expect(toast).not.toHaveBeenCalled();
 emit.mockReturnValue(false);
 dispatchRiderSelection(data, { ingest, emit, toast });
 expect(toast).toHaveBeenCalledWith(data);
});
