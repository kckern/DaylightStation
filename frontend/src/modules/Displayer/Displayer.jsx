// frontend/src/modules/Displayer/Displayer.jsx
import { useState, useEffect, useMemo } from "react";
import { useApiResource } from "../../lib/hooks/useApiResource.js";
import getLogger from "../../lib/logging/Logger.js";
import { resolveImageSrc } from "./resolveImageSrc.js";
import "./Displayer.scss";

// Mode components (inline for now — extract to modes/ if they grow)
function DefaultMode({ data, src }) {
  return (
    <div className="displayer__default">
      <img src={src} alt={data.title || ''} />
    </div>
  );
}

function ArtMode({ data, frame, src }) {
  const [showOverlay, setShowOverlay] = useState(false);
  const frameClass = `displayer__frame displayer__frame--${frame || 'classic'}`;

  return (
    <div className={frameClass} onClick={() => setShowOverlay(prev => !prev)}>
      <div className="displayer__matte">
        <div className="displayer__inner-frame">
          <img src={src} alt={data.title || ""} />
        </div>
      </div>
      {showOverlay && (
        <div className="displayer__overlay">
          <h2 className="displayer__overlay-title">{data.title}</h2>
          {data.artist && <p className="displayer__overlay-artist">{data.artist}</p>}
          {data.year && <span className="displayer__overlay-year">{data.year}</span>}
        </div>
      )}
    </div>
  );
}

function PosterMode({ data, src }) {
  return (
    <div className="displayer__poster">
      <div className="displayer__poster-image">
        <img src={src} alt={data.title || ""} />
      </div>
      <div className="displayer__poster-info">
        <h2>{data.title}</h2>
        {data.artist && <p>{data.artist}</p>}
      </div>
    </div>
  );
}

function CardMode({ data, src }) {
  return (
    <div className="displayer__card">
      <div className="displayer__card-image">
        <img src={src} alt={data.title || ""} />
      </div>
      <div className="displayer__card-meta">
        <h2>{data.title}</h2>
        {data.artist && <p className="displayer__card-artist">{data.artist}</p>}
        {data.year && <span className="displayer__card-year">{data.year}</span>}
        {data.category && <span className="displayer__card-category">{data.category}</span>}
        {data.metadata?.location && <span className="displayer__card-location">{data.metadata.location}</span>}
        {data.metadata?.people?.length > 0 && (
          <span className="displayer__card-people">{data.metadata.people.map(p => typeof p === 'string' ? p : p.name).join(', ')}</span>
        )}
      </div>
    </div>
  );
}

const MODE_COMPONENTS = {
  default: DefaultMode,
  art: ArtMode,
  poster: PosterMode,
  card: CardMode,
};

const MODE_FRAME_DEFAULTS = {
  default: 'none',
  art: 'classic',
  poster: 'none',
  card: 'none',
};

export default function Displayer({ display, onClose }) {
  // A renderable payload from the caller is authoritative and needs no read.
  // Otherwise the request key follows the selected display ID.
  const providedData = resolveImageSrc(display) ? display : null;
  const displayId = typeof display?.id === 'string' ? display.id : '';
  const [source, ...rest] = displayId.split(':');
  const path = !providedData && displayId
    ? `/api/v1/info/${source}/${rest.join(':')}`
    : null;
  const { data: resolvedData, error: readError } = useApiResource(path, {
    label: `Display ${displayId || 'item'}`,
    retryTransient: false,
  });
  const data = providedData || resolvedData;
  const error = readError?.message || null;
  const logger = useMemo(() => getLogger().child({ component: 'displayer' }), []);

  // Resolve mode via cascade: display.mode -> mode default
  const mode = display?.mode || 'default';

  // Resolve frame via cascade: display.frame (URL) -> data.frameStyle (item) -> mode default
  const frame = display?.frame || data?.frameStyle || MODE_FRAME_DEFAULTS[mode] || 'none';

  useEffect(() => {
    if (!readError) return;
    logger.warn('resolve.failed', { contentId: displayId, error: readError.message });
  }, [displayId, logger, readError]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (error) {
    return <div className="displayer displayer--error" role="alert">{error}</div>;
  }
  if (!data) return <div className="displayer displayer--loading">Loading...</div>;

  // The payload resolved but carries nothing an <img> can render. Say so —
  // a blank frame is indistinguishable from a slow network, and that ambiguity
  // is what let a misconfigured list item sit unnoticed on the TV.
  const src = resolveImageSrc(data);
  if (!src) {
    logger.warn('no-renderable-src', {
      contentId: display?.id,
      title: data.title,
      mediaType: data.mediaType || data.type,
      fields: Object.keys(data).join(','),
    });
    return (
      <div className="displayer displayer--error" role="alert">
        {`No displayable image for "${data.title || display?.id}" — `}
        {`${display?.id || 'this item'} resolved, but returned no image URL. `}
        {'Its source may not support Display.'}
      </div>
    );
  }

  const ModeComponent = MODE_COMPONENTS[mode] || DefaultMode;

  return (
    <div className={`displayer displayer--${mode}`}>
      <ModeComponent data={data} frame={frame} src={src} />
    </div>
  );
}
