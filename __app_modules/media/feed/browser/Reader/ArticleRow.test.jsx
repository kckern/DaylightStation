import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ArticleRow from "./ArticleRow.jsx";

vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: vi.fn().mockResolvedValue({ annotations: [] }) }));

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
    expect(onMarkRead).toHaveBeenCalledWith(article);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onStateAction).toHaveBeenCalledWith(article, 'save');
  });

  test('links only http(s) originals; anything else stays plain text', () => {
    const base = { id: 'freshrss:2', title: 'Hostile', preview: 'x', published: '2026-08-24T12:00:00.000Z', state: {} };
    const { unmount } = render(<ArticleRow article={{ ...base, link: 'javascript:alert(1)' }} onMarkRead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /hostile/i }));
    expect(screen.queryByRole('link', { name: /open original/i })).toBeNull();
    unmount();

    render(<ArticleRow article={{ ...base, link: 'https://news.example/a' }} onMarkRead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /hostile/i }));
    expect(screen.getByRole('link', { name: /open original/i })).toHaveAttribute('href', 'https://news.example/a');
  });
});
