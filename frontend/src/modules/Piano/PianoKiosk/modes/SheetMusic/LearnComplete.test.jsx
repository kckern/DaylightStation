import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LearnComplete from './LearnComplete.jsx';

describe('LearnComplete', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<LearnComplete open={false} onReplay={() => {}} onPolish={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a headline and fires Practice again / Polish it', () => {
    const onReplay = vi.fn();
    const onPolish = vi.fn();
    render(<LearnComplete open onReplay={onReplay} onPolish={onPolish} />);
    expect(screen.getByRole('dialog', { name: /complete/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /practice again/i }));
    expect(onReplay).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /polish it/i }));
    expect(onPolish).toHaveBeenCalled();
  });
});
