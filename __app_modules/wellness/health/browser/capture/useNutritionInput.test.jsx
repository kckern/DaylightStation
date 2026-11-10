import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useNutritionInput } from "./useNutritionInput.js";

describe('useNutritionInput', () => {
  beforeEach(() => apiMock.mockReset());

  it('submits typed content to the pipeline', async () => {
    apiMock.mockResolvedValue({ messages: [] });
    const { result } = renderHook(() => useNutritionInput());
    await act(() => result.current.submit('barcode', '012345678905'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/input',
      { type: 'barcode', content: '012345678905', operationId: expect.any(String) }, 'POST');
  });

  // Backward-compat pin (Task 4.2): every existing caller that doesn't know
  // about buckets must keep sending the exact same body it always has — no
  // stray `bucket: undefined` key sneaking into the request.
  it('with no bucket passed, the request body is exactly what it was before Task 4.2', async () => {
    apiMock.mockResolvedValue({ messages: [] });
    const { result } = renderHook(() => useNutritionInput());
    await act(() => result.current.submit('voice', 'data:audio/webm;base64,zzz'));
    const [, body] = apiMock.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual(['content', 'operationId', 'type']);
    expect(body).toEqual({ type: 'voice', content: 'data:audio/webm;base64,zzz', operationId: expect.any(String) });
  });

  it('a bucket passed via options is included in the request body', async () => {
    apiMock.mockResolvedValue({ messages: [] });
    const { result } = renderHook(() => useNutritionInput());
    await act(() => result.current.submit('voice', 'data:audio/webm;base64,zzz', { bucket: 'afternoon' }));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/input',
      { type: 'voice', content: 'data:audio/webm;base64,zzz', bucket: 'afternoon', operationId: expect.any(String) }, 'POST');
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

it('keeps identical concurrent submissions distinct and honors explicit retry identity', async () => {
 apiMock.mockReset().mockResolvedValue({committed:true});
 const {result}=renderHook(()=>useNutritionInput());
 await act(async()=>{await Promise.all([result.current.submit('text','apple'),result.current.submit('text','apple')]);});
 expect(apiMock.mock.calls[0][1].operationId).not.toBe(apiMock.mock.calls[1][1].operationId);
 await act(()=>result.current.submit('text','apple',{operationId:'retry-one'}));
 expect(apiMock.mock.calls[2][1].operationId).toBe('retry-one');
});
