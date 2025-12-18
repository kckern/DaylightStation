import { useEffect, useState, useCallback, useMemo } from 'react'
import './OfficeApp.scss'
import moment from 'moment'
import CryptoJS from 'crypto-js'

import Clock from '../modules/Time/Time'
import WeatherForecast from '../modules/Weather/WeatherForecast'
import Weather from '../modules/Weather/Weather'
import Upcoming from '../modules/Upcoming/Upcoming'
import Health from '../modules/Health/Health'
import { FinanceChart } from '../modules/Finance/Finance'

import Player from '../modules/Player/Player'
import {KeypadMenu} from '../modules/Menu/Menu'
import AppContainer from '../modules/AppContainer/AppContainer'
import ConnectionStatus from '../components/ConnectionStatus/ConnectionStatus'

import { DaylightAPI } from '../lib/api.mjs'
import { useWebSocket } from '../contexts/WebSocketContext.jsx'
import { createWebSocketHandler } from '../lib/OfficeApp/websocketHandler.js'
import { useKeyboardHandler } from '../lib/OfficeApp/keyboardHandler.js'
import { createMenuSelectionHandler } from '../lib/OfficeApp/menuHandler.js'
import { getChildLogger } from '../lib/logging/singleton.js'

function OfficeApp() {
  const logger = useMemo(() => getChildLogger({ app: 'office' }), []);
  logger.debug('office.render');
  
  const [queue, setQueue] = useState([])
  const [menu, setMenu] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuKey, setMenuKey] = useState(0)
  const [currentContent, setCurrentContent] = useState(null)
  const [keyMap, setKeyMap] = useState(null)
  const [lastPayloadMessage, setLastPayloadMessage] = useState(null)
  const [weatherData, setWeatherData] = useState(null)
  const [shaderOpacity, setShaderOpacity] = useState(0)

  // Keep playbackKeys separate so we can be sure to check it is never undefined
  const [playbackKeys, setPlaybackKeys] = useState(null)

  // Get WebSocket functions
  const { registerPayloadCallback, unregisterPayloadCallback } = useWebSocket()
  logger.debug('home.websocket.context', { registerPayloadCallback: !!registerPayloadCallback, unregisterPayloadCallback: !!unregisterPayloadCallback });

  const resetQueue = useCallback(() => {
    setQueue([])
  }, [])

  const closeMenu = useCallback(() => {
    setMenu(false)
    setMenuOpen(false)
  }, [])

  const clear = useCallback(() => {
    setCurrentContent(null)
    setQueue([])
    setMenu(false)
    setMenuOpen(false)
    setMenuKey(0)
  }, [])

  // Create menu selection handler
  const handleMenuSelection = useCallback((selection) => {
    const handler = createMenuSelectionHandler({
      queue,
      clear,
      playbackKeys,
      setMenuOpen,
      closeMenu,
      setCurrentContent,
      handleMenuSelection: (sel) => handleMenuSelection(sel) // Recursive reference
    });
    return handler(selection);
  }, [closeMenu, queue, clear, playbackKeys])

  // Create websocket handler
  const handleWebSocketPayload = useCallback(
    createWebSocketHandler({
      setLastPayloadMessage,
      setMenu,
      setMenuOpen,
      resetQueue,
      setCurrentContent,
      setMenuKey,
      handleMenuSelection
    }),
    [handleMenuSelection]
  )

  // Register payload callback after handleWebSocketPayload is defined
  useEffect(() => {
    if (registerPayloadCallback) {
      registerPayloadCallback(handleWebSocketPayload)
    }
    return () => {
      if (unregisterPayloadCallback) {
        unregisterPayloadCallback()
      }
    }
  }, [handleWebSocketPayload, registerPayloadCallback, unregisterPayloadCallback])

  const openMenu = useCallback(
    (menuId) => {
      if (menu === menuId && menuOpen) {
        return
      }
      setCurrentContent(null)
      setMenu(menuId)
      setMenuKey((k) => k + 1)
      setMenuOpen(true)
    },
    [menu, menuOpen]
  )

  // Fetch the key map once
  useEffect(() => {
    logger.info('home.keyboard.fetch.start');
    DaylightAPI('/data/keyboard/officekeypad')
      .then((fetchedMap) => {
        logger.info('home.keyboard.fetch.success', { hasKeys: !!fetchedMap, keyCount: Object.keys(fetchedMap || {}).length });
        setKeyMap(fetchedMap)

        // Rename to avoid overshadowing state variable
        const newPlaybackKeys = Object.keys(fetchedMap)
          .filter((key) => fetchedMap[key]?.function === 'playback')
          .reduce((acc, key) => {
            const param = fetchedMap[key]?.params
            if (!acc[param]) {
              acc[param] = []
            }
            acc[param].push(key)
            return acc
          }, {})

        logger.debug('home.keyboard.playback-keys', { keys: newPlaybackKeys });
        setPlaybackKeys(newPlaybackKeys)
      })
      .catch((error) => {
        logger.error('home.keyboard.fetch.error', { message: error?.message, name: error?.name })
      })
  }, [])

  // Fetch weather data once
  useEffect(() => {
    DaylightAPI('/data/weather')
      .then((data) => {
        setWeatherData(data)
      })
      .catch((error) => {
        logger.error('home.weather.fetch.error', { message: error?.message, name: error?.name })
      })
  }, [])

  // Attach keydown listener once keyMap is loaded
  useKeyboardHandler(keyMap, {
    menu,
    menuOpen,
    currentContent,
    closeMenu,
    openMenu,
    resetQueue,
    setCurrentContent,
    handleMenuSelection,
    setShaderOpacity
  })

  // Helper function to render content based on current state
  const renderContent = () => {
    // If we have an active content component (like a sub-menu, player, etc.)
    if (currentContent) {
      // Handle new format from menuHandler
      if (currentContent.type && currentContent.props) {
        const uuid = CryptoJS.lib.WordArray.random(16).toString();
        const safeProps = { ...(currentContent.props || {}) };
        delete safeProps.ref;
        delete safeProps.key;
        const componentMap = {
          play: <Player {...safeProps} />,
          queue: <Player {...safeProps} />,
          playlist: <Player {...safeProps} />,
          list: <KeypadMenu {...safeProps} key={uuid} />,
          menu: <KeypadMenu {...safeProps} key={uuid} />,
          open: <AppContainer {...safeProps} />,
        };
        
        const component = componentMap[currentContent.type];
        if (component) {
          return component;
        }
      }
      
      // Handle legacy JSX format
      return currentContent;
    }

    // If there's a queue, but also require both keyMap and playbackKeys to be present
    if (queue.length && keyMap && playbackKeys) {
      return <Player queue={queue} clear={resetQueue} playbackKeys={playbackKeys} />;
    }

    // If there's a menu open
    if (menu) {
      return (
        <KeypadMenu
          key={menuKey}
          list={menu}
          onSelection={handleMenuSelection}
          onClose={clear}
          onMenuState={setMenuOpen}
        />
      );
    }

    // Optional: if keyMap or playbackKeys doesn't exist yet, you can show a loading screen
    if (!keyMap || !playbackKeys) {
      logger.debug('home.loading.state', { keyMap: !!keyMap, playbackKeys: !!playbackKeys });
      return (
        <>
          <p>Loading key map...</p>
          <p>KeyMap: {keyMap ? 'Loaded' : 'Loading...'}</p>
          <p>PlaybackKeys: {playbackKeys ? 'Loaded' : 'Loading...'}</p>
        </>
      );
    }

    // Otherwise, the main dashboard UI
    return (
      <>
        <div className='sidebar'>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '1rem 1rem 0 1rem'
        }}>
          <h2
            style={{
              color: '#FFFFFF88',
              fontWeight: 'bold',
              marginBottom: '-1ex',
              textAlign: 'center',
              fontSize: '1.2rem',
              margin: 0
            }}
          >
            {moment().format('dddd, MMMM Do, YYYY')}
          </h2>
          <ConnectionStatus size={16} />
        </div>
        <Clock />
        <Weather weatherData={weatherData} />
        <WeatherForecast weatherData={weatherData} />
        <div
          style={{
            flexGrow: 1,
            outline: '1px solid #FFFFFF33',
            margin: '1ex',
            marginTop: '-0.5rem',
            borderRadius: '1ex',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '1rem'
          }}
          >
            <div>Entropy Dashboard coming soon</div>
            {lastPayloadMessage && (
              <div style={{ 
                marginTop: '1rem', 
                fontSize: '0.8rem', 
                color: '#FFFFFF66',
                textAlign: 'center' 
              }}>
                <div>Last WebSocket Message:</div>
                <div style={{ fontSize: '0.7rem' }}>
                  {JSON.stringify(lastPayloadMessage, null, 2)}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className='content'>
          <Upcoming />
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <div style={{ width: 'calc(50% - 0.5rem)', marginTop: '2rem' }}>
              <FinanceChart />
            </div>
            <div style={{ width: 'calc(50% - 0.5rem)' }}>
              <Health />
            </div>
          </div>
        </div>
      </>
    );
  };

  // Main render with consistent outer wrapper and shader
  return (
    <div className='App'>
      <div 
        className='shader' 
        style={{opacity: shaderOpacity}}
        data-opacity={shaderOpacity === 1 ? "1" : "0"}
      ></div>
      {renderContent()}
    </div>
  )
}

export default OfficeApp
