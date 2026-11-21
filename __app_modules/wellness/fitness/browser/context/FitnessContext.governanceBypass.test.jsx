import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
vi.mock("../../../../../frontend/src/services/WebSocketService.js", () => ({ wsService: { subscribe: () => () => {}, onStatusChange: () => () => {} } }));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return { default: () => logger, getLogger: () => logger };
});
// The meter is the consumer that re-paused the unlocked video; record what it is handed.
const budgetCalls = vi.hoisted(() => []);
vi.mock('../player/usePlaybackBudget.js', () => ({
  usePlaybackBudget: (args) => { budgetCalls.push(args); return { blocked: false, status: 'inactive', remainingMs: 0, grantOverride: () => false }; },
}));
import { FitnessProvider, useFitnessContext } from "./FitnessContext.jsx";

const config = { users: { primary: [] }, plex: {}, sensors: {} };

// 2026-11-20: a governance bypass lived only in FitnessPlayer's local copy of the
// governance state; the playback-budget meter in this provider read the engine
// snapshot and kept the video paused. One state, applied here, read by everyone.
describe('FitnessContext governance bypass is one source of truth', () => {
  it('the bypass the player publishes is the governanceState the budget meter receives', async () => {
    let context;
    function Probe() { context = useFitnessContext(); return null; }
    render(<FitnessProvider fitnessConfiguration={config}><Probe /></FitnessProvider>);
    expect(typeof context.setGovernanceBypassed).toBe('function');
    const engineState = context.governanceState;

    await act(async () => context.setGovernanceBypassed(true));
    await waitFor(() => expect(context.governanceState).toMatchObject({ videoLocked: false, isGoverned: false, status: 'unlocked' }));
    expect(budgetCalls.at(-1).governanceState).toBe(context.governanceState);

    await act(async () => context.setGovernanceBypassed(false));
    await waitFor(() => expect(context.governanceState.status).toBe(engineState.status));
    expect(context.governanceState.status).not.toBe('unlocked');
    expect(budgetCalls.at(-1).governanceState).toBe(context.governanceState);
  });
});
