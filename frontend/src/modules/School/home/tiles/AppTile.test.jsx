import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AppTile from './AppTile.jsx';

describe('AppTile', () => {
  it('renders the label and blurb', () => {
    render(<AppTile item={{ id: 'typing', label: 'Typing', hint: 'Practice touch typing' }} onOpen={() => {}} />);
    expect(screen.getByText('Typing')).toBeTruthy();
    expect(screen.getByText('Practice touch typing')).toBeTruthy();
  });

  it('calls onOpen with the item when clicked', () => {
    const onOpen = vi.fn();
    const item = { id: 'typing', label: 'Typing', hint: 'Practice touch typing' };
    render(<AppTile item={item} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(item);
  });
});
