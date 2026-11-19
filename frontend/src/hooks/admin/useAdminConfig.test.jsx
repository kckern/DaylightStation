import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateApiResources } from '../../lib/hooks/useApiResource.js';

const { apiState } = vi.hoisted(() => ({ apiState: { calls: [], respond: null } }));
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => {
    apiState.calls.push(args);
    return apiState.respond(...args);
  },
}));

import { useAdminConfig } from './useAdminConfig.js';

describe('useAdminConfig resource ownership', () => {
  beforeEach(() => {
    apiState.calls = [];
    apiState.respond = async path => ({ parsed: { file: path }, raw: `file: ${path}\n` });
  });

  it('loads the selected file and replaces its draft when the path changes', async () => {
    let resolveSecond;
    apiState.respond = path => path.endsWith('/two.yml')
      ? new Promise(resolve => { resolveSecond = resolve; })
      : Promise.resolve({ parsed: { file: path }, raw: `file: ${path}\n` });
    const { result, rerender } = renderHook(({ filePath }) => useAdminConfig(filePath), {
      initialProps: { filePath: 'one.yml' },
    });

    await waitFor(() => expect(result.current.data).toEqual({ file: '/api/v1/admin/config/files/one.yml' }), { timeout: 1000 });
    expect(result.current.raw).toBe('file: /api/v1/admin/config/files/one.yml\n');

    rerender({ filePath: 'two.yml' });
    await waitFor(() => expect(apiState.calls).toHaveLength(2), { timeout: 1000 });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.raw).toBe('');

    resolveSecond({ parsed: { file: '/api/v1/admin/config/files/two.yml' }, raw: 'file: /api/v1/admin/config/files/two.yml\n' });
    await waitFor(() => expect(result.current.data).toEqual({ file: '/api/v1/admin/config/files/two.yml' }), { timeout: 1000 });
    expect(result.current.raw).toBe('file: /api/v1/admin/config/files/two.yml\n');
    expect(apiState.calls.map(([path]) => path)).toEqual([
      '/api/v1/admin/config/files/one.yml',
      '/api/v1/admin/config/files/two.yml',
    ]);
  });

  it('keeps edits local until save, and revert returns to the saved snapshot', async () => {
    apiState.respond = async (path, body, method) => method === 'PUT'
      ? { parsed: body.parsed, raw: `file: ${body.parsed.file}\n` }
      : { parsed: { file: 'original' }, raw: 'file: original\n' };
    const { result } = renderHook(() => useAdminConfig('one.yml'));
    await waitFor(() => expect(result.current.data).toEqual({ file: 'original' }), { timeout: 1000 });

    act(() => result.current.setData(previous => ({ ...previous, file: 'edited' })));
    expect(result.current.dirty).toBe(true);
    expect(apiState.calls).toHaveLength(1);

    await act(async () => { await result.current.save(); });
    expect(apiState.calls[1]).toEqual([
      '/api/v1/admin/config/files/one.yml',
      { parsed: { file: 'edited' } },
      'PUT',
    ]);
    expect(result.current.data).toEqual({ file: 'edited' });
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setData(previous => ({ ...previous, file: 'later edit' })));
    act(() => result.current.revert());
    expect(result.current.data).toEqual({ file: 'edited' });
    expect(result.current.dirty).toBe(false);
  });

  it('keeps a dirty draft when the shared resource is refreshed', async () => {
    let readCount = 0;
    apiState.respond = async (path, body, method) => {
      if (method === 'PUT') return { parsed: body.parsed, raw: '' };
      readCount += 1;
      return { parsed: { file: `server-${readCount}` }, raw: `file: server-${readCount}\n` };
    };
    const path = '/api/v1/admin/config/files/one.yml';
    const { result } = renderHook(() => useAdminConfig('one.yml'));
    await waitFor(() => expect(result.current.data).toEqual({ file: 'server-1' }), { timeout: 1000 });
    act(() => result.current.setData({ file: 'local-edit' }));

    act(() => invalidateApiResources(candidate => candidate === path));
    await waitFor(() => expect(readCount).toBe(2), { timeout: 1000 });
    expect(result.current.data).toEqual({ file: 'local-edit' });
    expect(result.current.dirty).toBe(true);

    act(() => result.current.revert());
    expect(result.current.data).toEqual({ file: 'server-2' });
  });
});
