// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { LifeUserContext } from '#frontend/modules/Life/hooks/useLifeUser.js';
import { GoalsView } from '#frontend/modules/Life/views/plan/GoalsView.jsx';

/**
 * C5 regression guard (rider from the C5 review): the household user switcher
 * threads the resolved user through LifeUserContext, and data views must read
 * it when given no explicit `username` prop. If someone severs that wiring
 * (e.g. drops the `useLifeUsername()` fallback in a hook, or stops passing the
 * context value), every member silently reverts to head-of-household data.
 *
 * We render the simplest URL-keyed view (GoalsView → useGoals) WITHOUT a
 * username prop, wrap it in a provider for `test-user-2`, and assert the fetch
 * carried `username=test-user-2`. Placed in its own file so the guard is
 * self-documenting and independent of the switcher's own UI tests.
 */

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ goals: [] }))));
});

describe('LifeUserContext → surface threading (C5 guard)', () => {
  it('GoalsView with no username prop fetches for the context user', async () => {
    render(
      <MantineProvider>
        <LifeUserContext.Provider value={{ username: 'test-user-2' }}>
          <GoalsView />
        </LifeUserContext.Provider>
      </MantineProvider>
    );

    await waitFor(() => {
      expect(fetch.mock.calls.some(([u]) => u.includes('/goals'))).toBe(true);
    });
    // The goals fetch must be scoped to the context-provided user, not the
    // backend-default head-of-household.
    const goalsCall = fetch.mock.calls.find(([u]) => u.includes('/goals'));
    expect(goalsCall[0]).toContain('username=test-user-2');
  });
});
