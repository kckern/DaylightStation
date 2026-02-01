// frontend/src/modules/AppContainer/Apps/Art/Art.jsx
import { useState, useEffect, useCallback } from "react";
import "./Art.scss";
import { DaylightAPI } from "../../../../lib/api.mjs";

export default function ArtApp({ deviceId }) {
  const [current, setCurrent] = useState(null);
  const [next, setNext] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [error, setError] = useState(null);

  // Fetch current art
  const fetchCurrent = useCallback(async () => {
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
  }, [deviceId, current]);

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
