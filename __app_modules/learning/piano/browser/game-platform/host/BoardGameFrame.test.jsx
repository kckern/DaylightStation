import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BoardGameFrame from './BoardGameFrame.jsx';
import GameRail from '../chrome/GameRail.jsx';
import { PianoFullscreenProvider } from '../../PianoKiosk/PianoFullscreenContext.jsx';
import ActivePianoContext from '../../PianoKiosk/PianoConfig.jsx';

const fullscreenStore = (on) => {
  const data = on ? { 'piano.fullscreen': 'true' } : {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
};

const withKiosk = (ui, { store = fullscreenStore(false), config = null } = {}) => (
  <ActivePianoContext.Provider value={{ config: config ?? {}, pianoId: 'test', basePath: '/piano/test' }}>
    <PianoFullscreenProvider storage={store}>{ui}</PianoFullscreenProvider>
  </ActivePianoContext.Provider>
);

const railProps = {
  primary: <div>board</div>,
  rightRail: { render: ({ settingsTrigger }) => <GameRail foot={settingsTrigger}>right</GameRail> },
  settings: { rail: 'right', open: false, onOpen: vi.fn(), content: <div>settings</div> },
};

describe('BoardGameFrame', () => {
  it('arrives in full screen, with the way out beside the settings gear', () => {
    const store = fullscreenStore(false);
    const { container, getByRole, getByLabelText } = render(withKiosk(<BoardGameFrame gameId="test" {...railProps} />, { store }));
    const toggle = getByRole('button', { name: 'Full screen' });
    const cluster = container.querySelector('.pg-rail__foot .pg-rail__foot-actions');
    expect(cluster.contains(toggle)).toBe(true);
    expect(cluster.contains(getByLabelText('Settings'))).toBe(true);
    expect(container.querySelector('.piano-game-host.piano-game-host--fullscreen.piano-game-host--compact-instrument')).toBeTruthy();

    fireEvent.click(toggle);
    expect(container.querySelector('.piano-game-host--fullscreen')).toBeNull();
    // Stepping out is the game's choice, not the tablet's.
    expect(store.getItem('piano.fullscreen')).toBeNull();
  });

  it('arrives windowed when the household config turns entering off', () => {
    const config = { boardGameFullscreen: { enterOnOpen: false, keyboardHeightScale: 0.6, keyboardRange: {} } };
    const { container } = render(withKiosk(<BoardGameFrame gameId="test" {...railProps} />, { config }));
    expect(container.querySelector('.piano-game-host--fullscreen')).toBeNull();
  });

  it('shortens the keyboard by the configured scale and widens a named game\'s range only in full screen', () => {
    const config = { boardGameFullscreen: { enterOnOpen: true, keyboardHeightScale: 0.5, keyboardRange: { chess: [24, 96] } } };
    const instrument = { activeNotes: new Map(), startNote: 36, endNote: 84 };
    const { container, getByRole } = render(withKiosk(
      <BoardGameFrame gameId="chess" instrument={instrument} {...railProps} />,
      { config },
    ));
    const host = container.querySelector('.piano-game-host');
    expect(host.style.getPropertyValue('--pg-fullscreen-keyboard-scale')).toBe('0.5');
    expect(container.querySelectorAll('.piano-key')).toHaveLength(96 - 24 + 1);

    fireEvent.click(getByRole('button', { name: 'Full screen' }));
    expect(container.querySelectorAll('.piano-key')).toHaveLength(84 - 36 + 1);
  });

  it('draws no toggle outside the kiosk', () => {
    const { queryByRole } = render(
      <BoardGameFrame
        gameId="test"
        primary={<div>board</div>}
        rightRail={{ render: ({ settingsTrigger }) => <GameRail foot={settingsTrigger}>right</GameRail> }}
        settings={{ rail: 'right', open: false, onOpen: vi.fn(), content: <div>settings</div> }}
      />,
    );
    expect(queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  it('keeps semantic rails and injects settings into the selected foot', () => {
    const onOpen = vi.fn();
    const { container, getByLabelText } = render(
      <BoardGameFrame
        gameId="test"
        primary={<div>board</div>}
        leftRail={{ content: <GameRail>left</GameRail> }}
        rightRail={{ render: ({ settingsTrigger }) => <GameRail foot={settingsTrigger}>right</GameRail> }}
        status={{ message: 'Your turn', aside: 'ranked' }}
        settings={{ rail: 'right', open: false, onOpen, content: <div>settings</div> }}
      />,
    );
    expect(container.querySelector('.instrument-board-stage__rail--left').textContent).toContain('left');
    expect(container.querySelector('.instrument-board-stage__rail--right').textContent).toContain('right');
    expect(container.querySelector('.pg-status').textContent).toContain('Your turn');
    // Status is a rail-column grid item, not the old full-width bottom-row
    // footer: it must not sit inside either semantic rail (so hiding/moving
    // a rail can never take the status line with it) and there is no
    // `<footer>` element left in the stage at all.
    const status = container.querySelector('.instrument-board-stage__status');
    expect(status.closest('.instrument-board-stage__rail')).toBeFalsy();
    expect(container.querySelector('footer')).toBeFalsy();
    fireEvent.click(getByLabelText('Settings'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('owns the opening/result overlay layer and stage class without moving semantic slots', () => {
    const { container, rerender } = render(
      <BoardGameFrame gameId="test" stageClassName="game-stage" primary={<div>board</div>} opening={<div>opening</div>} />,
    );
    expect(container.querySelector('.instrument-board-stage.game-stage')).toBeTruthy();
    expect(container.querySelector('.piano-game-host__overlays').textContent).toBe('opening');
    rerender(<BoardGameFrame gameId="test" primary={<div>board</div>} result={<div>result</div>} />);
    expect(container.querySelector('.piano-game-host__overlays').textContent).toBe('result');
  });
});
