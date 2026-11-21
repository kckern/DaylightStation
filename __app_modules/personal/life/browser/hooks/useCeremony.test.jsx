import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DaylightAPI } from '@/lib/api.mjs';
import { useCeremony } from './useCeremony.js';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('./useLifeUser.js', () => ({ useLifeUsername: () => 'alex' }));

it('keeps the draft on refusal and coalesces a double submit', async () => {
  DaylightAPI.mockResolvedValueOnce({ periodId: 1 });
  const {result} = renderHook(() => useCeremony('weekly'));
  await waitFor(() => expect(result.current.content).toEqual({ periodId: 1 }));
  act(() => result.current.setResponse('goal', 'walk'));
  let refuse;
  DaylightAPI.mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
  act(() => { result.current.submit(); result.current.submit(); });
  expect(DaylightAPI).toHaveBeenCalledTimes(2);
  await act(async () => refuse(Object.assign(new Error(), { status: 409, body: {code: 'NO_PLAN', error: 'Choose a plan'} })));
  expect(result.current.submitError).toEqual({ status: 409, code: 'NO_PLAN', message: 'Choose a plan' });
  expect(result.current.responses.goal).toBe('walk');
});
