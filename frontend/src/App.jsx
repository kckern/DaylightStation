import { useState } from 'react'
import Clock from './modules/Time'
import './App.css'
import WeatherForecast from './modules/WeatherForecast'
import Weather from './modules/Weather'
import Upcoming from './modules/Upcoming'
import Health from './modules/Health'
import { BudgetDayToDayChart } from './budget/blocks/daytoday'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className='App'>
      <div className='sidebar'>
          <Clock/>
          <Weather/>
          <WeatherForecast />
      </div>
      <div className='content'>
        <Upcoming />
        <div style={{ display: 'flex', justifyContent: 'space-between' ,  width: '100%'}}>
          <div style={{ width: `calc(50% - 0.5rem)`, marginTop: '2rem' }}>
          <BudgetDayToDayChart budgetBlockDimensions={{ width: 400, height: 330 }} config={{
            backgroundColor: 'transparent',
            subtitle: '-'
          }} />
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
