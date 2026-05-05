import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleBaseReqIndicator } from './CycleBaseReqIndicator.jsx';

describe('CycleBaseReqIndicator', () => {
  it('renders the satisfied state when baseReqSatisfied is true', () => {
    render(<CycleBaseReqIndicator baseReqSatisfied waitingForBaseReq={false} />);
    expect(screen.getByLabelText(/heart-rate.*satisfied/i)).toBeInTheDocument();
    expect(screen.getByTestId('base-req-dot').className).toMatch(/satisfied/);
  });

  it('renders the waiting state when waitingForBaseReq is true', () => {
    render(<CycleBaseReqIndicator baseReqSatisfied={false} waitingForBaseReq />);
    expect(screen.getByLabelText(/waiting.*heart-rate/i)).toBeInTheDocument();
    expect(screen.getByTestId('base-req-dot').className).toMatch(/waiting/);
  });

  it('renders the inactive state when neither flag is true', () => {
    render(<CycleBaseReqIndicator baseReqSatisfied={false} waitingForBaseReq={false} />);
    expect(screen.getByTestId('base-req-dot').className).toMatch(/inactive/);
  });
});
