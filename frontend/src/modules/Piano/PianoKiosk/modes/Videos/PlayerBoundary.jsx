// PlayerBoundary.jsx
import { Component } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { autoReport } from '../../../../Feedback/autoReport.js';

/** Error boundary so a Player failure drops back to the list, not a blank kiosk. */
export default class PlayerBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) {
    getLogger().child({ component: 'piano-videos' }).error('player.crash', { error: error?.message });
    // The child in front of this screen sees "Playback failed" and a Back
    // button; nobody else learns anything unless the kiosk says so itself. The
    // report carries the last 150 client log events, which is the evidence that
    // otherwise rotates away before anyone comes looking.
    autoReport({
      app: 'piano',
      reason: 'error-boundary',
      dedupeKey: 'piano-videos-player',
      detail: {
        error: error?.message ?? String(error),
        stack: typeof error?.stack === 'string' ? error.stack.slice(0, 2000) : null,
        componentStack: typeof info?.componentStack === 'string' ? info.componentStack.slice(0, 2000) : null,
      },
    });
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
