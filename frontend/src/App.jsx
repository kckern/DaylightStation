import { useState } from 'react'
import Clock from './modules/Time'
import './App.css'
import WeatherForecast from './modules/WeatherForecast'
import Weather from './modules/Weather'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <div className='sidebar'>
    <Clock/>
    <Weather/>
    <WeatherForecast />
      </div>
    </>
  )
}

export default App
