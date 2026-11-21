import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { MenuNavigationProvider } from "../../../../../__capabilities/screen-host/browser/menu-context.mjs";
import { ScreenOverlayProvider, useScreenOverlay } from "../../../../../__capabilities/screen-host/browser/overlays/ScreenOverlayProvider.jsx";
import MenuStack from "./MenuStack.jsx";

// Mock the heavy list-fetching menu view and Plex router — this test only
// exercises the selection -> Player prop mapping, not menu rendering.
// TVMenu exposes two buttons that fire onSelect with the shape
// listConfigNormalizer.mjs actually produces for a YAML item carrying a
// sibling `shader:` field (§ normalizeListItem: `result.shader = item.shader`
// sits alongside `result.play`/`result.queue`, NOT nested inside them).
vi.mock("./Menu.jsx", () => ({
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

vi.mock("./PlexMenuRouter.jsx", () => ({
  PlexMenuRouter: () => null,
}));

vi.mock("../surround-host.mjs", () => ({
  default: ({ children }) => <>{children}</>,
}));

// Player.jsx is imported both as PlayerOverlayLoading (named, eager) and as
// the lazy-loaded default. Mock the whole module so both resolve.
vi.mock("../../../../../__capabilities/playback/browser/player/Player.jsx", () => ({
  __esModule: true,
  default: React.forwardRef(function MockPlayer(props, ref) {
    return (
      <div
        ref={ref}
        data-testid="player"
        data-play={typeof props.play === 'object' ? JSON.stringify(props.play) : props.play ?? ''}
        data-queue={typeof props.queue === 'object' ? JSON.stringify(props.queue) : props.queue ?? ''}
      >
        <button type="button" data-testid="finish-player" onClick={props.clear}>Finish</button>
      </div>
    );
  }),
  PlayerOverlayLoading: () => <div data-testid="loading" />,
}));

function OverlayControls({ ownedMenu }) {
  const { showOverlay } = useScreenOverlay();
  return <button type="button" onClick={() => {
    if (ownedMenu) showOverlay(MenuStack, { rootMenu: 'test-menu' }, { ownsNavStack: true });
    else showOverlay(() => <div data-testid="unrelated-overlay" />);
  }}>Open overlay</button>;
}

function renderStack({ ownedMenu = false } = {}) {
  return render(
    <MenuNavigationProvider>
      <ScreenOverlayProvider>
        {!ownedMenu && <MenuStack rootMenu="test-menu" />}
        <OverlayControls ownedMenu={ownedMenu} />
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

  it('returns an embedded player to its menu when it completes', async () => {
    const view = renderStack();
    act(() => view.getByTestId('select-play-with-shader').click());
    const finish = await view.findByTestId('finish-player');
    act(() => finish.click());
    expect(await view.findByTestId('select-play-with-shader')).toBeInTheDocument();
  });

  it('keeps a newer, unrelated overlay when an embedded player completes', async () => {
    const view = renderStack();
    act(() => view.getByTestId('select-play-with-shader').click());
    const finish = await view.findByTestId('finish-player');
    act(() => view.getByRole('button', { name: 'Open overlay' }).click());
    expect(view.getByTestId('unrelated-overlay')).toBeInTheDocument();
    act(() => finish.click());
    expect(await view.findByTestId('select-play-with-shader')).toBeInTheDocument();
    expect(view.getByTestId('unrelated-overlay')).toBeInTheDocument();
  });

  it('dismisses the fullscreen overlay when it owns the completing player', async () => {
    const view = renderStack({ ownedMenu: true });
    act(() => view.getByRole('button', { name: 'Open overlay' }).click());
    act(() => view.getByTestId('select-play-with-shader').click());
    const finish = await view.findByTestId('finish-player');
    act(() => finish.click());
    await waitFor(() => expect(view.queryByTestId('player')).not.toBeInTheDocument());
    expect(view.queryByTestId('select-play-with-shader')).not.toBeInTheDocument();
  });
});
