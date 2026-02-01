// frontend/src/modules/AppContainer/Apps/Art/Art.jsx
import { useState, useEffect, useCallback } from "react";
import "./Art.scss";
import { DaylightAPI } from "../../../../lib/api.mjs";

export default function ArtApp({ deviceId, item, onClose }) {
  const [current, setCurrent] = useState(null);
  const [next, setNext] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [error, setError] = useState(null);

  // Fetch current art (deviceId mode only)
  const fetchCurrent = useCallback(async () => {
    if (item) return; // Skip fetch if item provided directly

    try {
      const response = await DaylightAPI(`/canvas/current?deviceId=${deviceId}`);
      if (response.ok) {
        const data = await response.json();
        if (current && data.id !== current.id) {
          // Transition to new art
          setNext(data);
          setTransitioning(true);
          setTimeout(() => {
            setCurrent(data);
            setNext(null);
            setTransitioning(false);
          }, 1000);
        } else if (!current) {
          setCurrent(data);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [deviceId, current, item]);

  // Initial fetch and polling
  useEffect(() => {
    fetchCurrent();
    const interval = setInterval(fetchCurrent, 30000);
    return () => clearInterval(interval);
  }, [fetchCurrent]);

  // Preload next image
  useEffect(() => {
    if (next?.imageUrl) {
      const img = new Image();
      img.src = next.imageUrl;
    }
  }, [next]);

  // Fetch item by ID if item.id provided (display= mode)
  useEffect(() => {
    if (item?.id && !current) {
      const fetchItem = async () => {
        try {
          const [source, ...rest] = item.id.split(':');
          const localId = rest.join(':');
          const data = await DaylightAPI(`api/v1/content/item/${source}/${localId}`);
          setCurrent(data);
        } catch (err) {
          setError(err.message);
        }
      };
      fetchItem();
    }
  }, [item, current]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Handle overlay toggle
  const toggleOverlay = useCallback(() => {
    setShowOverlay(prev => !prev);
  }, []);

  if (error) {
    return <div className="art-app art-error">{error}</div>;
  }

  if (!current) {
    return <div className="art-app art-loading">Loading...</div>;
  }

  const frameClass = `art-frame art-frame--${current.frameStyle || 'classic'}`;

  return (
    <div className="art-app" onClick={toggleOverlay}>
      <div className={frameClass}>
        <div className="art-matte">
          <div className="art-inner-frame">
            <img
              src={current.imageUrl}
              alt={current.title}
              className={transitioning ? 'fading-out' : ''}
            />
            {next && transitioning && (
              <img
                src={next.imageUrl}
                alt={next.title}
                className="fading-in"
              />
            )}
          </div>
        </div>
      </div>

      {showOverlay && (
        <div className="art-overlay">
          <h2 className="art-overlay__title">{current.title}</h2>
          {current.artist && (
            <p className="art-overlay__artist">{current.artist}</p>
          )}
          {current.year && (
            <span className="art-overlay__year">{current.year}</span>
          )}
        </div>
      )}
    </div>
  );
}
