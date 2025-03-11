import { useState } from 'react'
import Clock from './modules/Time'
import './App.css'
import WeatherForecast from './modules/WeatherForecast'
import Weather from './modules/Weather'
import Upcoming from './modules/Upcoming'
import Health from './modules/Health'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <div className='sidebar'>
          <Clock/>
          <Weather/>
          <WeatherForecast />
      </div>
      <div className='content'>
        <Upcoming />
        <Health />
      </div>
    </>
  )
}

export default App
