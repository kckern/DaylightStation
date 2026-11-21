import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { ReadalongScroller } from './ReadalongScroller.jsx';
import { SingalongScroller } from './SingalongScroller.jsx';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('./ContentScroller.jsx', () => ({
  default: ({ title, mainMediaUrl }) => <><h2>{title}</h2><audio src={mainMediaUrl} /></>,
}));

const descriptor = (title, name) => ({ title, mediaUrl: `/media/${name}.mp3` });

describe.each([
  {
    format: 'readalong', Scroller: ReadalongScroller,
    oldId: 'readalong:poetry/17', oldPath: 'readalong/poetry/17', newId: 'poetry/21', newPath: 'poetry/21',
  },
  {
    format: 'singalong', Scroller: SingalongScroller,
    oldId: 'singalong:hymn/17', oldPath: 'singalong/hymn/17', newId: 'hymn/21', newPath: 'hymn/21',
  },
])('$format renderer content ownership', ({ Scroller, oldId, oldPath, newId, newPath }) => {
  beforeEach(() => DaylightAPI.mockReset());
  afterEach(cleanup);

  it('renders only the current fallback descriptor when old requests resolve late', async () => {
    const outgoing = Promise.withResolvers();
    const current = Promise.withResolvers();
    DaylightAPI.mockImplementation(path => path === `api/v1/info/${oldPath}` ? outgoing.promise : current.promise);
    const { container, rerender } = render(<Scroller contentId={oldId} />);
    await waitFor(() => expect(DaylightAPI.mock.calls[0]?.[0]).toBe(`api/v1/info/${oldPath}`));

    rerender(<Scroller contentId={newId} />);
    await waitFor(() => expect(DaylightAPI.mock.calls[1]?.[0]).toBe(`api/v1/info/${newPath}`));
    await act(async () => current.resolve(descriptor('Current item', 'current')));
    expect(screen.getByRole('heading', { name: 'Current item' })).toBeVisible();

    await act(async () => outgoing.resolve(descriptor('Retired item', 'retired')));
    expect(screen.getByRole('heading', { name: 'Current item' })).toBeVisible();
    expect(container.querySelector('audio')).toHaveAttribute('src', '/media/current.mp3');
    expect(DaylightAPI.mock.calls[0][3].signal.aborted).toBe(true);
  });

  it('retires a pending fallback when the parent supplies the descriptor', async () => {
    const outgoing = Promise.withResolvers();
    DaylightAPI.mockReturnValue(outgoing.promise);
    const { rerender } = render(<Scroller contentId={oldId} />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));

    rerender(<Scroller contentId={oldId} initialData={descriptor('Parent item', 'parent')} />);
    expect(screen.getByRole('heading', { name: 'Parent item' })).toBeVisible();
    await act(async () => outgoing.resolve(descriptor('Fallback item', 'fallback')));

    expect(screen.getByRole('heading', { name: 'Parent item' })).toBeVisible();
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    expect(DaylightAPI.mock.calls[0][3].signal.aborted).toBe(true);
  });
});
