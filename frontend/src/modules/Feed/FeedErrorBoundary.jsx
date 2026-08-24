import { Component } from 'react';
import getLogger from '../../lib/logging/Logger.js';

const log = getLogger().child({ app: 'feed', module: 'error-boundary' });

export default class FeedErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    log.error('feed.view.render_failed', {
      error: error?.message || String(error),
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="feed-error" role="alert">
        <h1>This view couldn’t load</h1>
        <p>Your reading state is safe. Try the view again, or reload if the problem continues.</p>
        <div className="feed-error__actions">
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" onClick={() => window.location.reload()}>Reload Feed</button>
        </div>
      </section>
    );
  }
}
