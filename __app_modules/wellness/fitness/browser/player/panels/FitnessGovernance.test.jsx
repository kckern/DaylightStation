import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const testState = vi.hoisted(() => ({ context: null }));

vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => testState.context,
}));

import FitnessGovernance from "./FitnessGovernance.jsx";

const renderWith = (governanceState) => {
  testState.context = { governanceState };
  return render(<FitnessGovernance />);
};

describe('FitnessGovernance status bar', () => {
  it('says "Waiting for riders" while pending under an active policy', () => {
    const { container } = renderWith({ isGoverned: true, status: 'pending', policyId: 'default' });
    expect(container.querySelector('.fg-status-pill').textContent).toBe('Waiting for riders');
  });

  // The engine is also 'pending' when no policy applies (reset() clears
  // policyId): nothing is being waited for, so there is nothing to say.
  it('hides while pending with no active policy', () => {
    const { container } = renderWith({ isGoverned: true, status: 'pending', policyId: null });
    expect(container.firstChild).toBeNull();
  });

  it.each(['idle', 'off', undefined])('hides entirely when the status is %s', (status) => {
    const { container } = renderWith({ isGoverned: true, status });
    expect(container.firstChild).toBeNull();
  });

  it('hides when the media is not governed', () => {
    const { container } = renderWith({ isGoverned: false, status: 'pending', policyId: 'default' });
    expect(container.firstChild).toBeNull();
  });

  it.each(['unlocked', 'warning', 'locked'])('keeps the striped bar for %s', (status) => {
    const { container } = renderWith({ isGoverned: true, status });
    expect(container.querySelector('.fg-stripe-bar')).not.toBeNull();
  });
});
