import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ArticleRow from './ArticleRow.jsx';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({ annotations: [] }) }));

describe('ArticleRow', () => {
  test('exposes expansion and reversible state actions as semantic controls', () => {
    const onMarkRead = vi.fn();
    const onStateAction = vi.fn();
    const article = {
      id: 'freshrss:1',
      title: 'Accessible reading',
      preview: 'A useful summary',
      published: '2026-08-24T12:00:00.000Z',
      state: { isRead: false, isSaved: false, isArchived: false },
    };

    render(<ArticleRow article={article} isNew onMarkRead={onMarkRead} onStateAction={onStateAction} />);
    const disclosure = screen.getByRole('button', { name: /accessible reading/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('New')).toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(onMarkRead).toHaveBeenCalledWith('freshrss:1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onStateAction).toHaveBeenCalledWith(article, 'save');
  });
});
