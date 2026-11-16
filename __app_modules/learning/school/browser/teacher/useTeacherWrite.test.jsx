import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({}));
vi.mock("./TeacherProfileContext.jsx", () => ({ useTeacherProfile: () => profile }));
vi.mock("./teacherLog.js", () => ({
  teacherLog: { write: vi.fn(), writeRefused: vi.fn() },
}));

import { useTeacherWrite } from "./useTeacherWrite.js";
import { teacherLog } from "./teacherLog.js";

const TEACHER = { id: 'teacher', name: 'Teacher' };

beforeEach(() => {
  vi.clearAllMocks();
  profile.currentTeacher = null;
  profile.teachers = [TEACHER];
  profile.pickerOpen = false;
  profile.openPicker = vi.fn();
});

describe('useTeacherWrite — a run waiting on the teacher picker (awaitClaim)', () => {
  it('resolves with the replay once a teacher is chosen', async () => {
    const { result, rerender } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    const call = vi.fn(async () => ({ ok: true, status: 200, data: null }));
    let settled;
    act(() => { settled = result.current.run('k', call, { awaitClaim: true }); });
    expect(profile.openPicker).toHaveBeenCalled();
    profile.currentTeacher = TEACHER;
    rerender();
    await expect(settled).resolves.toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('resolves false when the component goes away while it waits', async () => {
    const { result, unmount } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    let settled;
    act(() => { settled = result.current.run('k', vi.fn(), { awaitClaim: true }); });
    unmount();
    await expect(settled).resolves.toBe(false);
  });

  it('with no teacher to choose, does not wait on a picker that cannot help: false at once, and says why', async () => {
    profile.teachers = [];
    const { result } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    let settled;
    act(() => { settled = result.current.run('k', vi.fn(), { awaitClaim: true }); });
    await expect(settled).resolves.toBe(false);
    expect(profile.openPicker).not.toHaveBeenCalled();
    expect(result.current.errors.k).toMatch(/No teacher/);
  });

  it('a replay that throws is logged and resolves false', async () => {
    const { result, rerender } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    let settled;
    act(() => { settled = result.current.run('k', async () => { throw new Error('boom'); }, { awaitClaim: true }); });
    profile.currentTeacher = TEACHER;
    rerender();
    await expect(settled).resolves.toBe(false);
    expect(teacherLog.writeRefused).toHaveBeenCalledWith('replay-failed', expect.objectContaining({ panel: 'test', key: 'k', errorKind: 'exception' }));
  });

  it('without awaitClaim, a blocked run still answers false at once', async () => {
    const { result } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    let settled;
    act(() => { settled = result.current.run('k', vi.fn()); });
    await expect(settled).resolves.toBe(false);
    expect(profile.openPicker).toHaveBeenCalled();
  });
});

describe('useTeacherWrite — a claimed teacher', () => {
  it('settles thrown composed writes and releases busy state for retry', async () => {
    profile.currentTeacher = TEACHER;
    const { result } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    await act(async () => {
      await expect(result.current.run('save', async () => { throw new Error('offline'); })).resolves.toBe(false);
    });
    expect(result.current.busy).toBe(null);
    expect(result.current.errors.save).toMatch(/try again/i);
  });

  it('serializes immediate duplicate activations and ignores a late success after exit', async () => {
    profile.currentTeacher = TEACHER;
    const { result, unmount } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    let settle;
    const call = vi.fn(() => new Promise(resolve => { settle = resolve; }));
    const onSuccess = vi.fn();
    let first;
    act(() => { first = result.current.run('save', call, { onSuccess }); result.current.run('save', call, { onSuccess }); });
    expect(call).toHaveBeenCalledTimes(1);
    unmount();
    settle({ ok: true, data: { saved: true } });
    await expect(first).resolves.toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });
  it('sends the picked teacher as actorId and nothing else', async () => {
    profile.currentTeacher = TEACHER;
    const { result } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    const call = vi.fn(async () => ({ ok: true, status: 200, data: { saved: true } }));
    const onSuccess = vi.fn();
    let settled;
    await act(async () => { settled = await result.current.run('k', call, { onSuccess }); });
    expect(settled).toBe(true);
    expect(call).toHaveBeenCalledWith({ actorId: 'teacher' });
    expect(onSuccess).toHaveBeenCalledWith({ saved: true });
  });

  it('a 403 says the server\'s reason once and is not retried', async () => {
    profile.currentTeacher = TEACHER;
    const { result } = renderHook(() => useTeacherWrite({ panel: 'test' }));
    const call = vi.fn(async () => ({ ok: false, status: 403, data: { error: 'Only a listed teacher can do that.' } }));
    let settled;
    await act(async () => { settled = await result.current.run('k', call); });
    expect(settled).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.current.errors.k).toBe('Only a listed teacher can do that.');
    expect(teacherLog.writeRefused).toHaveBeenCalledWith('refused', expect.objectContaining({ panel: 'test', key: 'k', status: 403 }));
  });
});
