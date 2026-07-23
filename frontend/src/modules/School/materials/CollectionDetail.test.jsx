import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CollectionDetail from './CollectionDetail.jsx';

const worksMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: { materialWorks: (...a) => worksMock(...a) },
}));

const collection = { id: 'plex:619778', title: 'Shakespeare Tales', poster: '/p/c', kind: 'collection' };

beforeEach(() => {
  worksMock.mockReset().mockResolvedValue({
    ok: true, status: 200,
    data: [
      { id: 'plex:685120', title: 'Hamlet', poster: '/p/h', kind: 'work', unitCount: 5 },
      { id: 'plex:685156', title: 'Macbeth', poster: null, kind: 'work', unitCount: 5 },
    ],
  });
});

describe('CollectionDetail', () => {
  it('fetches the collection works and renders each as a square tile', async () => {
    render(<CollectionDetail collection={collection} onOpenWork={() => {}} />);
    expect(worksMock).toHaveBeenCalledWith('plex:619778');
    expect(await screen.findByText('Hamlet')).toBeInTheDocument();
    expect(screen.getAllByText('Macbeth').length).toBeGreaterThan(0); // title + null-poster placeholder
    expect(screen.getByText('Hamlet').closest('button').className).toMatch(/--square/);
    expect(screen.getByText('2 works')).toBeInTheDocument();
  });

  it('tapping a work calls onOpenWork with that work', async () => {
    const onOpenWork = vi.fn();
    render(<CollectionDetail collection={collection} onOpenWork={onOpenWork} />);
    fireEvent.click(await screen.findByText('Hamlet'));
    expect(onOpenWork).toHaveBeenCalledWith(expect.objectContaining({ id: 'plex:685120' }));
  });

  it('renders an empty state when the collection has no works', async () => {
    worksMock.mockResolvedValue({ ok: true, status: 200, data: [] });
    render(<CollectionDetail collection={collection} onOpenWork={() => {}} />);
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
