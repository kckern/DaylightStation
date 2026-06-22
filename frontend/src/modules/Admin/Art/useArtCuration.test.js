import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }) }),
}));

import { useArtCuration } from './useArtCuration.js';

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path) => {
    if (path.startsWith('api/v1/admin/art/works')) {
      return Promise.resolve({ total: 2, works: [
        { id: 'a', image: '/img/a.png', meta: { title: 'A', tags: [], hidden: false, flagged: false } },
        { id: 'b', image: '/img/b.png', meta: { title: 'B', tags: [], hidden: false, flagged: false } },
      ] });
    }
    return Promise.resolve({ ok: true, meta: { title: 'A', tags: ['impressionism'] } });
  });
});

describe('useArtCuration', () => {
  it('loads works on mount', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    expect(result.current.focused.id).toBe('a');
  });

  it('mutate() PATCHes and optimistically updates the focused work', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    await act(async () => { await result.current.mutate({ tags: ['impressionism'] }); });
    expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { tags: ['impressionism'] }, 'PATCH');
    expect(result.current.focused.meta.tags).toEqual(['impressionism']);
  });

  it('undo() reverts the last mutation', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    await act(async () => { await result.current.mutate({ hidden: true }); });
    expect(result.current.focused.meta.hidden).toBe(true);
    await act(async () => { await result.current.undo(); });
    expect(result.current.focused.meta.hidden).toBe(false);
  });

  it('next() advances the focus index', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    act(() => { result.current.next(); });
    expect(result.current.focused.id).toBe('b');
  });
});
