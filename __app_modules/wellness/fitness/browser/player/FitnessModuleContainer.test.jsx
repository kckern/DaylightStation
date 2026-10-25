import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

vi.mock("../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => ({ fitnessSessionInstance: null }),
}));
const moduleHarness = vi.hoisted(() => ({ guard: null }));
afterEach(() => { cleanup(); moduleHarness.guard = null; });
vi.mock("../index.js", () => ({
  getModule: () => function TestModule({ deviceId, registerCloseGuard, onClose }) {
    React.useEffect(() => { registerCloseGuard?.(moduleHarness.guard); return () => registerCloseGuard?.(null); }, [registerCloseGuard]);
    return <div data-testid="module" data-device-id={deviceId || ''}><button onClick={onClose}>Close module</button></div>;
  },
  getModuleManifest: () => ({}),
}));
vi.mock("./FitnessModuleErrorBoundary.jsx", () => ({
  default: ({ children }) => children,
}));

import FitnessModuleContainer from "./FitnessModuleContainer.jsx";

describe('FitnessModuleContainer device identity', () => {
  it('passes the app shell fleet device id to a mounted module', () => {
    render(<FitnessModuleContainer moduleId="emulator" deviceId="garage-tv" />);
    expect(screen.getByTestId('module').getAttribute('data-device-id')).toBe('garage-tv');
  });
});


it('keeps the host mounted until its child acknowledges the final save', async () => {
  let finish; moduleHarness.guard = vi.fn(() => new Promise(done => { finish = done; }));
  const onClose = vi.fn(); render(<FitnessModuleContainer moduleId="emulator" onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close module' }));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'ok' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
it('does not close the host when its child cannot save', async () => {
  moduleHarness.guard = vi.fn(async () => ({ status: 'error' }));
  const onClose = vi.fn(); render(<FitnessModuleContainer moduleId="emulator" onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close module' }));
  await act(async () => {}); expect(onClose).not.toHaveBeenCalled();
});
