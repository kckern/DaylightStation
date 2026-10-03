import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SpotChooser } from './SpotChooser.jsx';
import { createScreenNamer } from './householdModel.js';

describe('SpotChooser', () => {
  it('names a spot saved before per-screen spots as earlier, never "Legacy" or "another screen"', () => {
    const nameFor = createScreenNamer({ screens: [{ id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV' }] });
    render(<MantineProvider><SpotChooser nameFor={nameFor} onChoose={vi.fn()} onClose={vi.fn()} choice={{ item: { title: 'Arrival' }, spots: [
      { deviceId: 'fleet:livingroom-tv', playhead: 4800 },
      { deviceId: 'legacy', kind: 'unknown', playhead: 720 },
      { deviceId: null, playhead: 300 },
    ] }} /></MantineProvider>);
    expect(screen.getByTestId('spot-choice-0')).toHaveTextContent('1 h 20 m on Living Room TV');
    expect(screen.getByTestId('spot-choice-1')).toHaveTextContent('12 m, saved earlier');
    expect(screen.getByTestId('spot-choice-2')).toHaveTextContent('5 m, saved earlier');
    expect(document.body.textContent).not.toMatch(/Legacy|another screen/);
  });
});
