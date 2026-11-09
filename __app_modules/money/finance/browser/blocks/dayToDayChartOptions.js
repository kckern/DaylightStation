// dayToDayChartOptions.js — Highcharts options builder for BudgetDayToDay's
// daily-balance chart, split out of daytoday.jsx so Fast Refresh can
// hot-reload the block component on its own.
import moment from 'moment';
import { formatAsCurrency, PALETTE } from "../lib/format.mjs";

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
  // x is the day of the month: x=0 is the opening balance (the baseline's
  // start), x=N is the close of day N. Bars and baseline share that axis.
  const todayX = now.date();

  // Build the actual data series; x=0 carries no bar.
  const actualData = [{ y: null }].concat(dayKeys.map((dateKey, idx) => {
    const day = dailyBalances[dateKey];
    const isFirstDay = idx === 0;
    const isWeekend = moment(dateKey).day() === 0 || moment(dateKey).day() === 6;
    const highlightToday = isCurrentMonth && idx + 1 === todayX;
    const overspent = day.overspent;
    return {
      y: day.endingBalance,
      actualBalance: day.endingBalance,
      color: overspent ? PALETTE.over : (highlightToday || isFirstDay) ? PALETTE.spent : (isWeekend ? '#777' : undefined)
    };
  }));

  // Budget stats
  const startKey = `${inferredMonth}-start`;
  const initialBudget = dailyBalances[startKey]?.startingBalance || 0;
  const endingBalance = dailyBalances[lastDayKey]?.endingBalance ?? 0;
  const spent = initialBudget - endingBalance;

  // Projection for the current month: the pace so far (everything that left the
  // budget, over the days elapsed) carried from today's close to the month's end.
  const todayBalance = isCurrentMonth ? actualData[todayX]?.y : null;
  const hasProjection = todayBalance != null;
  const averageDailyBurn = hasProjection ? (initialBudget - todayBalance) / todayX : 0;
  const daysLeft = daysInMonth - todayX;
  const projectedDataWithNulls = hasProjection
    ? Array(todayX).fill(null).concat(
        [todayBalance],
        Array.from({ length: daysLeft }, (_, i) => Math.max(0, todayBalance - (i + 1) * averageDailyBurn))
      )
    : [];

  const firstNonNullIndex = projectedDataWithNulls.findIndex((v) => v !== null);
  const lastIndex = projectedDataWithNulls.length - 1;

  // Color reflects where the pace ACTUALLY lands, not the 0-clamped plot value —
  // Math.max(0, …) on plotted points made the "over budget" red unreachable.
  const endingProjectedUnclamped = hasProjection ? todayBalance - daysLeft * averageDailyBurn : 0;
  const projectionColor = endingProjectedUnclamped < 0 ? PALETTE.projectionOver : PALETTE.projectionOk;

  const projectedDataSeries = projectedDataWithNulls.map((val, idx) => ({
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
  const firstOverspentIdx = dayKeys.findIndex(key => dailyBalances[key].overspent);
  const zeroCrossingIndex = firstOverspentIdx >= 0 ? firstOverspentIdx + 1 : -1;
  const categories = [''].concat(Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString()));

  return {
    chart: { animation: false, marginTop: 50 },
    tooltip: {
      formatter: function () {
        if (!this.y && this.y !== 0) return false;
        const dayNum = parseInt(this.key) || this.x;
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
          if (isCurrentMonth && idx > todayX) {
            return { ...d, y: null };
          }
          return d;
        }),
        type: 'column',
        zIndex: 2,
        cursor: setDrawerContent ? 'pointer' : undefined,
        events: setDrawerContent ? {
          click: function (_e) {
            const header = `Day-to-day transactions for ${moment(inferredMonth).format('MMMM YYYY')}`;
            setDrawerContent({
              type: 'daytoday-month',
              title: header,
              month: inferredMonth
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
