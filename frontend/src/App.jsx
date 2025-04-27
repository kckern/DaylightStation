import { useEffect, useState } from 'react'
import Clock from './modules/Time'
import './App.css'
import WeatherForecast from './modules/WeatherForecast'
import Weather from './modules/Weather'
import Upcoming from './modules/Upcoming'
import Health from './modules/Health'
import { FinanceChart } from './modules/Finance'
import moment from 'moment'
import Player from './modules/Player'
import MenuNav from './modules/MenuNav'
import { DaylightAPI } from './lib/api.mjs'


function App() {

  const [queue, setQueue] = useState([])
  const [menu, setMenu] = useState(false)
  const keyboardHandler = () => {


    const buttonFns = {
      "menu": (params) => {
        if(!!params) return setMenu(params)
      },
     "escape": () => clear(),
      "playback": (params) => {
        switch (params) {
          case "prev":
            console.log('Previous')
            break
          case "pause":
            console.log('Pause')
            break
          case "play":
            console.log('Play')
            break
          default:
            console.log(`Unknown playback option: ${params}`)
        }
      },
      "volume": () => {
        console.log('Volume')
      },
      "sleep": () => {
        console.log('Sleep')
      }
    }

    const handleKeyDown = (event, map) => {
      Object.keys(map).forEach((key) => {
        if (event.key === key) {
          const action = map[key]
          if (action.function && buttonFns[action.function]) {
            buttonFns[action.function](action.params)
          }
        }
      })
    }

    DaylightAPI(`/data/keyboard/officekeypad`).then((response) => {
      const map = response
      const keyDownListener = (event) => handleKeyDown(event, map)
      window.addEventListener('keydown', keyDownListener)
      return () => { window.removeEventListener('keydown', keyDownListener) }
    }).catch((error) => {
      console.error("Failed to fetch keyboard configuration:", error)
    })
  }
  

  //keydown listener to add scripture to queue
  useEffect(keyboardHandler, [])

  if(menu) return <div className='App' ><MenuNav setMenu={setMenu} menu={menu} setQueue={setQueue} clear={() => setMenu(false)} /></div>
  if(queue.length) return  <div className='App' ><Player queue={queue} clear={reset} /></div>
  return (
    <div className='App' >
          <div className='sidebar'>
        <h2 style={{ color: '#FFFFFF88',  fontWeight: 'bold', marginBottom: '-1ex', textAlign: 'center' , marginTop: '1rem', fontSize: '1.2rem'}}>
          {moment().format('dddd, MMMM Do, YYYY')}
        </h2>
          <Clock/>
          <Weather/>

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
              alignItems: 'center',
            }}
          >
            Entropy Dashboard coming soon
          </div>
      </div>
      <div className='content'>
        <Upcoming />
        <div style={{ display: 'flex', justifyContent: 'space-between' ,  width: '100%'}}>
          <div style={{ width: `calc(50% - 0.5rem)`, marginTop: '2rem' }}>
          <FinanceChart />
          </div>
          <div style={{ width: `calc(50% - 0.5rem)`}}>
          <Health />
          </div>
        </div>
      </div>
    </div>
  )
}


export default App
