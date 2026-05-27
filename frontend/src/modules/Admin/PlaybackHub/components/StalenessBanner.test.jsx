import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StalenessBanner } from './StalenessBanner.jsx';

function r(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('StalenessBanner', () => {
  it('renders null when not stale', () => {
    const { container } = r(<StalenessBanner isStale={false} secondsSinceUpdate={2} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('.mantine-Alert-root')).toBeNull();
  });

  it('renders a banner when stale', () => {
    const { getByText } = r(<StalenessBanner isStale={true} secondsSinceUpdate={42} />);
    expect(getByText(/live updates paused/i)).toBeTruthy();
    expect(getByText(/42/)).toBeTruthy();
  });

  it('renders "no snapshot yet" when secondsSinceUpdate is null', () => {
    const { getByText } = r(<StalenessBanner isStale={true} secondsSinceUpdate={null} />);
    expect(getByText(/no snapshot/i)).toBeTruthy();
  });
});
