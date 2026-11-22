import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateApiResources } from '../../lib/hooks/useApiResource.js';
import { clearAdminDraft } from '../../modules/Admin/shared/useAdminDraftState.js';
import { clearToken, getUser, setToken } from '../../lib/auth.js';
import AdminSessionBoundary from '../../modules/Admin/shared/AdminSessionBoundary.jsx';

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
      { parsed: { file: 'edited' }, expectedRevision: null },
      'PUT',
    ]);
    expect(result.current.data).toEqual({ file: 'edited' });
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setData(previous => ({ ...previous, file: 'later edit' })));
    act(() => result.current.revert());
    expect(result.current.data).toEqual({ file: 'edited' });
    expect(result.current.dirty).toBe(false);
  });

  it.each(['parsed', 'raw'])('preserves a newer %s draft and reverts to the acknowledged save', async format => {
    let reply;
    apiState.respond = (path, body, method) => method === 'PUT'
      ? new Promise(resolve => { reply = resolve; })
      : Promise.resolve({ parsed: { file: 'original' }, raw: 'file: original\n' });
    const { result } = renderHook(() => useAdminConfig('one.yml'));
    await waitFor(() => expect(result.current.draftReady).toBe(true));

    const useRaw = format === 'raw';
    const edit = value => useRaw
      ? result.current.setRaw(`file: ${value}\n`)
      : result.current.setData({ file: value });
    act(() => edit('submitted'));
    let saved;
    act(() => { saved = result.current.save({ useRaw }); });
    expect(apiState.calls[1].slice(1)).toEqual([
      useRaw
        ? { raw: 'file: submitted\n', expectedRevision: null }
        : { parsed: { file: 'submitted' }, expectedRevision: null },
      'PUT',
    ]);
    act(() => edit('latest draft'));
    await act(async () => {
      reply({ parsed: { file: 'normalized' }, raw: 'file: normalized\n' });
      await saved;
    });

    if (useRaw) expect(result.current.raw).toBe('file: latest draft\n');
    else expect(result.current.data).toEqual({ file: 'latest draft' });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.revert());
    expect(result.current.raw).toBe('file: normalized\n');
    expect(result.current.data).toEqual({ file: 'normalized' });
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

  it('restores an unmounted raw draft only against the exact raw server baseline', async () => {
    const filePath = 'history-exact-baseline.yml';
    const ownerKey = JSON.stringify(['config', 'anonymous', filePath, 'raw']);
    let readCount = 0;
    apiState.respond = async () => {
      readCount += 1;
      return {
        parsed: { enabled: true },
        raw: readCount === 1 ? '# original comment\nenabled: true\n' : '# changed comment\nenabled: true\n',
      };
    };

    const first = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(first.result.current.draftReady).toBe(true));
    act(() => first.result.current.setRaw('# local comment\nenabled: false\n'));
    first.unmount();

    const second = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(second.result.current.draftReady).toBe(true));
    expect(second.result.current.raw).toBe('# changed comment\nenabled: true\n');
    expect(second.result.current.dirty).toBe(false);
    second.unmount();
    clearAdminDraft(ownerKey);
  });

  it('keeps parsed and raw history drafts in separate editor modes', async () => {
    const filePath = 'history-editor-mode.yml';
    const parsedKey = JSON.stringify(['config', 'anonymous', filePath, 'parsed']);
    const rawKey = JSON.stringify(['config', 'anonymous', filePath, 'raw']);
    apiState.respond = async () => ({ parsed: { enabled: true }, raw: 'enabled: true\n' });

    const raw = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(raw.result.current.draftReady).toBe(true));
    act(() => raw.result.current.setRaw('enabled: raw draft\n'));
    raw.unmount();

    const parsed = renderHook(() => useAdminConfig(filePath, 'parsed'));
    await waitFor(() => expect(parsed.result.current.draftReady).toBe(true));
    expect(parsed.result.current.data).toEqual({ enabled: true });
    expect(parsed.result.current.dirty).toBe(false);
    parsed.unmount();

    const restoredRaw = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(restoredRaw.result.current.draftReady).toBe(true));
    expect(restoredRaw.result.current.raw).toBe('enabled: raw draft\n');
    expect(restoredRaw.result.current.dirty).toBe(true);
    restoredRaw.unmount();
    clearAdminDraft(parsedKey);
    clearAdminDraft(rawKey);
  });

  it('does not restore a draft across auth sessions', async () => {
    const filePath = 'history-session-scope.yml';
    const sessionOne = JSON.stringify(['config', JSON.stringify(['alice', 'session-one']), filePath, 'raw']);
    const sessionTwo = JSON.stringify(['config', JSON.stringify(['bob', 'session-two']), filePath, 'raw']);
    apiState.respond = async () => ({ parsed: { enabled: true }, raw: 'enabled: true\n' });
    const setSession = (sub, sid) => {
      const payload = btoa(JSON.stringify({ sub, sid }));
      localStorage.setItem('ds_token', `header.${payload}.signature`);
    };

    setSession('alice', 'session-one');
    const first = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(first.result.current.draftReady).toBe(true));
    act(() => first.result.current.setRaw('enabled: Alice draft\n'));
    first.unmount();

    setSession('bob', 'session-two');
    const second = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(second.result.current.draftReady).toBe(true));
    expect(second.result.current.raw).toBe('enabled: true\n');
    expect(second.result.current.dirty).toBe(false);
    second.unmount();
    localStorage.removeItem('ds_token');
    clearAdminDraft(sessionOne);
    clearAdminDraft(sessionTwo);
  });

  it('does not expose the previous session config while the replacement session loads', async () => {
    let resolveBob;
    apiState.respond = async () => {
      if (getUser()?.sub === 'bob') return new Promise(resolve => { resolveBob = resolve; });
      return { parsed: { owner: 'amy' }, raw: 'owner: amy\n' };
    };
    const token = owner => `header.${btoa(JSON.stringify({ sub: owner, sid: owner + '-session' }))}.signature`;
    act(() => setToken(token('amy')));
    const view = renderHook(() => useAdminConfig('session-switch.yml'), {
      wrapper: ({ children }) => <AdminSessionBoundary>{children}</AdminSessionBoundary>,
    });
    await waitFor(() => expect(view.result.current.raw).toBe('owner: amy\n'));

    act(() => setToken(token('bob')));
    await waitFor(() => expect(apiState.calls).toHaveLength(2));
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.data).toBeNull();
    expect(view.result.current.raw).toBe('');

    resolveBob({ parsed: { owner: 'bob' }, raw: 'owner: bob\n' });
    await waitFor(() => expect(view.result.current.raw).toBe('owner: bob\n'));
    view.unmount();
    act(() => clearToken());
  });

  it('keeps a later draft when an earlier save acknowledges after unmount', async () => {
    const filePath = 'history-late-save.yml';
    const ownerKey = JSON.stringify(['config', 'anonymous', filePath, 'raw']);
    let acknowledgeWrite;
    apiState.respond = (path, body, method) => method === 'PUT'
      ? new Promise(resolve => { acknowledgeWrite = resolve; })
      : Promise.resolve({ parsed: { enabled: true }, raw: 'enabled: true\n' });

    const first = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(first.result.current.draftReady).toBe(true));
    act(() => first.result.current.setRaw('enabled: submitted\n'));
    let save;
    act(() => { save = first.result.current.save({ useRaw: true }); });
    act(() => first.result.current.setRaw('enabled: latest draft\n'));
    first.unmount();

    await act(async () => {
      acknowledgeWrite({ parsed: { enabled: true }, raw: 'enabled: submitted\n' });
      await save;
    });
    apiState.respond = async () => ({ parsed: { enabled: true }, raw: 'enabled: submitted\n' });

    const second = renderHook(() => useAdminConfig(filePath, 'raw'));
    await waitFor(() => expect(second.result.current.draftReady).toBe(true));
    expect(second.result.current.raw).toBe('enabled: latest draft\n');
    expect(second.result.current.dirty).toBe(true);
    second.unmount();
    clearAdminDraft(ownerKey);
  });
});
