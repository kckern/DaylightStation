import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BoardGameFrame from './BoardGameFrame.jsx';
import GameRail from '../chrome/GameRail.jsx';

describe('BoardGameFrame', () => {
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
