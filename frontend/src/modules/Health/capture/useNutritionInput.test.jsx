import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useNutritionInput } from './useNutritionInput.js';

describe('useNutritionInput', () => {
  beforeEach(() => apiMock.mockReset());

  it('submits typed content to the pipeline', async () => {
    apiMock.mockResolvedValue({ messages: [] });
    const { result } = renderHook(() => useNutritionInput());
    await act(() => result.current.submit('barcode', '012345678905'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/input',
      { type: 'barcode', content: '012345678905' }, 'POST');
  });

  it('surfaces unknownUpc results', async () => {
    apiMock.mockResolvedValue({ success: false, unknownUpc: true, upc: '000', messages: [] });
    const { result } = renderHook(() => useNutritionInput());
    let out;
    await act(async () => { out = await result.current.submit('barcode', '000'); });
    expect(out.unknownUpc).toBe(true);
  });

  it('keeps the error and clears busy on failure', async () => {
    apiMock.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useNutritionInput());
    await act(async () => { try { await result.current.submit('image', 'data:...'); } catch { /* asserted below */ } });
    expect(result.current.error.message).toBe('down');
    expect(result.current.busy).toBe(false);
  });
});
