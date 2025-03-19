import React, { useEffect, useState } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import moment from 'moment';
import { MonthTabs } from "./monthly";
import { Drawer } from "../drawer";
import { DaylightAPI } from "../../lib/api.mjs";

const formatAsCurrency = (value) => {
  if (!value && value !== 0) return '$Ø';
  return `$${value.toLocaleString()}`;
};

export const BudgetDayToDayChart = ({ monthData: monthDataInput, setDrawerContent, budgetBlockDimensions }) => {

    setDrawerContent = setDrawerContent || (() => {});
    budgetBlockDimensions = budgetBlockDimensions || { width: 600, height: 400 };

    const[monthData, setMonthData] = useState(monthDataInput);

    useEffect(() => {
        DaylightAPI("data/budget/daytoday")
            .then((data) => setMonthData(data));
    }, [monthDataInput]);

    if (!monthData) {
        return <div>Loading...</div>;
    }

  const { transactions, dailyBalances } = monthData;
  if (!dailyBalances) {
    return null;
  }

  const dayDates = Object.keys(dailyBalances).sort();
  if (dayDates.length === 0) {
    return null;
  }

  const firstDay = dayDates[0];
  const lastDay = dayDates[dayDates.length - 1];
  const activeMonth = firstDay.slice(0, 7);
  const currentMonth = moment().format("YYYY-MM");
  const activeMonthIsCurrentMonth = activeMonth === currentMonth;
  const todayDateStr = moment().format("YYYY-MM-DD");
  const todayIndex = dayDates.indexOf(todayDateStr) + 1;
  const daysInMonth = dayDates.length -1;

  const start = dailyBalances[firstDay].startingBalance;
  const end = dailyBalances[lastDay].endingBalance;
  const spent = start - end;

  const actualData = dayDates.map((date) => {
    const day = moment(date);
    const dayOfMonth = parseInt(day.format("D"), 10);
    const isMonday = day.day() === 1;
    const isToday = date === todayDateStr && activeMonthIsCurrentMonth;
    return {
      y: dailyBalances[date].endingBalance,
      color: isToday ? '#0077b6' : (isMonday ? '#777' : undefined),
      dayOfMonth,
      date
    };
  });

  const zeroCrossingIndex = actualData.findIndex((d) => d.y < 0);

  const initialBudget = dailyBalances[firstDay].startingBalance;
  let averageDailyBurn = 0;
  if (todayIndex >= 0 && todayIndex <= dayDates.length - 1) {
    averageDailyBurn = (actualData[0].y - actualData[todayIndex].y) / (todayIndex + 1);
  }

  const projectedData = [];
  if (todayIndex >= 0 && todayIndex < dayDates.length) {
    const currentBalance = actualData[todayIndex].y;
    projectedData.push(currentBalance);
    const daysLeft = (dayDates.length - 1) - todayIndex;
    for (let i = 1; i <= daysLeft; i++) {
      projectedData.push(currentBalance - i * averageDailyBurn);
    }
  }
  const projectedDataWithNulls = new Array(Math.max(0, todayIndex)).fill(null).concat(projectedData);

  const firstNonNullIndex = projectedDataWithNulls.findIndex((v) => v !== null);
  const lastIndex = projectedDataWithNulls.length - 1;
  const projectedDataSeries = projectedDataWithNulls.map((value, idx) => ({
    y: value,
    marker: {
      enabled: idx === firstNonNullIndex || idx === lastIndex,
      radius: 4,
      fillColor: 'blue',
      symbol: idx === firstNonNullIndex ? 'circle' : 'square'
    }
  }));

  const baselineData = [];
  for (let i = 0; i <= daysInMonth; i++) {
    baselineData.push(initialBudget - i * (initialBudget / daysInMonth));
  }

  const options = {
    chart: {
      animation: false,
      marginTop: 50,
      width: budgetBlockDimensions.width,
      height: budgetBlockDimensions.height
    },
    title: {
      text: moment(activeMonth).format("MMMM YYYY"),
      align: 'right',
      verticalAlign: 'top',
      floating: true
    },
    subtitle: {
      text: `Spent: ${formatAsCurrency(spent)} | Remaining: ${formatAsCurrency(end)} | Budget: ${formatAsCurrency(start)}`,
      align: 'right',
      verticalAlign: 'top',
      y: 30,
      floating: true
    },
    xAxis: {
      categories: [''].concat(
        [...Array(daysInMonth).keys()].map((i) => (i + 1).toString())
      ),
      labels: {
        formatter: function () {
          const isMonday = moment(activeMonth).date(this.value).day() === 1;
          const isLastDay = parseInt(this.value, 10) === daysInMonth;
          return isMonday || isLastDay ? this.value : '';
        }
      },
      tickPositions: [...Array(daysInMonth).keys()]
        .map((i) => {
          const dayObj = moment(activeMonth).date(i + 1);
          const isMonday = dayObj.day() === 1;
          const isLastDay = (i + 1) === daysInMonth;
          const isFirstDay = i === 0;
          return isFirstDay || isMonday || isLastDay ? i + 1 : null;
        })
        .filter(Boolean),
      plotLines: [...Array(daysInMonth).keys()]
        .map((i) => {
          const dayObj = moment(activeMonth).date(i + 1);
          return dayObj.day() === 1 ? { color: '#EEE', width: 1, value: i + 1 } : null;
        })
        .filter(Boolean),
      plotBands: zeroCrossingIndex >= 0
        ? [
            {
              from: zeroCrossingIndex,
              to: daysInMonth,
              color: 'rgba(255, 0, 0, 0.1)',
              max: 0
            }
          ]
        : []
    },
    yAxis: {
      min: Math.min(0, end),
      max: start,
      title: { text: '' },
      labels: {
        formatter: function () {
          const formattedNumber = this.axis.defaultLabelFormatter
            .call(this)
            .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          return '$' + formattedNumber;
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
        states: {
          hover: { enabled: false }
        }
      },
      {
        name: 'Actual Data',
        data: [
          { y: start, color: '#0077b6' },
          ...actualData.map((d) => d)
        ].map((point, idx) => {
          if (idx === 0) return point;
          const dayOfMonth = point.dayOfMonth || idx;
          const hideFuture = activeMonthIsCurrentMonth && dayOfMonth > moment().date();
          return {
            ...point,
            y: hideFuture ? null : point.y
          };
        }),
        type: 'column',
        zIndex: 2,
        cursor: 'pointer',
        events: {
          click: function (event) {
            const header = `Day-to-day transactions for ${moment(activeMonth).format("MMMM YYYY")}`;
            const content = (
              <Drawer
                setDrawerContent={setDrawerContent}
                header={header}
                transactions={transactions}
                highlightDate={event.point.category}
              />
            );
            setDrawerContent({ jsx: content, meta: { title: header } });
          }
        }
      },
      {
        name: 'Projected Data',
        data: activeMonthIsCurrentMonth ? projectedDataSeries : [],
        type: 'line',
        dashStyle: 'ShortDash',
        lineWidth: 2,
        color: 'blue'
      }
    ],
    plotOptions: {
      series: { animation: false }
    },
    legend: { enabled: false },
    credits: { enabled: false }
  };

  return <HighchartsReact highcharts={Highcharts} options={options} />;
};

export const BudgetDayToDay = ({ setDrawerContent, budget, budgetBlockDimensions }) => {
  const budgetKeys = Object.keys(budget);
  const months = budgetKeys
    .map((key) => budget[key].monthlyBudget)
    .reduce((acc, monthlyBudget) => ({ ...acc, ...monthlyBudget }), {});
  const monthKeys = Object.keys(months);
  const currentMonth = moment().format("YYYY-MM");
  const [activeMonth, setActiveMonth] = useState(currentMonth);
  const nonFutureMonths = monthKeys.filter((m) => m <= currentMonth);
  const dayToDayForActive = budget[budgetKeys[0]]?.dayToDayBudget[activeMonth];

  if (!dayToDayForActive) {
    return (
      <div className="budget-block">
        <h2>Day-to-day Spending</h2>
        <div className="budget-block-content">
          <MonthTabs
            monthKeys={nonFutureMonths}
            activeMonth={activeMonth}
            setActiveMonth={setActiveMonth}
          />
          <p>No data available for this month.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="budget-block">
      <h2>Day-to-day Spending</h2>
      <div className="budget-block-content">
        <MonthTabs
          monthKeys={nonFutureMonths}
          activeMonth={activeMonth}
          setActiveMonth={setActiveMonth}
        />
        <BudgetDayToDayChart
          monthData={dayToDayForActive}
          setDrawerContent={setDrawerContent}
          budgetBlockDimensions={budgetBlockDimensions}
        />
      </div>
    </div>
  );
};