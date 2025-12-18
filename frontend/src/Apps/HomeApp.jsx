import { useMemo } from 'react'
import './HomeApp.scss'

import { getChildLogger } from '../lib/logging/singleton.js'

/**
 * HomeApp - Personal home dashboard application
 * Route: /home
 * 
 * Placeholder for home-focused dashboard (distinct from office).
 */
function HomeApp() {
  const logger = useMemo(() => getChildLogger({ app: 'home' }), []);
  logger.debug('home.render');

  return (
    <div className='App home-app'>
      <div className='home-container'>
        <h1>Home</h1>
        <p>Home App - Coming Soon</p>
        {/* TODO: Add home dashboard content */}
      </div>
    </div>
  );
}

export default HomeApp
