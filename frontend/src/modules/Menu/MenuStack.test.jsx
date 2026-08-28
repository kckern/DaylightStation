import { render, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { MenuNavigationProvider } from '../../context/MenuNavigationContext.jsx';
import { ScreenOverlayProvider } from '../../screen-framework/overlays/ScreenOverlayProvider.jsx';
import MenuStack from './MenuStack.jsx';

// Mock the heavy list-fetching menu view and Plex router — this test only
// exercises the selection -> Player prop mapping, not menu rendering.
// TVMenu exposes two buttons that fire onSelect with the shape
// listConfigNormalizer.mjs actually produces for a YAML item carrying a
// sibling `shader:` field (§ normalizeListItem: `result.shader = item.shader`
// sits alongside `result.play`/`result.queue`, NOT nested inside them).
vi.mock('./Menu', () => ({
  TVMenu: (props) => (
    <div>
      <button
        data-testid="select-queue-with-shader"
        onClick={() => props.onSelect({
          title: 'Queued item',
          queue: { contentId: 'plex:663146' },
          shader: 'minimal',
        })}
      />
      <button
        data-testid="select-play-with-shader"
        onClick={() => props.onSelect({
          title: 'Played item',
          play: { contentId: 'plex:663147' },
          shader: 'dark',
        })}
      />
    </div>
  ),
  KeypadMenu: () => null,
}));

vi.mock('./PlexMenuRouter', () => ({
  PlexMenuRouter: () => null,
}));

vi.mock('../Surround/SurroundHost.jsx', () => ({
  default: ({ children }) => <>{children}</>,
}));

// Player.jsx is imported both as PlayerOverlayLoading (named, eager) and as
// the lazy-loaded default. Mock the whole module so both resolve.
vi.mock('../Player/Player', () => ({
  __esModule: true,
  default: React.forwardRef(function MockPlayer(props, ref) {
    return (
      <div
        ref={ref}
        data-testid="player"
        data-play={typeof props.play === 'object' ? JSON.stringify(props.play) : props.play ?? ''}
        data-queue={typeof props.queue === 'object' ? JSON.stringify(props.queue) : props.queue ?? ''}
      />
    );
  }),
  PlayerOverlayLoading: () => <div data-testid="loading" />,
}));

function renderStack() {
  return render(
    <MenuNavigationProvider>
      <ScreenOverlayProvider>
        <MenuStack rootMenu="test-menu" />
      </ScreenOverlayProvider>
    </MenuNavigationProvider>
  );
}

describe('MenuStack selection -> Player prop mapping', () => {
  it('threads a sibling shader field into the queue content object Player reads', async () => {
    const { getByTestId, findByTestId } = renderStack();

    act(() => {
      getByTestId('select-queue-with-shader').click();
    });

    const player = await findByTestId('player');
    const queue = JSON.parse(player.dataset.queue);
    expect(queue.shader).toBe('minimal');
    expect(queue.contentId).toBe('plex:663146');
  });

  it('threads a sibling shader field into the play content object Player reads', async () => {
    const { getByTestId, findByTestId } = renderStack();

    act(() => {
      getByTestId('select-play-with-shader').click();
    });

    const player = await findByTestId('player');
    const play = JSON.parse(player.dataset.play);
    expect(play.shader).toBe('dark');
    expect(play.contentId).toBe('plex:663147');
  });
});
