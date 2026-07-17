import React, { useRef, useContext } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { PlayerHostContext } from './playerHostContext.js';
import { usePlayerHost } from './usePlayerHost.js';

function Claimant({ priority, testid }) {
  const ref = useRef(null);
  usePlayerHost(ref, priority);
  return <div ref={ref} data-testid={testid} />;
}

function ActiveHostProbe() {
  const host = useContext(PlayerHostContext);
  return (
    <span data-testid="active-host">
      {host ? host.getAttribute('data-testid') : 'none'}
    </span>
  );
}

describe('PlayerHostProvider', () => {
  it('portals to the highest-priority claim and falls back when it unmounts', () => {
    const { rerender } = render(
      <PlayerHostProvider>
        <Claimant priority={1} testid="low" />
        <Claimant priority={2} testid="high" />
        <ActiveHostProbe />
      </PlayerHostProvider>
    );
    expect(screen.getByTestId('active-host')).toHaveTextContent('high');

    // Now Playing (high) closes → dock (low) takes over.
    rerender(
      <PlayerHostProvider>
        <Claimant priority={1} testid="low" />
        <ActiveHostProbe />
      </PlayerHostProvider>
    );
    expect(screen.getByTestId('active-host')).toHaveTextContent('low');

    // Everything gone → back to the off-screen park (null → 'none').
    rerender(
      <PlayerHostProvider>
        <ActiveHostProbe />
      </PlayerHostProvider>
    );
    expect(screen.getByTestId('active-host')).toHaveTextContent('none');
  });
});
