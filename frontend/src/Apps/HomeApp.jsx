import { useMemo, useState, useEffect } from 'react';
import './HomeApp.scss';
import { getChildLogger } from '../lib/logging/singleton.js';
import CameraFeed from '../modules/CameraFeed/CameraFeed.jsx';

function HomeApp() {
  const logger = useMemo(() => getChildLogger({ app: 'home' }), []);
  const [cameras, setCameras] = useState([]);

  useEffect(() => {
    fetch('/api/v1/camera')
      .then(r => r.json())
      .then(data => {
        setCameras(data.cameras || []);
        logger.info('home.cameras.loaded', { count: data.cameras?.length });
      })
      .catch(err => logger.error('home.cameras.fetchError', { error: err.message }));
  }, [logger]);

  return (
    <div className="App home-app">
      <div className="home-container">
        <h1>Home</h1>
        <div className="home-cameras">
          {cameras
            .slice()
            .sort((a, b) => {
              // doorbell first, then alphabetical
              if (a.id === 'doorbell') return -1;
              if (b.id === 'doorbell') return 1;
              return a.id.localeCompare(b.id);
            })
            .map(cam => (
            <div key={cam.id} className="home-cameras__card">
              <CameraFeed
                cameraId={cam.id}
                renderHeader={(onFullscreen) => (
                  <div className="home-cameras__header">
                    <span className="home-cameras__label">{cam.id}</span>
                    <button className="home-cameras__fullscreen" onClick={onFullscreen} title="Fullscreen">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M1 1h5V0H0v6h1V1zm14 0h-5V0h6v6h-1V1zM1 15h5v1H0v-6h1v5zm14 0h-5v1h6v-6h-1v5z"/>
                      </svg>
                    </button>
                  </div>
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomeApp;
