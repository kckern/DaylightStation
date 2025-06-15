import { useEffect, useState, useCallback } from 'react'
import './HomeApp.scss'
import moment from 'moment'
import CryptoJS from 'crypto-js'

import Clock from '../modules/Time'
import WeatherForecast from '../modules/WeatherForecast'
import Weather from '../modules/Weather'
import Upcoming from '../modules/Upcoming'
import Health from '../modules/Health'
import { FinanceChart } from '../modules/Finance'

import Player from '../modules/Player'
import {KeypadMenu} from '../modules/Menu'
import AppContainer from '../modules/AppContainer'

import { DaylightAPI } from '../lib/api.mjs'

function HomeApp() {
  const [queue, setQueue] = useState([])
  const [menu, setMenu] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuKey, setMenuKey] = useState(0)
  const [currentContent, setCurrentContent] = useState(null)
  const [keyMap, setKeyMap] = useState(null)

  // Keep playbackKeys separate so we can be sure to check it is never undefined
  const [playbackKeys, setPlaybackKeys] = useState(null)

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

  const handleMenuSelection = useCallback(
    (selection) => {
      setMenuOpen(false)
      if (!selection || !selection.label) {
        closeMenu()
        return
      }
      if (!playbackKeys) {
        console.error('Playback keys are not yet loaded.')
        return
      }
      const props = {queue, ...selection,  clear, onSelection: handleMenuSelection, playbackKeys }
      const uuid = CryptoJS.lib.WordArray.random(16).toString()
      const options = {
        play:     <Player {...props} />,
        queue:    <Player {...props} />,
        playlist: <Player {...props} />,
        list:     <KeypadMenu {...props} key={uuid} />,
        menu:     <KeypadMenu {...props} key={uuid} />,
        open:     <AppContainer {...props} />,
      }
      const selectionKeys = Object.keys(selection)
      const availableKeys = Object.keys(options)
      const firstMatch = selectionKeys.find((key) => availableKeys.includes(key))
      if (firstMatch) {
        setCurrentContent(options[firstMatch])
        closeMenu()
      }
    },
    [closeMenu, queue, clear, playbackKeys]
  )

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
    DaylightAPI('/data/keyboard/officekeypad')
      .then((fetchedMap) => {
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

        setPlaybackKeys(newPlaybackKeys)
      })
      .catch((error) => {
        console.error('Failed to fetch keyboard configuration:', error)
      })
  }, [])

  // Attach keydown listener once keyMap is loaded
  useEffect(() => {
    // Only attach if we actually have a working keyMap
    if (!keyMap) return


    const subMenu = currentContent?.props?.list?.menu || currentContent?.props?.list?.plex

    const buttonFns = {
      menu: (params) => {
        openMenu(params)
      },
      escape: () => {
        if (currentContent) {
          setCurrentContent(null)
          return
        }
        if (!currentContent && !menuOpen) {
          setMenuOpen(false)
          window.location.reload()
          return
        }
        closeMenu()
      },
      volume: () => {
        console.log('Volume')
      },
      sleep: () => {
        console.log('Sleep')
      }
    }

    const handleKeyDown = (event) => {
      // Check for escape
      if (event.key === 'Escape') {
        return buttonFns.escape()
      }
      if (!keyMap[event.key]?.function) {
        //return console.log('No action found for key:', event.key)
      }
      const action = keyMap[event.key]

      // If the menu is already open, or if there’s a subMenu, skip processing
      if (
        subMenu ||
        (menu && menuOpen && action?.function === 'menu' && action?.params === menu)
      ) {
        return 
      }

      // If something is playing and "menu" is pressed
      if (currentContent && action?.function === 'menu') {
        resetQueue()
        setCurrentContent(null)
        openMenu(action.params)
        return 
      }

      const fn = buttonFns[action.function]
      if (fn) fn(action.params)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [keyMap, menu, menuOpen, closeMenu, currentContent, openMenu, resetQueue])


  // If we have an active content component (like a sub-menu, player, etc.)
  if (currentContent) {
    return <div className='App'>{currentContent}</div>
  }

  // If there's a queue, but also require both keyMap and playbackKeys to be present
  if (queue.length && keyMap && playbackKeys) {
    return (
      <div className='App'>
        <Player queue={queue} clear={resetQueue} playbackKeys={playbackKeys} />
      </div>
    )
  }

  // If there's a menu open
  if (menu) {
    return (
      <div className='App'>
        <KeypadMenu
          key={menuKey}
          list={menu}
          onSelection={handleMenuSelection}
          onClose={clear}
          onMenuState={setMenuOpen}
        />
      </div>
    )
  }

  // Optional: if keyMap or playbackKeys doesn't exist yet, you can show a loading screen
  if (!keyMap || !playbackKeys) {
    return (
      <div className="App">
        <p>Loading key map...</p>
      </div>
    )
  }

  // Otherwise, the main dashboard UI
  return (
    <div className='App'>
      <div className='sidebar'>
        <h2
          style={{
            color: '#FFFFFF88',
            fontWeight: 'bold',
            marginBottom: '-1ex',
            textAlign: 'center',
            marginTop: '1rem',
            fontSize: '1.2rem'
          }}
        >
          {moment().format('dddd, MMMM Do, YYYY')}
        </h2>
        <Clock />
        <Weather />
        <WeatherForecast />
        <div
          style={{
            flexGrow: 1,
            outline: '1px solid #FFFFFF33',
            margin: '1ex',
            marginTop: '-0.5rem',
            borderRadius: '1ex',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          Entropy Dashboard coming soon
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
    </div>
  )
}

export default HomeApp