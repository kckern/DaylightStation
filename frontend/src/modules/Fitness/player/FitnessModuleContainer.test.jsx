import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ fitnessSessionInstance: null }),
}));
vi.mock('@/modules/Fitness/index.js', () => ({
  getModule: () => ({ deviceId }) => <div data-testid="module" data-device-id={deviceId || ''} />,
  getModuleManifest: () => ({}),
}));
vi.mock('./FitnessModuleErrorBoundary.jsx', () => ({
  default: ({ children }) => children,
}));

import FitnessModuleContainer from './FitnessModuleContainer.jsx';

describe('FitnessModuleContainer device identity', () => {
  it('passes the app shell fleet device id to a mounted module', () => {
    render(<FitnessModuleContainer moduleId="emulator" deviceId="garage-tv" />);
    expect(screen.getByTestId('module').getAttribute('data-device-id')).toBe('garage-tv');
  });
});
