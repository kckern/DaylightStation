import { useMemo, useState, useEffect } from 'react';
import './HomeApp.scss';
import { getChildLogger } from '../lib/logging/singleton.js';
import CameraFeed from '../modules/CameraFeed/CameraFeed.jsx';

function HomeApp() {
  const logger = useMemo(() => getChildLogger({ app: 'home' }), []);
  const [cameras, setCameras] = useState([]);
  const [liveCameras, setLiveCameras] = useState(new Set());

  useEffect(() => {
    fetch('/api/v1/camera')
      .then(r => r.json())
      .then(data => {
        setCameras(data.cameras || []);
        logger.info('home.cameras.loaded', { count: data.cameras?.length });
      })
      .catch(err => logger.error('home.cameras.fetchError', { error: err.message }));
  }, [logger]);

  const toggleLive = (id) => {
    setLiveCameras(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="App home-app">
      <div className="home-container">
        <h1>Home</h1>
        <div className="home-cameras">
          {cameras.map(cam => (
            <div key={cam.id} className="home-cameras__card">
              <div className="home-cameras__header">
                <span className="home-cameras__label">{cam.id}</span>
                {cam.capabilities.includes('live') && (
                  <button
                    className={`home-cameras__toggle ${liveCameras.has(cam.id) ? 'active' : ''}`}
                    onClick={() => toggleLive(cam.id)}
                  >
                    {liveCameras.has(cam.id) ? 'Stop' : 'Live'}
                  </button>
                )}
              </div>
              <CameraFeed
                cameraId={cam.id}
                mode={liveCameras.has(cam.id) ? 'live' : 'snapshot'}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomeApp;
