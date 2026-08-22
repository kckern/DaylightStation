// frontend/src/modules/Media/browse/HomeView.test.jsx
// Task 16 (spec D7): Home used to render Resume/Recents PLUS a config-driven
// grid of "Browse X" cards that duplicate the Browse tab one thumb-tap below
// in the bottom nav, pushing Recent off the fold on a 360px phone. This suite
// pins Home down to Resume + Recent only — no card grid, no config fetch for
// one.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    controller: {},
    snapshot: null,
    transport: {},
    queue: { playNow: vi.fn() },
  }),
}));
vi.mock('../controller/usePlaybackPosition.js', () => ({
  usePlaybackPosition: () => ({ seconds: 0 }),
}));

import { HomeView } from './HomeView.jsx';

function renderHome() {
  return render(
    <MantineProvider>
      <HomeView />
    </MantineProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
});

describe('HomeView (Task 16 — Recent leads)', () => {
  it('never fetches the browse-card config — the card grid is gone, not just hidden', () => {
    renderHome();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('renders no "Browse" card grid or category cards', () => {
    renderHome();
    expect(screen.queryByTestId('home-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-error')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Browse$/)).not.toBeInTheDocument();
    expect(document.querySelector('.home-card')).toBeNull();
  });

  it('leads with Recent — it renders above the fold with no card grid pushing it down', () => {
    renderHome();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByTestId('home-recents-empty')).toBeInTheDocument();
  });
});
