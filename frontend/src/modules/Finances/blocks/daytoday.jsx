import React, { useEffect, useMemo, useState } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { MonthTabs } from "./monthly";
import moment from 'moment';
import { formatAsCurrency, PALETTE } from '../lib/format.mjs';
import { useToday } from '../hooks/useToday.mjs';
import { EmptyState } from '../EmptyState.jsx';

export function buildDayToDayBudgetOptions(monthData, setDrawerContent, override) {
  override = override || {};
  if (!monthData || !monthData.dailyBalances) return {};
  setDrawerContent = setDrawerContent || (() => {});
  const dailyBalances = monthData.dailyBalances;
  const dayKeys = Object.keys(dailyBalances).filter(key => !key.endsWith('-start')).sort();
  if (!dayKeys.length) return {};

  // Basic info about the month
  const firstDayKey = dayKeys[0];
  const lastDayKey = dayKeys[dayKeys.length - 1];
  const inferredMonth = monthData.month || moment(firstDayKey).format('YYYY-MM');
  const now = override.now ? moment(override.now) : moment();
  const currentMonth = now.format('YYYY-MM');
  const daysInMonth = moment(inferredMonth).daysInMonth();
  const isCurrentMonth = inferredMonth === currentMonth;
  const today = now.date() - 1; // Convert to 0-based for array indexing

  // Build the actual data series
  const actualData = dayKeys.map((dateKey, idx) => {
    const day = dailyBalances[dateKey];
    const isFirstDay = idx === 0;
    const isWeekend = moment(dateKey).day() === 0 || moment(dateKey).day() === 6;
    const highlightToday = isCurrentMonth && idx === today;
    const overspent = day.overspent;
    return {
      y: day.endingBalance,
      actualBalance: day.endingBalance,
      color: overspent ? PALETTE.over : (highlightToday || isFirstDay) ? PALETTE.spent : (isWeekend ? '#777' : undefined)
    };
  });

  // Budget stats
  const startKey = `${inferredMonth}-start`;
  const initialBudget = dailyBalances[startKey]?.startingBalance || 0;
  const endingBalance = dailyBalances[lastDayKey]?.endingBalance ?? 0;
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

  // Color reflects where the pace ACTUALLY lands, not the 0-clamped plot value —
  // Math.max(0, …) on plotted points made the "over budget" red unreachable.
  const endingProjectedUnclamped = isCurrentMonth && today < daysInMonth && actualData[today] && today >= 0
    ? actualData[today].y - (daysInMonth - today) * averageDailyBurn
    : 0;
  const projectionColor = endingProjectedUnclamped < 0 ? PALETTE.projectionOver : PALETTE.projectionOk;

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
  const zeroCrossingIndex = dayKeys.findIndex(key => dailyBalances[key].overspent);
  const categories = [''].concat(Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString()));

  return {
    chart: { animation: false, marginTop: 50 },
    tooltip: {
      formatter: function () {
        if (!this.y && this.y !== 0) return false;
        const dayNum = parseInt(this.key) || this.x + 1;
        const date = moment(inferredMonth).date(dayNum).format('MMMM D, YYYY');
        const displayValue = this.point?.actualBalance != null
          ? formatAsCurrency(this.point.actualBalance)
          : formatAsCurrency(this.y);
        return `<b>${this.series.name}: ${displayValue}</b><br/>${date}`;
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
        color: 'rgba(255, 0, 0, 0.05)'
      }] : []
    },
    yAxis: {
      min: Math.min(0, ...dayKeys.map(k => dailyBalances[k].endingBalance ?? 0)),
      max: Math.max(initialBudget, ...actualData.map(d => d.y || 0)),
      plotLines: [{ value: 0, color: '#666', width: 1, zIndex: 3 }],
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
              type: 'daytoday-month',
              title: header,
              month: inferredMonth,
              highlightDate: e.point.category
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

export const BudgetDayToDay = ({ setDrawerContent, budget }) => {

  const dayToDayBudget = budget.dayToDayBudget || {};
  const months = Object.keys(dayToDayBudget);
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
    if (dayToDayBudget[activeMonth] !== undefined) return;
    const available = Object.keys(dayToDayBudget).filter((m) => m <= currentMonth).sort();
    setActiveMonth(available[available.length - 1] ?? Object.keys(dayToDayBudget)[0]);
  }, [activeMonth, dayToDayBudget, currentMonth]);

  const monthData = dayToDayBudget[activeMonth] || {};
  const today = useToday();
  const options = useMemo(
    () => buildDayToDayBudgetOptions(monthData, setDrawerContent, { now: today }),
    [monthData, setDrawerContent, today]
  );

  if (Object.keys(budget.dayToDayBudget || {}).length === 0) {
    return (<div className="budget-block"><h2>Day-to-day Spending</h2><EmptyState /></div>);
  }

  return (
    <div className="budget-block">
      <h2>Day-to-day Spending</h2>
      <div className="budget-block-content">
        {monthHeader}
        <HighchartsReact
          className="budget-burn-down-chart"
          highcharts={Highcharts}
          options={options}
        />
      </div>
    </div>
  );
};