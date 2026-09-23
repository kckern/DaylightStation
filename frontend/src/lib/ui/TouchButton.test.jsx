import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TouchButton } from './index.js';

describe('TouchButton', () => {
  it('renders the variant class, key hint and fires onClick', () => {
    const onClick = vi.fn();
    render(<TouchButton variant="sort-gotit" keyHint="3" onClick={onClick}>Got it</TouchButton>);
    const button = screen.getByRole('button', { name: /got it/i });
    expect(button.className).toContain('ds-touch--sort-gotit');
    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });
});
