
import { buildDayToDayBudgetOptions } from '../Finances/blocks/daytoday'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { DaylightAPI } from '../../lib/api.mjs'
import { useEffect, useState } from 'react'
import moment from 'moment'
import './Finance.scss'
import upArrow from '../../assets/icons/upGreen.svg';
import downArrow from '../../assets/icons/downRed.svg';
import { formatAsCurrency } from '../Finances/blocks'

function buildBaselineOptions(monthData) {
  const budget = monthData.budget || 0;
  const daysInMonth = moment().daysInMonth();
  const categories = [''].concat(Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString()));
  const baselineData = Array.from({ length: daysInMonth + 1 }, (_, i) => {
    return budget - i * (budget / daysInMonth);
  });

  return {
    chart: { animation: false, marginTop: 10, backgroundColor: 'transparent' },
    title: { text: '' },
    subtitle: { text: '' },
    xAxis: {
      categories,
      labels: {
        style: { color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem' },
        rotation: -35,
        formatter: function () {
          if (!this.value || this.value === '') return '';
          const dayNum = parseInt(this.value);
          if (isNaN(dayNum)) return '';
          const date = moment().date(dayNum);
          const isMonday = date.day() === 1;
          const isLastDay = dayNum === daysInMonth;
          return (isMonday || isLastDay) ? date.format('MMM D') : '';
        }
      },
      tickColor: '#000',
    },
    yAxis: {
      min: 0,
      max: budget,
      title: { text: '' },
      labels: {
        style: { color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem' },
        formatter: function () {
          const formatted = this.axis.defaultLabelFormatter.call(this);
          return '$' + formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
      },
      gridLineWidth: 0,
    },
    series: [{
      name: 'Baseline',
      data: baselineData,
      type: 'area',
      color: 'rgba(255, 0, 0, 0.1)',
      lineColor: 'rgba(255, 0, 0, 0.5)',
      marker: { enabled: false },
      enableMouseTracking: false,
    }],
    plotOptions: { series: { animation: false } },
    legend: { enabled: false },
    credits: { enabled: false },
  };
}

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
    const interval = setInterval(fetchData, 6 * 60 * 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  if(!monthData || Object.keys(monthData).length === 0) {
      return (
          <div className="finance">
              <table style={{width: "100%", borderCollapse: "collapse"}}>
                  <thead style={{textAlign: "left"}}>
                      <tr>
                          {Array.from({length: 4}).map((_, i) => (
                              <th key={i} style={{border: "1px solid black", width: "20%", padding: "8px"}}>
                                  <div className="skeleton text" style={{width: '70%', height: '0.8rem'}}></div>
                              </th>
                          ))}
                      </tr>
                  </thead>
                  <tbody>
                      <tr>
                          {Array.from({length: 4}).map((_, i) => (
                              <td key={i} style={{border: "1px solid black", padding: "8px"}}>
                                  <div className="skeleton text" style={{width: '60%', height: '1.2rem'}}></div>
                              </td>
                          ))}
                      </tr>
                  </tbody>
              </table>
              <div className="budget-block-content">
                  <div className="skeleton rect" style={{width: '100%', height: '100%'}}></div>
              </div>
          </div>
      )
  }

  let options = buildDayToDayBudgetOptions(monthData, null, {plotLineColor: '#444'});
  if (options && options.chart) {
    options.chart.backgroundColor = 'transparent';
    options.title = {text: ''};
    options.subtitle = {text: ''};
    options.yAxis.labels.style = {color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem'};
    options.xAxis.labels.style = {color: '#FFFFFFBB', fontWeight: 'bold', fontFamily: 'Roboto Condensed', fontSize: '1rem'};
    options.xAxis.labels.rotation = -35;
    options.xAxis.tickColor = '#000';
    options.chart.marginTop = 10;
  } else {
    options = buildBaselineOptions(monthData);
  }

  const budgetBlockDimensions = { height: 240 };

  const info = {
    budget: monthData.budget || 0,
    remaining: monthData.balance || 0,
    spent: monthData.spending || monthData.spent || 0,
    spentPercentage: (monthData.spending || monthData.spent || 0) / (monthData.budget || 1),
    dailySpending: monthData.dailySpend || 0,
    daysRemaining: monthData.daysRemaining || moment().daysInMonth() - moment().date() + 1,
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
            <th style={{border: "1px solid black", width: "20%", padding: "8px"}}>Balance</th>
            <th style={{border: "1px solid black", width: "20%", padding: "8px"}}>Days Left</th>
            <th style={{border: "1px solid black", width: "20%", padding: "8px"}}>Adjustment</th>
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
}

