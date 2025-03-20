import { useEffect, useState } from 'react'
import Clock from './modules/Time'
import './App.css'
import WeatherForecast from './modules/WeatherForecast'
import Weather from './modules/Weather'
import Upcoming from './modules/Upcoming'
import Health from './modules/Health'
import { FinanceChart } from './modules/Finance'
import moment from 'moment'
function App() {
  const [count, setCount] = useState(0)


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
