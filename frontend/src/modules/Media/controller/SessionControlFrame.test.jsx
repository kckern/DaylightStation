import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionControlFrame } from './SessionControlFrame.jsx';

describe('common session-controller layout', () => {
  it.each(['local', 'remote'])('%s uses the same seek, transport, queue slot order', (targetKind) => {
    render(<SessionControlFrame targetKind={targetKind}><span>controls</span></SessionControlFrame>);
    expect(screen.getByTestId(`session-controls-${targetKind}`))
      .toHaveAttribute('data-control-layout', 'seek transport queue');
  });
});
