
import { buildDayToDayBudgetOptions } from '../budget/blocks/daytoday'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { DaylightAPI } from '../lib/api.mjs'
import { useEffect, useState } from 'react'
import './Finance.scss'
import { formatAsCurrency } from '../budget/blocks'
import upArrow from '../assets/icons/upGreen.svg';
import downArrow from '../assets/icons/downRed.svg';

export function FinanceChart()
{
  const [monthData, setMonthData] = useState({})
  useEffect(() => {
    DaylightAPI('/data/budget/daytoday')
      .then((data) => {
        setMonthData(data)
      })
  }, [])
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
  options.chart.marginTop = 10;

  //2px solid white line on x axis

const budgetBlockDimensions = { height : 240}
//...monthlyBudget[month], balance, spent, daysRemaining, dailySpend, dailyBudget, dailyAdjustment: adjustPercentage, adjustPercentage
 
  const info = {
    budget: monthData.budget,
    remaining: monthData.balance,
    spent: monthData.spent,
    spentPercentage: monthData.spent / monthData.budget,
    dailySpending: monthData.dailySpend,
    daysRemaining: monthData.daysRemaining,
    dailyBudget: monthData.dailyBudget,
    adjust: Math.round(monthData.dailyAdjustment)


  }
    const adjustIcon = monthData.dailyAdjustment > 0 ? 
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

