import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AudioCourseTile from './AudioCourseTile.jsx';

describe('AudioCourseTile', () => {
  it('renders the title and the works/chapters meta', () => {
    render(
      <AudioCourseTile
        item={{ id: 'a1', title: 'I Survived', poster: '/art.jpg', kind: 'collection', unitCount: 12 }}
        onOpen={() => {}}
      />
    );
    expect(screen.getByText('I Survived')).toBeTruthy();
    expect(screen.getByText('12 works')).toBeTruthy();
  });

  it('renders chapters meta for non-collection kinds', () => {
    render(
      <AudioCourseTile
        item={{ id: 'a2', title: 'Big History', poster: '/art.jpg', kind: 'audiobook', unitCount: 8 }}
        onOpen={() => {}}
      />
    );
    expect(screen.getByText('8 chapters')).toBeTruthy();
  });

  it('calls onOpen with the item when clicked', () => {
    const onOpen = vi.fn();
    const item = { id: 'a1', title: 'I Survived', poster: '/art.jpg', kind: 'collection', unitCount: 12 };
    render(<AudioCourseTile item={item} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(item);
  });
});
