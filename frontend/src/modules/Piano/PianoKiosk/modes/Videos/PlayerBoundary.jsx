// PlayerBoundary.jsx
import { Component } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';

/** Error boundary so a Player failure drops back to the list, not a blank kiosk. */
export default class PlayerBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    getLogger().child({ component: 'piano-videos' }).error('player.crash', { error: error?.message });
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="piano-mode__placeholder">
          Playback failed. <button type="button" onClick={this.props.onBack}>Back to videos</button>
        </div>
      );
    }
    return this.props.children;
  }
}
