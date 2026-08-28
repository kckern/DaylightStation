import { Component } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import GameButton from '../chrome/GameButton.jsx';
import './GameBoundary.scss';

/**
 * A game that throws must not take the kiosk with it.
 *
 * Nothing stood between a game's render and the app root, so any throw inside
 * any of the eight games blanked the whole screen — and on the piano tablet a
 * blank screen is not the end of it: the render watchdog sees a dead page and
 * reboots the tablet. A crash in Tetris should cost the player Tetris.
 *
 * The recovery is deliberately not "try again in place": whatever state made
 * the game throw is still there. Going back to the picker is a real reset, and
 * it is also the thing a child can do without help.
 *
 * `resetKey` clears the failure when the player moves on — to a different game,
 * or to a new match of the same one — so one crash does not leave the boundary
 * latched shut over everything after it. It is an opaque token and its shape is
 * the caller's business.
 *
 * `gameId` is separate FOR THE LOG LINE, and that separation is the point: the
 * crash event's `game` field is what saved queries filter on
 * (`data.game:"tetris"`), so it has to stay the plain game id no matter what
 * the caller composes into the reset token. Folding the two together silently
 * broke every such query the moment the token gained a match counter.
 */
export default class GameBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey === state.resetKey) return null;
    return { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error, info) {
    getLogger().child({ component: 'piano-games' }).error('game.crash', {
      game: this.props.gameId ?? this.props.resetKey ?? null,
      error: error?.message ?? String(error),
      // First frame only: the full component stack is pages long and the kiosk
      // ships these over a WebSocket.
      at: info?.componentStack?.trim().split('\n')[0] ?? null,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="pg-boundary" role="alert">
        <p className="pg-boundary__title">{this.props.label ?? 'This game'} stopped.</p>
        <p className="pg-boundary__body">Nothing else is affected — pick a game and carry on.</p>
        <GameButton variant="primary" onClick={this.props.onExit}>Back to games</GameButton>
      </div>
    );
  }
}
