import React, { useMemo, useEffect } from 'react';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import './MediaApp.scss';

const MediaApp = () => {
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);

  useEffect(() => {
    configureLogger({ context: { app: 'media' } });
    logger.info('media-app.mounted');
    return () => {
      configureLogger({ context: {} });
      logger.info('media-app.unmounted');
    };
  }, [logger]);

  return (
    <div className="App media-app">
      <div className="media-app-container">
        <div className="media-now-playing">
          <h2>MediaApp</h2>
          <p>Phase 1 — Player coming soon</p>
        </div>
      </div>
    </div>
  );
};

export default MediaApp;
