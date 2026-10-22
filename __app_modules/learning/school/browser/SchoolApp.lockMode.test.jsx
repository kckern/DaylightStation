import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock("./schoolApi.js", () => ({ schoolApi: { screenSchoolConfig: vi.fn() } }));
// The same module-load mocks SchoolApp.lockSplit.test.jsx carries.
vi.mock("./Programs/SentenceLadder/languageApi.js", () => ({
  languageApi: { courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })) },
}));
vi.mock("./useSchoolLaunch.js", () => ({ useSchoolLaunch: vi.fn() }));
vi.mock("../../../../frontend/src/hooks/useShutdownLock.js", () => ({
  useShutdownLock: () => ({ locked: false }),
  ShutdownBlackout: () => null,
}));
vi.mock("../../../../frontend/src/lib/fkb.js", () => ({ screenOff: vi.fn(() => true) }));
import { schoolApi } from "./schoolApi.js";
import { useSchoolLockMode } from "./SchoolApp.jsx";

const args = { screenId: 'portal', mode: null, idleTimeoutSeconds: null, screenOffTimeoutSeconds: null };

beforeEach(() => { schoolApi.screenSchoolConfig.mockReset(); });

describe('useSchoolLockMode: coin ceremony config', () => {
  it('hands the screen config\'s school.coinCeremony block through', async () => {
    schoolApi.screenSchoolConfig.mockResolvedValue({ ok: true, status: 200, data: { school: { mode: 'locked', coinCeremony: { sound: 'school/_ux/other.mp3' } } } });
    const { result } = renderHook(() => useSchoolLockMode(args));
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(schoolApi.screenSchoolConfig).toHaveBeenCalledWith('portal');
    expect(result.current.coinCeremony).toEqual({ sound: 'school/_ux/other.mp3' });
    expect(result.current.locked).toBe(true);
  });
  it('no block, or no screen config, is null: the defaults apply', async () => {
    schoolApi.screenSchoolConfig.mockResolvedValue({ ok: false, status: 404, data: null });
    const { result } = renderHook(() => useSchoolLockMode(args));
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.coinCeremony).toBeNull();
  });
  it('an explicit mode is null too', () => {
    const { result } = renderHook(() => useSchoolLockMode({ ...args, mode: 'locked' }));
    expect(result.current.resolved).toBe(true);
    expect(result.current.coinCeremony).toBeNull();
  });
});
