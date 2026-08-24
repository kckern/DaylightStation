import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SourcePanel } from './SourcePanel.jsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

const source = {
  id: 'daily',
  label: 'Daily News',
  siteUrl: 'https://daily.example',
  items: [{ id: 'story-1', title: 'A useful headline', link: 'https://daily.example/story', desc: 'Story context' }],
};

describe('SourcePanel', () => {
  test('keeps source navigation and refresh as separate controls', () => {
    render(<SourcePanel source={source} col={0} totalCols={1} onRefresh={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Daily News' })).toHaveAttribute('href', 'https://daily.example');
    expect(screen.getByRole('button', { name: 'Refresh Daily News' }).closest('a')).toBeNull();
  });

  test('mounts preview content only while the story is focused', () => {
    const { container } = render(<SourcePanel source={source} col={0} totalCols={1} onRefresh={vi.fn()} />);
    expect(container.querySelector('.headline-tooltip')).toBeNull();

    fireEvent.focus(screen.getByRole('link', { name: 'A useful headline' }));
    expect(container.querySelector('.headline-tooltip')).toHaveTextContent('Story context');

    fireEvent.blur(screen.getByRole('link', { name: 'A useful headline' }), { relatedTarget: null });
    expect(container.querySelector('.headline-tooltip')).toBeNull();
  });
});
