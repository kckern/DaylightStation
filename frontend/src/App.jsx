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


function App() {

  const [queue, setQueue] = useState([])
  const [menu, setMenu] = useState(false)
  const keyboardHandler = () => {

    const scripture = () => setQueue([{ key: 'scripture', value: `d&c ${Math.floor(Math.random() * 132) + 1}` }])
    const plex = () => setQueue([{ key: 'plex', value: 489490 }])
    const reset = () => setQueue([])


    //todo get from config
    const map = {
      "1": scripture,
      "2": plex,
      "3": () => setMenu("Kids Shows"),
      "4": reset,
      "5": () => setMenu("Lessons"),
      "6": () => setMenu("Plex"),
      "Escape": reset
    }

    const handleKeyDown = (event) => {
      Object.keys(map).forEach((key) => {
        if (event.key === key) (map[key] || (() => {}))()
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }
  

  //keydown listener to add scripture to queue
  useEffect(keyboardHandler, [])

  if(menu) return <div className='App' ><MenuNav setMenu={setMenu} menu={menu} setQueue={setQueue} /></div>
  if(queue.length) return  <div className='App' ><Player queue={queue} setQueue={setQueue} /></div>
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
