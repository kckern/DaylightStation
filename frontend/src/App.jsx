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


function App() {

  const [queue, setQueue] = useState([])
  const keyboardHandler = () => {

    //todo get from config
    const map = {
      "s": { key: 'scripture', value: 12345 },
      "p": { key: 'plex', value: 67890 }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setQueue([])
      Object.keys(map).forEach((key) => {
        if (event.key === key) setQueue([map[key]])})}
      window.addEventListener('keydown', handleKeyDown)
    return () => {window.removeEventListener('keydown', handleKeyDown)}
  }

  //keydown listener to add scripture to queue
  useEffect(keyboardHandler, [])
  
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
