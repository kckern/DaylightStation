import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LaunchPreviewAction from './LaunchPreviewAction.jsx';

vi.mock('../teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: {
    launchPreviewUrl: (learnerId, subject) => `/preview-start/${learnerId}?subject=${subject}`,
  },
}));

describe('LaunchPreviewAction', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('opens the server redirect synchronously in a reusable popup', () => {
    const popup = { focus: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<LaunchPreviewAction learnerId="user_4" subject="science" />);

    fireEvent.click(screen.getByRole('button', { name: /preview launch card/i }));
    expect(open).toHaveBeenCalledWith(
      '/preview-start/user_4?subject=science',
      'daylight-school-launch-preview',
      expect.stringContaining('popup'),
    );
    expect(popup.focus).toHaveBeenCalled();
  });

  it('offers a normal new-tab link when the browser blocks the popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<LaunchPreviewAction learnerId="user_4" subject="science" />);
    fireEvent.click(screen.getByRole('button', { name: /preview launch card/i }));
    expect(screen.getByRole('link', { name: /pop-up blocked/i }))
      .toHaveAttribute('href', '/preview-start/user_4?subject=science');
  });
});
