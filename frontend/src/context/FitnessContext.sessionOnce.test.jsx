import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

const { constructed } = vi.hoisted(() => ({ constructed: vi.fn() }));

vi.mock('../services/WebSocketService', () => ({ wsService: { subscribe: () => () => {}, onStatusChange: () => () => {} } }));
vi.mock('../lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return { default: () => logger, getLogger: () => logger };
});
// Keep the real session; only count constructions.
vi.mock('../hooks/useFitnessSession.js', async (importOriginal) => {
  const mod = await importOriginal();
  class CountingFitnessSession extends mod.FitnessSession {
    constructor(...args) {
      super(...args);
      constructed();
    }
  }
  return { ...mod, FitnessSession: CountingFitnessSession };
});

import { FitnessProvider, useFitnessContext } from './FitnessContext.jsx';

const config = { users: { primary: [] }, plex: {}, sensors: {} };

describe('FitnessProvider session construction', () => {
  it('builds one FitnessSession per provider across re-renders', async () => {
    let context;
    function Probe() { context = useFitnessContext(); return null; }
    const tree = (props) => (
      <FitnessProvider fitnessConfiguration={config} {...props}><Probe /></FitnessProvider>
    );
    const { rerender } = render(tree());
    const sessionAfterMount = context.fitnessSessionInstance;
    expect(sessionAfterMount).toBeTruthy();

    // Parent re-renders and internal state changes both re-run the provider body.
    rerender(tree({ kioskMode: true }));
    rerender(tree({ kioskMode: false }));
    await act(async () => context.setFitnessPlayQueue([{ id: 'video-1', labels: [] }]));
    await act(async () => context.setFitnessPlayQueue([{ id: 'video-2', labels: [] }]));

    expect(constructed).toHaveBeenCalledTimes(1);
    expect(context.fitnessSessionInstance).toBe(sessionAfterMount);
  });
});
