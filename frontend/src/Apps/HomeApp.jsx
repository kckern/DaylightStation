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
          {cameras.map(cam => (
            <div key={cam.id} className="home-cameras__card">
              <div className="home-cameras__header">
                <span className="home-cameras__label">{cam.id}</span>
              </div>
              <CameraFeed cameraId={cam.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomeApp;
