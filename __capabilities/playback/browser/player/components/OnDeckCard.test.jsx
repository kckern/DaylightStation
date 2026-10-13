import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OnDeckCard } from './OnDeckCard.jsx';

describe('OnDeckCard', () => {
  it('renders nothing when item is null', () => {
    const { container } = render(<OnDeckCard item={null} flashKey={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders thumbnail and title when item is provided', () => {
    const { getByText, getByRole } = render(
      <OnDeckCard item={{ id: 'plex:1', title: 'The Three Pigs', thumbnail: '/t.jpg' }} flashKey={0} />
    );
    expect(getByText('The Three Pigs')).toBeTruthy();
    expect(getByRole('img').getAttribute('src')).toBe('/t.jpg');
  });

  it('changes data-flash-key when flashKey prop changes', () => {
    const { container, rerender } = render(
      <OnDeckCard item={{ id: 'plex:1', title: 'A', thumbnail: '/t.jpg' }} flashKey={0} />
    );
    const card = container.querySelector('.on-deck-card');
    expect(card.getAttribute('data-flash-key')).toBe('0');
    rerender(<OnDeckCard item={{ id: 'plex:1', title: 'A', thumbnail: '/t.jpg' }} flashKey={1} />);
    expect(card.getAttribute('data-flash-key')).toBe('1');
  });
});
