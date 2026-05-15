import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResumeCard } from './ResumeCard.jsx';
import { RecentsRow } from './RecentsRow.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { recordRecent } from '../session/recents.js';
import { NavProvider } from '../shell/NavProvider.jsx';

const queueMock = { playNow: vi.fn(), playNext: vi.fn(), add: vi.fn(), addUpNext: vi.fn() };
const transportMock = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() };

function wrap(children, snapshot) {
  const adapter = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    transport: transportMock, queue: queueMock, config: {}, lifecycle: {}, portability: {},
  };
  return (
    <LocalSessionContext.Provider value={{ adapter }}>
      <NavProvider>{children}</NavProvider>
    </LocalSessionContext.Provider>
  );
}

const pausedSnapshot = {
  state: 'paused',
  position: 320,
  currentItem: { contentId: 'plex:42', title: 'Cosmos', thumbnail: null, duration: 3600 },
  queue: { items: [], currentIndex: -1, upNextCount: 0 },
  config: {},
  meta: { updatedAt: '', ownerId: 't' },
};

beforeEach(() => {
  Object.values(queueMock).forEach((m) => m.mockClear());
  Object.values(transportMock).forEach((m) => m.mockClear());
  localStorage.clear();
});

test('ResumeCard is rendered only when a current item exists in non-idle state', () => {
  const { rerender } = render(wrap(<ResumeCard />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  expect(screen.queryByTestId('resume-card')).not.toBeInTheDocument();
  rerender(wrap(<ResumeCard />, pausedSnapshot));
  expect(screen.getByTestId('resume-card')).toHaveTextContent('Cosmos');
});

test('ResumeCard resume button calls transport.play', () => {
  render(wrap(<ResumeCard />, pausedSnapshot));
  fireEvent.click(screen.getByTestId('resume-play'));
  expect(transportMock.play).toHaveBeenCalledTimes(1);
});

test('RecentsRow renders recorded items', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  recordRecent({ contentId: 'plex:2', title: 'B', thumbnail: null });
  render(wrap(<RecentsRow />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  expect(screen.getByTestId('recents-row')).toBeInTheDocument();
  expect(screen.getByTestId('recent-plex:1')).toHaveTextContent('A');
  expect(screen.getByTestId('recent-plex:2')).toHaveTextContent('B');
});

test('RecentsRow clicking a recent calls queue.playNow', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  render(wrap(<RecentsRow />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  fireEvent.click(screen.getByTestId('recent-plex:1'));
  expect(queueMock.playNow).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:1' }), { clearRest: true });
});

test('RecentsRow is hidden when there are no recents', () => {
  render(wrap(<RecentsRow />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  expect(screen.queryByTestId('recents-row')).not.toBeInTheDocument();
});
