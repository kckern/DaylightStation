import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import KindSection from './KindSection.jsx';

const kind = { id: 'video', verb: 'Watch', descriptor: 'Video courses', icon: 'kind-video', token: 'video' };
function Tile({ item }) { return <li>{item.title}</li>; }

describe('KindSection', () => {
  it('renders the verb header with a count and each item via the tile', () => {
    render(<KindSection kind={kind} items={[{ id: 'v1', title: 'Big History' }]} Tile={Tile} onOpen={() => {}} />);
    expect(screen.getByText('Watch')).toBeTruthy();
    expect(screen.getByText(/Video courses.*1/)).toBeTruthy();
    expect(screen.getByText('Big History')).toBeTruthy();
  });
  it('renders nothing when items is empty', () => {
    const { container } = render(<KindSection kind={kind} items={[]} Tile={Tile} onOpen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
