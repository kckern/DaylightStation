import { useEffect, useState } from 'react'
import Clock from './modules/Time'
import './App.css'
import WeatherForecast from './modules/WeatherForecast'
import Weather from './modules/Weather'
import Upcoming from './modules/Upcoming'
import Health from './modules/Health'
import { buildDayToDayBudgetOptions } from './budget/blocks/daytoday'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { DaylightAPI } from './lib/api.mjs'

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


function FinanceChart()
{
  const [monthData, setMonthData] = useState({})
  useEffect(() => {
    DaylightAPI('/data/budget/daytoday')
      .then((data) => {
        setMonthData(data)
      })
  }
  )
  if(!monthData) return null;
  const options = buildDayToDayBudgetOptions(monthData, null, {plotLineColor: '#444'});
  if(!options.chart) return null;
  options.chart.backgroundColor = 'transparent';
  options.title = {text: ''};
  options.subtitle = {text: ''};
  options.yAxis.labels.style = {color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem'};
  options.xAxis.labels.style = {color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem'};
  options.xAxis.labels.rotation = -35;
  //vertical tick color
  options.xAxis.tickColor = '#000';

const budgetBlockDimensions = {width: 550, height : 400}
  return (
    <div className="budget-block">
      <h2>Day-to-day Spending</h2>
      <div className="budget-block-content">
        <HighchartsReact
          className="budget-burn-down-chart"
          highcharts={Highcharts}
          options={{
            ...options,
            chart: {
              ...options.chart,
              width: budgetBlockDimensions.width,
              height: budgetBlockDimensions.height
            }
          }}
        />
      </div>
    </div>
  );

  return 
}


export default App
