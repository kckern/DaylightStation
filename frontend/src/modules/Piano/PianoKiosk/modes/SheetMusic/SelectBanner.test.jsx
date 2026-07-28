import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SelectBanner from './SelectBanner.jsx';

describe('SelectBanner', () => {
  it('renders nothing without a stage', () => {
    const { container } = render(<SelectBanner onCancel={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a rejection message when a tap missed every note', () => {
    render(<SelectBanner stage="first" rejects={1} onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/closer to a note/i);
  });

  it('reverts to the instruction when no rejection has happened', () => {
    render(<SelectBanner stage="first" rejects={0} onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/FIRST measure/i);
  });
});
