
import { buildDayToDayBudgetOptions } from '../Finances/blocks/daytoday'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { DaylightAPI } from '../../lib/api.mjs'
import { useEffect, useState } from 'react'
import './Finance.scss'
import upArrow from '../../assets/icons/upGreen.svg';
import downArrow from '../../assets/icons/downRed.svg';
import { formatAsCurrency } from '../Finances/blocks'


export function FinanceChart()
{
  const [monthData, setMonthData] = useState({})
  useEffect(() => {
    const fetchData = () => {
      DaylightAPI('/api/v1/finance/data/daytoday')
        .then((data) => {
          setMonthData(data)
        })
    }

    fetchData()
    const interval = setInterval(fetchData, 6 * 60 * 60 * 1000) // 6 hours in milliseconds

    return () => clearInterval(interval) // Cleanup interval on component unmount
  }, [])
  
  if(!monthData || Object.keys(monthData).length === 0) {
      return (
          <div style={{width: '100%', height: '240px', position: 'relative'}}>
              <div className="skeleton rect" style={{width: '100%', height: '100%'}}></div>
          </div>
      )
  }

  const options = buildDayToDayBudgetOptions(monthData, null, {plotLineColor: '#444'});
  if(!options || !options.chart) return null;
  options.chart.backgroundColor = 'transparent';
  options.title = {text: ''};
  options.subtitle = {text: ''};
  options.yAxis.labels.style = {color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem'};
  options.xAxis.labels.style = {color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem'};
  options.xAxis.labels.rotation = -35;
  //vertical tick color
  options.xAxis.tickColor = '#000';
  options.chart.marginTop = 10;

  //2px solid white line on x axis

const budgetBlockDimensions = { height : 240}
//...monthlyBudget[month], balance, spent, daysRemaining, dailySpend, dailyBudget, dailyAdjustment: adjustPercentage, adjustPercentage
 
  const info = {
    budget: monthData.budget || 0,
    remaining: monthData.balance || 0,
    spent: monthData.spent || 0,
    spentPercentage: (monthData.spent || 0) / (monthData.budget || 1),
    dailySpending: monthData.dailySpend || 0,
    daysRemaining: monthData.daysRemaining || 0,
    dailyBudget: monthData.dailyBudget || 0,
    adjust: Math.round(monthData.dailyAdjustment || 0)
  }
    const adjustIcon = (monthData.dailyAdjustment || 0) > 0 ? 
    <img src={upArrow} alt="up" style={{height: "1.3em", marginBottom: "-0.3em"}} /> : 
    <img src={downArrow} alt="down" style={{height: "1.3em", marginBottom: "-0.3em"}} />;
return (
    <div className="finance">
    <table style={{width: "100%", borderCollapse: "collapse"}}>
        <thead style={{textAlign: "left"}}>
            <tr>
            <th style={{border: "1px solid black", width: "20%", padding: "8px"}}>Spent</th>
            <th style={{border: "1px solid black", width: "20%",  padding: "8px"}}>Balance</th>
            <th style={{border: "1px solid black", width: "20%",  padding: "8px"}}>Days Left</th>
                <th style={{border: "1px solid black", width: "20%",  padding: "8px"}}>Adjustment</th>

            </tr>
        </thead>
        <tbody>
            <tr>
                <td style={{border: "1px solid black", padding: "8px"}}>{formatAsCurrency(info.spent)}</td>
                <td style={{border: "1px solid black", padding: "8px"}}>{formatAsCurrency(info.remaining)}</td>
                <td style={{border: "1px solid black", padding: "8px"}}>{info.daysRemaining}</td>
                <td style={{border: "1px solid black", padding: "8px"}}>{info.adjust}% {adjustIcon}</td>
            </tr>
        </tbody>
    </table>
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

