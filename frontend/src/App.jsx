import { useEffect, useState, useCallback } from 'react'
import './App.css'
import moment from 'moment'

import Clock from './modules/Time'
import WeatherForecast from './modules/WeatherForecast'
import Weather from './modules/Weather'
import Upcoming from './modules/Upcoming'
import Health from './modules/Health'
import { FinanceChart } from './modules/Finance'

import Player from './modules/Player'
import MenuNav from './modules/MenuNav'
import TVMenu from './modules/TVMenu'
import AppContainer from './modules/AppContainer'

import { DaylightAPI } from './lib/api.mjs'

function App() {
  const [queue, setQueue] = useState([])
  const [menu, setMenu] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuKey, setMenuKey] = useState(0)
  const [currentContent, setCurrentContent] = useState(null)
  const [keyMap, setKeyMap] = useState(null)

  const resetQueue = useCallback(() => {
    setQueue([])
  }, [])

  const closeMenu = useCallback(() => {
    setMenu(false)
    setMenuOpen(false)
  }, [])

  const handleMenuSelection = useCallback(
    (selection) => {
      setMenuOpen(false)
      if (!selection || !selection.label) {
        closeMenu()
        return
      }
      const props = { ...selection }
      const options = {
        play:     <Player {...props} clear={() => setCurrentContent(null)} />,
        queue:    <Player {...props} clear={() => setCurrentContent(null)} />,
        playlist: <Player {...props} clear={() => setCurrentContent(null)} />,
        list:     <TVMenu {...props} clear={() => setCurrentContent(null)} />,
        menu:     <TVMenu {...props} clear={() => setCurrentContent(null)} />,
        open:     <AppContainer {...props} clear={() => setCurrentContent(null)} />,
      }
      const selectionKeys = Object.keys(selection)
      const availableKeys = Object.keys(options)
      const firstMatch = selectionKeys.find((key) => availableKeys.includes(key))
      if (firstMatch) {
        setCurrentContent(options[firstMatch])
        closeMenu()
      }
    },
    [closeMenu]
  )

  const openMenu = useCallback(
    (menuId) => {
      if (menu === menuId && menuOpen) {
        return
      }
      setMenu(menuId)
      setMenuKey((k) => k + 1)
      setMenuOpen(true)
    },
    [menu, menuOpen]
  )

  // Fetch the key map only once
  useEffect(() => {
    DaylightAPI('/data/keyboard/officekeypad')
      .then((fetchedMap) => {
        setKeyMap(fetchedMap)
      })
      .catch((error) => {
        console.error('Failed to fetch keyboard configuration:', error)
      })
  }, [])

  // Attach keydown listener when we have the map or when dependencies update
  useEffect(() => {
    if (!keyMap) return

    const buttonFns = {
      menu: (params) => {
        openMenu(params)
      },
      escape: () => {
        if (currentContent) {
          setCurrentContent(null)
          return
        }
        if(!currentContent && !menuOpen) {
          setMenuOpen(false)
          window.location.reload()
          return
        }
        closeMenu()
      },
      playback: (params) => {
        switch (params) {
          case 'prev':  console.log('Previous'); break
          case 'pause': console.log('Pause');    break
          case 'play':  console.log('Play');     break
          default:      console.log(`Unknown playback option: ${params}`)
        }
      },
      volume: () => {
        console.log('Volume')
      },
      sleep: () => {
        console.log('Sleep')
      }
    }

    const handleKeyDown = (event) => {
      const action = keyMap[event.key]

      //if escape key, involke escape function
      if (event.key === 'Escape') return buttonFns.escape() 
      if (!action || !action.function) return


      // If something is playing and "menu" is pressed
      if (currentContent && action.function === 'menu') {
        resetQueue()
        setCurrentContent(null)
        openMenu(action.params)
        return
      }

      // If the menu is already open and it's the same ID, ignore
      if (menu && menuOpen && action.function === 'menu' && action.params === menu) {
        return
      }

      const fn = buttonFns[action.function]
      if (fn) fn(action.params)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    keyMap,
    menu,
    menuOpen,
    closeMenu,
    currentContent,
    openMenu,
    resetQueue
  ])

  if (currentContent) {
    return (
      <div className='App'>
        {currentContent}
      </div>
    )
  }

  if (queue.length) {
    return (
      <div className='App'>
        <Player queue={queue} clear={resetQueue} />
      </div>
    )
  }

  if (menu) {
    return (
      <div className='App'>
        <MenuNav
          key={menuKey}
          menuId={menu}
          onSelection={handleMenuSelection}
          onClose={closeMenu}
          onMenuState={setMenuOpen}
        />
      </div>
    )
  }

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

export default App