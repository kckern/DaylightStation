import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useContext } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { ScreenVolumeProvider } from '../../../frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx';
import { ScreenVolumeContext } from '../../../frontend/src/lib/volume/ScreenVolumeContext.js';

vi.mock('../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }) }),
}));

// Capture the context value so we can assert on effectiveMaster.
let seen;
function Probe() {
  seen = useContext(ScreenVolumeContext);
  return null;
}

const KNEE = [{ in: 0, out: 0 }, { in: 0.5, out: 0.1 }, { in: 1, out: 1 }];

describe('ScreenVolumeProvider curve', () => {
  beforeEach(() => { seen = undefined; window.localStorage.clear(); });
  afterEach?.(() => cleanup());

  it('shapes effectiveMaster through the curve while keeping master user-facing', () => {
    render(
      <ScreenVolumeProvider storageKey="t-knee" defaultMaster={0.5} curve={KNEE}>
        <Probe />
      </ScreenVolumeProvider>,
    );
    expect(seen.master).toBeCloseTo(0.5, 5);          // user-facing level unchanged
    expect(seen.effectiveMaster).toBeCloseTo(0.1, 5); // shaped by the knee
  });

  it('falls back to the linear power curve when no curve is configured', () => {
    render(
      <ScreenVolumeProvider storageKey="t-lin" defaultMaster={0.5}>
        <Probe />
      </ScreenVolumeProvider>,
    );
    expect(seen.effectiveMaster).toBeCloseTo(0.5, 5);
  });

  it('moves effectiveMaster up the upper segment when the master steps up', () => {
    render(
      <ScreenVolumeProvider storageKey="t-step" defaultMaster={0.5} stepSize={0.1} curve={KNEE}>
        <Probe />
      </ScreenVolumeProvider>,
    );
    act(() => seen.step(0.1));   // 0.5 → 0.6
    expect(seen.master).toBeCloseTo(0.6, 5);
    expect(seen.effectiveMaster).toBeCloseTo(0.28, 5);
  });
});
