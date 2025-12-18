import { useState, useCallback, useMemo } from 'react'
import './RootApp.scss'

import { KeypadMenu } from '../modules/Menu/Menu'
import { getChildLogger } from '../lib/logging/singleton.js'

/**
 * RootApp - Main menu/launcher application
 * Route: /
 * 
 * This is the entry point app that provides a menu to navigate
 * to other applications in the system.
 */
function RootApp() {
  const logger = useMemo(() => getChildLogger({ app: 'root' }), []);
  logger.debug('root.render');

  const [menuSelection, setMenuSelection] = useState(null);

  const handleMenuSelection = useCallback((selection) => {
    logger.info('root.menu.selection', { selection });
    setMenuSelection(selection);
  }, [logger]);

  return (
    <div className='App root-app'>
      <div className='root-menu-container'>
        <h1>Daylight Station</h1>
        <p>Menu App - Coming Soon</p>
        {/* TODO: Add main navigation menu */}
      </div>
    </div>
  );
}

export default RootApp
