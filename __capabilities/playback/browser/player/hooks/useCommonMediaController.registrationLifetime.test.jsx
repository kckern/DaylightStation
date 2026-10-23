import React, { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommonMediaController } from './useCommonMediaController.js';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({})),
}));

const meta = { assetId: 'controller-lifetime', title: 'Controller lifetime' };
const onEnd = () => {};
function Harness({ onController }) {
  useCommonMediaController({ meta, onEnd, onController, isVideo: true });
  return null;
}

afterEach(cleanup);

describe('shared controller registration lifetime', () => {
  it('releases the retired registration on callback replacement and unmount', () => {
    const firstReleases = [];
    const secondReleases = [];
    const register = releases => vi.fn(() => {
      const release = vi.fn();
      releases.push(release);
      return release;
    });
    const first = register(firstReleases);
    const second = register(secondReleases);
    const { rerender, unmount } = render(<Harness onController={first} />);
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ toggle: expect.any(Function) }));
    rerender(<Harness onController={second} />);
    firstReleases.forEach(release => expect(release).toHaveBeenCalledTimes(1));
    expect(secondReleases.at(-1)).not.toHaveBeenCalled();
    unmount();
    [...firstReleases, ...secondReleases].forEach(release => expect(release).toHaveBeenCalledTimes(1));
    expect([...first.mock.calls, ...second.mock.calls].every(([controller]) => controller?.toggle)).toBe(true);
  });

  it('supports legacy void consumers without null notifications', () => {
    const onController = vi.fn();
    const { unmount } = render(<Harness onController={onController} />);
    const registrations = onController.mock.calls.length;
    expect(registrations).toBeGreaterThan(0);
    expect(() => unmount()).not.toThrow();
    expect(onController).toHaveBeenCalledTimes(registrations);
    expect(onController).toHaveBeenCalledWith(expect.objectContaining({ pause: expect.any(Function) }));
  });

  it('releases each Strict Mode setup independently', () => {
    const releases = [];
    const onController = vi.fn(() => {
      const release = vi.fn();
      releases.push(release);
      return release;
    });
    const { unmount } = render(<StrictMode><Harness onController={onController} /></StrictMode>);
    expect(releases.length).toBeGreaterThanOrEqual(2);
    releases.slice(0, -1).forEach(release => expect(release).toHaveBeenCalledTimes(1));
    expect(releases.at(-1)).not.toHaveBeenCalled();
    unmount();
    releases.forEach(release => expect(release).toHaveBeenCalledTimes(1));
    expect(onController.mock.calls.every(([controller]) => controller?.toggle)).toBe(true);
  });
});
