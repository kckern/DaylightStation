// frontend/src/modules/Displayer/Displayer.jsx
import { useState, useEffect, useCallback } from "react";
import { DaylightAPI } from "../../lib/api.mjs";
import "./Displayer.scss";

// Mode components (inline for now — extract to modes/ if they grow)
function DefaultMode({ data }) {
  return (
    <div className="displayer__default">
      <img src={data.imageUrl} alt={data.title || ''} />
    </div>
  );
}

function ArtMode({ data, frame }) {
  const [showOverlay, setShowOverlay] = useState(false);
  const frameClass = `displayer__frame displayer__frame--${frame || 'classic'}`;

  return (
    <div className={frameClass} onClick={() => setShowOverlay(prev => !prev)}>
      <div className="displayer__matte">
        <div className="displayer__inner-frame">
          <img src={data.imageUrl} alt={data.title || ''} />
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

function PosterMode({ data }) {
  return (
    <div className="displayer__poster">
      <div className="displayer__poster-image">
        <img src={data.imageUrl} alt={data.title || ''} />
      </div>
      <div className="displayer__poster-info">
        <h2>{data.title}</h2>
        {data.artist && <p>{data.artist}</p>}
      </div>
    </div>
  );
}

function CardMode({ data }) {
  return (
    <div className="displayer__card">
      <div className="displayer__card-image">
        <img src={data.imageUrl} alt={data.title || ''} />
      </div>
      <div className="displayer__card-meta">
        <h2>{data.title}</h2>
        {data.artist && <p className="displayer__card-artist">{data.artist}</p>}
        {data.year && <span className="displayer__card-year">{data.year}</span>}
        {data.category && <span className="displayer__card-category">{data.category}</span>}
        {data.metadata?.location && <span className="displayer__card-location">{data.metadata.location}</span>}
        {data.metadata?.people?.length > 0 && (
          <span className="displayer__card-people">{data.metadata.people.join(', ')}</span>
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
  const [data, setData] = useState(display?.imageUrl ? display : null);
  const [error, setError] = useState(null);

  // Resolve mode via cascade: display.mode -> mode default
  const mode = display?.mode || 'default';

  // Resolve frame via cascade: display.frame (URL) -> data.frameStyle (item) -> mode default
  const frame = display?.frame || data?.frameStyle || MODE_FRAME_DEFAULTS[mode] || 'none';

  // Fetch if only ID provided
  useEffect(() => {
    if (data?.imageUrl) return; // Already hydrated
    if (!display?.id) return;

    const fetchItem = async () => {
      try {
        const [source, ...rest] = display.id.split(':');
        const localId = rest.join(':');
        const result = await DaylightAPI(`/api/v1/info/${source}/${localId}`);
        setData(result);
      } catch (err) {
        setError(err.message);
      }
    };
    fetchItem();
  }, [display?.id, data?.imageUrl]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (error) return <div className="displayer displayer--error">{error}</div>;
  if (!data) return <div className="displayer displayer--loading">Loading...</div>;

  const ModeComponent = MODE_COMPONENTS[mode] || DefaultMode;

  return (
    <div className={`displayer displayer--${mode}`}>
      <ModeComponent data={data} frame={frame} />
    </div>
  );
}
