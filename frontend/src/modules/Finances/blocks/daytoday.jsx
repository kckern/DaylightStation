import React, { useEffect, useState } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { MonthTabs } from "./monthly";
import { Drawer } from "../drawer";
import moment from 'moment';

const formatAsCurrency = (value) => {
  if (!value && value !== 0) return '$Ø';
  return `$${Math.round(value).toLocaleString()}`;
};

export function buildDayToDayBudgetOptions(monthData, setDrawerContent, override) {
  override = override || {};
  if (!monthData || !monthData.dailyBalances) return {};
  setDrawerContent = setDrawerContent || (() => {});
  const dailyBalances = monthData.dailyBalances;
  const transactions = monthData.transactions || [];
  const dayKeys = Object.keys(dailyBalances).filter(key => !key.endsWith('-start')).sort();
  if (!dayKeys.length) return {};

  // Basic info about the month
  const firstDayKey = dayKeys[0];
  const lastDayKey = dayKeys[dayKeys.length - 1];
  const inferredMonth = monthData.month || moment(firstDayKey).format('YYYY-MM');
  const currentMonth = moment().format('YYYY-MM');
  const daysInMonth = moment(inferredMonth).daysInMonth();
  const isCurrentMonth = inferredMonth === currentMonth;
  const today = moment().date() - 1; // Convert to 0-based for array indexing

  // Build the actual data series
  const actualData = dayKeys.map((dateKey, idx) => {
    const isMonday = moment(dateKey).day() === 1;
    const isFirstDay = idx === 0;
    const isWeekend = moment(dateKey).day() === 0 || moment(dateKey).day() === 6;
    const highlightToday = isCurrentMonth && idx === today;
    return {
      y: dailyBalances[dateKey].endingBalance,
      color: (highlightToday || isFirstDay) ? '#0077b6' : (isWeekend ? '#777' : undefined)
    };
  });

  // Budget stats
  const startKey = `${inferredMonth}-start`;
  const initialBudget = dailyBalances[startKey]?.startingBalance || 0;
  const endingBalance = dailyBalances[lastDayKey]?.endingBalance || 0;
  const spent = initialBudget - endingBalance;

  // Build projected data for future days in the current month
  // Replicates the original logic where index == today is used
  let projectedDataSeries = [];
  const averageDailyBurn = isCurrentMonth && today < daysInMonth && actualData[today]
    ? (actualData[0].y - actualData[today].y) / (today + 1)
    : 0;

  const projectedData = isCurrentMonth && today < daysInMonth && actualData[today] && today >= 0
    ? [actualData[today].y].concat(
        Array.from({ length: daysInMonth - today }, (_, i) => {
          const val = actualData[today].y - (i + 1) * averageDailyBurn;
          return Math.max(0, val);
        })
      )
    : [];

  const projectedDataWithNulls = isCurrentMonth && today < daysInMonth && actualData[today] && today >= 0
    ? Array(today).fill(null).concat(projectedData)
    : [];

  const firstNonNullIndex = projectedDataWithNulls.findIndex((v) => v !== null);
  const lastIndex = projectedDataWithNulls.length - 1;

  const endingProjectedBalance = projectedData.length
    ? projectedData[projectedData.length - 1]
    : 0;

  const projectionColor = endingProjectedBalance < 0 ? '#780000' : '#2a9d8f';

  projectedDataSeries = projectedDataWithNulls.map((val, idx) => ({
    y: val,
    marker: {
      enabled: idx === firstNonNullIndex || idx === lastIndex,
      radius: 4,
      fillColor: projectionColor,
      symbol: idx === firstNonNullIndex ? 'circle' : 'square'
    }
  }));

  // Baseline data (simple linear descent of the entire month's budget)
  const baselineData = Array.from({ length: daysInMonth + 1 }, (_, i) => {
    return initialBudget - i * (initialBudget / daysInMonth);
  });

  // Identify where the balance crosses below zero (shaded area)
  const zeroCrossingIndex = actualData.findIndex((pt) => pt.y < 0);
  const categories = [''].concat(Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString()));

  return {
    chart: { animation: false, marginTop: 50 },
    tooltip: {
      formatter: function () {
        if (!this.y && this.y !== 0) return false;
        const dayNum = parseInt(this.key) || this.x + 1;
        const date = moment(inferredMonth).date(dayNum).format('MMMM D, YYYY');
        return `<b>${this.series.name}: ${formatAsCurrency(this.y)}</b><br/>${date}`;
      }
    },
    title: {
      text: moment(inferredMonth).format('MMMM YYYY'),
      align: 'right',
      verticalAlign: 'top',
      floating: true
    },
    subtitle: {
      text: `Spent: ${formatAsCurrency(spent)} | Remaining: ${formatAsCurrency(endingBalance)} | Budget: ${formatAsCurrency(initialBudget)}`,
      align: 'right',
      verticalAlign: 'top',
      y: 30,
      floating: true
    },
    xAxis: {
      categories,
      labels: {
        y: 15,
        formatter: function () {
          // Skip the first empty category
          if (!this.value || this.value === '') return '';
          
          const dayNum = parseInt(this.value);
          if (isNaN(dayNum) || dayNum < 1 || dayNum > daysInMonth) return '';
          
          const date = moment(firstDayKey).date(dayNum);
          const label = date.format('MMM D');
          const isMonday = date.day() === 1;
          const isCloseToEnd = date.isAfter(moment(firstDayKey).endOf('month').subtract(4, 'days'));
          const isLastDay = dayNum === daysInMonth;
          const showableMonday = isMonday && !isCloseToEnd;
          return (showableMonday || isLastDay) ? label : '';
        }
      },
      tickPositions: Array.from({ length: daysInMonth }, (_, i) => {
        const dayNum = i + 1;
        const date = moment(firstDayKey).date(dayNum);
        if (i === 0) return dayNum;
        const isMonday = date.day() === 1;
        const isLastDay = dayNum === daysInMonth;
        return (isMonday || isLastDay) ? dayNum : null;
      }).filter(Boolean),
      plotLines: Array.from({ length: daysInMonth }, (_, i) => {
        const dayNum = i + 1;
        const date = moment(firstDayKey).date(dayNum);
        return date.day() === 1 ? { color: override.plotLineColor || '#EEE', width: 1, value: dayNum } : null;
      }).filter(Boolean),
      plotBands: zeroCrossingIndex >= 0 ? [{
        from: zeroCrossingIndex,
        to: daysInMonth,
        color: 'rgba(255, 0, 0, 0.1)'
      }] : []
    },
    yAxis: {
      min: Math.min(0, endingBalance, ...actualData.map((a) => a.y)),
      max: initialBudget,
      title: { text: '' },
      labels: {
        formatter: function () {
          const formatted = this.axis.defaultLabelFormatter.call(this);
          return '$' + formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
      },
      gridLineWidth: 0
    },
    series: [
      {
        name: 'Baseline',
        data: baselineData,
        type: 'area',
        color: 'rgba(255, 0, 0, 0.1)',
        lineColor: 'rgba(255, 0, 0, 0.5)',
        marker: { enabled: false },
        enableMouseTracking: false,
        states: { hover: { enabled: false } }
      },
      {
        name: 'Actual Data',
        data: [
          ...actualData
        ].map((d, idx) => {
          // Hide future data points on the bar chart
          if (isCurrentMonth && idx > today) {
            return { ...d, y: null };
          }
          return d;
        }),
        type: 'column',
        zIndex: 2,
        cursor: setDrawerContent ? 'pointer' : undefined,
        events: setDrawerContent ? {
          click: function (e) {
            const header = `Day-to-day transactions for ${moment(inferredMonth).format('MMMM YYYY')}`;
            setDrawerContent({
              jsx: (
                <Drawer
                  setDrawerContent={setDrawerContent}
                  header={header}
                  transactions={transactions}
                  highlightDate={e.point.category}
                />
              ),
              meta: { title: header }
            });
          }
        } : {}
      },
      {
        name: 'Projected Data',
        data: projectedDataSeries,
        type: 'line',
        dashStyle: 'ShortDash',
        lineWidth: 2,
        color: projectionColor
      }
    ],
    plotOptions: { series: { animation: false } },
    legend: { enabled: false },
    credits: { enabled: false }
  };
}

export const BudgetDayToDay = ({ setDrawerContent, budget, budgetBlockDimensions }) => {

  const months = Object.keys(budget.dayToDayBudget);
  const currentMonth = moment().format("YYYY-MM");
  const [activeMonth, setActiveMonth] = useState(currentMonth);
  const nonFutureMonths = months.filter((m) => m <= currentMonth);
  const monthHeader = (
    <MonthTabs
      monthKeys={nonFutureMonths}
      activeMonth={activeMonth}
      setActiveMonth={setActiveMonth}
    />
  );
  useEffect(() => {
    const activeMonthIsInCurrentBudget = budget.dayToDayBudget[activeMonth] !== undefined;

    if (!activeMonthIsInCurrentBudget) {
      const firstMonth = nonFutureMonths.reverse()[0];
      setActiveMonth(firstMonth);
    }
  }, [activeMonth, budget.dayToDayBudget, nonFutureMonths]);

  const monthData = budget.dayToDayBudget[activeMonth] || {};
  const options = buildDayToDayBudgetOptions(monthData, setDrawerContent);


  return (
    <div className="budget-block">
      <h2>Day-to-day Spending</h2>
      <div className="budget-block-content">
        {monthHeader}
        <HighchartsReact
        key={activeMonth}
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
};