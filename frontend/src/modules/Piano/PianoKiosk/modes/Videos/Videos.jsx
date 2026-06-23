import { useMemo, useState, useEffect, Suspense, lazy, Component } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';

// Player is heavy — code-split it so the menu/other modes don't pay for it.
const Player = lazy(() => import('../../../../Player/Player.jsx'));

/** Minimal error boundary so a Player failure drops back to the list, not a blank kiosk. */
class PlayerBoundary extends Component {
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

/**
 * Videos mode — passive lessons/lectures from a configured Plex collection.
 * Lists the collection's items; tapping one plays it via the shared Player.
 * Collection id comes from piano config `videos.plexCollection` (a Plex
 * collection ratingKey, optionally `plex:`-prefixed).
 */
export function Videos() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { config, loading } = usePianoKioskConfig();
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const collection = config.videos.plexCollection;

  useEffect(() => {
    if (loading) return undefined; // wait for config
    let cancelled = false;
    (async () => {
      try {
        if (!collection) { if (!cancelled) { setItems([]); setError('No videos.plexCollection configured.'); } return; }
        const ratingKey = String(collection).replace(/^plex:/, '');
        logger.info('piano.videos-load', { ratingKey });
        const list = await DaylightAPI(`api/v1/list/plex/${ratingKey}`);
        if (!cancelled) setItems(list?.items ?? []);
      } catch (err) {
        if (!cancelled) { setItems([]); setError(err.message); }
        logger.warn('piano.videos-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, loading, collection]);

  const play = (item) => {
    logger.info('piano.video-play', { contentId: item.id });
    setSelected(item);
  };
  const back = () => setSelected(null);

  if (selected) {
    return (
      <div className="piano-video-player">
        <button type="button" className="piano-game-fullscreen__back" onClick={back}>‹ Videos</button>
        <PlayerBoundary onBack={back}>
          <Suspense fallback={<div className="piano-mode__placeholder">Loading…</div>}>
            <Player play={{ contentId: selected.id }} clear={back} />
          </Suspense>
        </PlayerBoundary>
      </div>
    );
  }

  return (
    <section className="piano-mode piano-mode--videos">
      <h2>Videos</h2>
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && (
        <p className="piano-mode__placeholder">{error || 'No videos found.'}</p>
      )}
      {items?.length > 0 && (
        <ul className="piano-video-grid">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="piano-video-grid__tile" onClick={() => play(item)}>
                {(item.thumbnail || item.image) && (
                  <img src={item.thumbnail || item.image} alt="" loading="lazy" />
                )}
                <span className="piano-video-grid__title">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default Videos;
