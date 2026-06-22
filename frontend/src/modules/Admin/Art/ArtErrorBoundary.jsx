import React from 'react';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'admin-art-library' });

// Catches render/runtime throws in the Library so a bug logs a full stack
// server-side (art.render.crash) and shows a dismissable message instead of
// white-screening the whole admin app.
export default class ArtErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    logger.error('art.render.crash', {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      componentStack: info?.componentStack ?? null,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="art-library__crash" role="alert">
          <strong>The Library hit a render error (logged).</strong>
          <pre>{String(this.state.error?.message ?? this.state.error)}</pre>
          <button type="button" onClick={this.reset}>Dismiss</button>
        </div>
      );
    }
    return this.props.children;
  }
}
