// frontend/src/screen-framework/widgets/ArtMode.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './ArtMode.css';

/**
 * ArtMode — screensaver widget showing a matted, framed classic painting.
 *
 * Layers (bottom → top): rag-paper matte → recessed painting (whole image,
 * never cropped) with a beveled mat window + cast shadow → frame.png overlay →
 * engraved brass nameplate. Fetches a random artwork from /api/v1/art/featured.
 *
 * Props (from screen YAML / screensaver config):
 *   placard: boolean   show the engraved title/artist/year nameplate (default true)
 */
function ArtMode({ placard = true }) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const logger = useMemo(() => getChildLogger({ widget: 'art' }), []);
  const frameSrc = useMemo(() => DaylightMediaPath('media/img/ui/frame.png'), []);

  useEffect(() => {
    let cancelled = false;
    logger.info('artmode.mount', { placard });
    DaylightAPI('api/v1/art/featured')
      .then((data) => {
        if (cancelled) return;
        setArt(data);
        logger.info('artmode.loaded', { title: data?.meta?.title ?? null, artist: data?.meta?.artist ?? null });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed(true);
        logger.error('artmode.load-failed', { error: err.message });
      });
    return () => { cancelled = true; };
  }, [logger]);

  const caption = useMemo(() => {
    if (!art?.meta) return null;
    const { title, artist, date } = art.meta;
    return { title: title || null, artist: artist || null, date: date || null };
  }, [art]);

  return (
    <div className="artmode" data-testid="artmode">
      <div className="artmode__matte" aria-hidden="true" />
      <div className="artmode__opening">
        {art?.image && !failed && (
          <div className="artmode__window">
            <img
              className="artmode__image"
              data-testid="artmode-image"
              src={DaylightMediaPath(art.image)}
              alt={caption?.title || 'Artwork'}
            />
          </div>
        )}
      </div>
      <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
      {placard && caption && (caption.title || caption.artist) && (
        <div className="artmode__placard" data-testid="artmode-placard">
          {caption.title && <span className="artmode__placard-title">{caption.title}</span>}
          {(caption.artist || caption.date) && (
            <span className="artmode__placard-artist">
              {[caption.artist, caption.date].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default ArtMode;
