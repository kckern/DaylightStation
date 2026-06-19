import { useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * WebViewRenderer — full-screen iframe fallback for `webview`-format stream
 * content (e.g. an embed page that can't be proxied to a direct video URL).
 *
 * Implements the Playable Contract: renders into the player content area and
 * supports keyboard clear (Escape/Backspace) to exit back to the menu.
 */
export default function WebViewRenderer({ initialData = {}, clear }) {
  const url = initialData.mediaUrl;
  const logger = useMemo(() => getLogger().child({ component: 'webview-renderer' }), []);

  useEffect(() => {
    logger.info('webview.mounted', { url });
    return () => logger.info('webview.unmounted', { url });
  }, [logger, url]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Backspace') clear?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear]);

  if (!url) return null;

  return (
    <div className="webview-renderer" style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <iframe
        title={initialData.title || 'stream'}
        src={url}
        allow="autoplay; fullscreen; encrypted-media"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}

WebViewRenderer.propTypes = { initialData: PropTypes.object, clear: PropTypes.func };
