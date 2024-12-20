import React, { useEffect, useState } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { MonthTabs } from "./monthly";
import { Drawer } from "../drawer";
import moment from 'moment';

const formatAsCurrency = (value) => {
    if (!value) return `$Ø`;
    return `$${value.toLocaleString()}`;
};


export const BudgetDayToDay = ({ setDrawerContent, budget, budgetBlockDimensions }) => {

    const budgetKeys = Object.keys(budget);
    const months = budgetKeys.map((key) => budget[key].monthlyBudget).reduce((acc, months) => {
        return { ...acc, ...months };
    }, {});
    const monthKeys = Object.keys(months);
    const currentMonth = moment().format("YYYY-MM");
    const [activeMonth, setActiveMonth] = useState(currentMonth);
    const nonFutureMonths = monthKeys.filter((month) => month <= currentMonth);

    const activeMonthTransactions = budget[budgetKeys[0]].dayToDayBudget[activeMonth].transactions;

    const monthHeader = <MonthTabs monthKeys={nonFutureMonths} activeMonth={activeMonth} setActiveMonth={setActiveMonth} />;

    const activeMonthDailyBudget = budget[budgetKeys[0]].dayToDayBudget[activeMonth].dailyBalances;
    const daysInMonth = Object.keys(activeMonthDailyBudget).length;
    const today = moment().date();
    const activeMonthIsCurrentMonth = activeMonth === currentMonth;
    const actualData = Object.keys(activeMonthDailyBudget).map((date, index) => {
        const isMonday = moment(date).day() === 1;
        return {
            y: activeMonthDailyBudget[date].endingBalance,
            color: (index === today && activeMonthIsCurrentMonth) ? '#0077b6' : (isMonday ? '#777' : undefined)
        };
    });
    
    const initialBudget = activeMonthDailyBudget[Object.keys(activeMonthDailyBudget)[0]].startingBalance;

    const averageDailyBurn = (actualData[0].y - actualData[today].y) / (today + 1);
    const projectedData = [actualData[today].y].concat(
        Array.from({ length: daysInMonth - today  }, (_, i) => actualData[today].y - (i + 1) * averageDailyBurn)
    );

    const projectedDataWithZero = Array(today).fill(null).concat(projectedData);
    const firstNonNullIndex = projectedDataWithZero.findIndex(value => value !== null);
    const lastIndex = projectedDataWithZero.length - 1;

    const projectedDataSeries = projectedDataWithZero.map((value, index) => ({
        y: value,
        marker: {
            enabled: index === firstNonNullIndex || lastIndex === index,
            radius: 4,
            fillColor: 'blue',
            symbol: index === firstNonNullIndex ? 'circle' : 'square'
        }
    }));

    const baselineData = Array.from({ length: daysInMonth +1 }, (_, i) => initialBudget - (i * (initialBudget / daysInMonth)));
    const zeroCrossingIndex = actualData.findIndex(data => data.y < 0);
    const start = activeMonthDailyBudget[Object.keys(activeMonthDailyBudget)[0]].startingBalance;
    const end = activeMonthDailyBudget[Object.keys(activeMonthDailyBudget)[Object.keys(activeMonthDailyBudget).length - 1]].endingBalance;
    const spent = start - end;
    const endingBalance = activeMonthDailyBudget[Object.keys(activeMonthDailyBudget)[Object.keys(activeMonthDailyBudget).length - 1]].endingBalance;
    const options = {
        chart: {
            animation: false,
            //padding top
            marginTop: 50,
        },
        title: {
            text: `${moment(activeMonth).format("MMMM YYYY")}`,
            align: 'right',
            verticalAlign: 'top',
            floating: true,
        },
        subtitle: {
            text: `Spent: ${formatAsCurrency(spent)} | Remaining: ${formatAsCurrency(end)} | Budget: ${formatAsCurrency(start)}`,
            align: 'right',
            verticalAlign: 'top',
            y: 30,
            floating: true,
        },

        xAxis: {
            categories: [''].concat(Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString())),
            labels: {
                formatter: function () {
                    const date = moment(activeMonth).date(this.value);
                    const isMonday = date.day() === 1;
                    const isLastDay = this.value == daysInMonth;
                    return isMonday || isLastDay ? this.value : '';
                }
            },
            tickPositions: Array.from({ length: daysInMonth }, (_, i) => {
                const date = moment(activeMonth).date(i + 1);
                const isMonday = date.day() === 1;
                const isLastDay = i + 1 === daysInMonth;
                const isFirstDay = i === 0;
                return isFirstDay || isMonday || isLastDay ? i + 1 : null;
            }).filter(Boolean),
            plotLines: Array.from({ length: daysInMonth }, (_, i) => {
                const date = moment(activeMonth).date(i + 1);
                const isMonday = date.day() === 1;
                return isMonday ? { color: '#EEE', width: 1, value: i + 1 } : null;
            }).filter(Boolean),
            plotBands: zeroCrossingIndex >= 0  ? [
                {
                    from: zeroCrossingIndex >= 0 ? zeroCrossingIndex : daysInMonth,
                    to: daysInMonth,
                    color: 'rgba(255, 0, 0, 0.1)', // Red
                    max: 0
                }
            ] : []
        },
        yAxis: {
            min: Math.min(0, endingBalance),
            max: initialBudget,
            title: { text: '' },
            labels: {
                formatter: function () {
                    const formattedNumber = this.axis.defaultLabelFormatter.call(this).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                    return '$' + formattedNumber;
                }
            },
            gridLineWidth: 0
        },
        series: [{
            name: 'Baseline',
            data: baselineData,
            type: 'area',
            color: 'rgba(255, 0, 0, 0.1)',
            lineColor: 'rgba(255, 0, 0, 0.5)',
            marker: { enabled: false },
            enableMouseTracking: false,
            states: {
                hover: {
                    enabled: false
                }
            }
        }, {
            name: 'Actual Data',
            data: [{
                y: initialBudget,
                color: '#0077b6'
            },...actualData].map((data, index) => ({
                ...data,
                y: activeMonth === currentMonth && index > today ? null : data.y
            })),
            type: 'column',
            zIndex: 2,
            cursor: 'pointer',
            events: {
                click: function (event) {
                    const header = `Day-to-day transactions for ${moment(activeMonth).format("MMMM YYYY")}`;
                    const content = <Drawer setDrawerContent={setDrawerContent} header={header} transactions={activeMonthTransactions} highlightDate={event.point.category} />;
                    setDrawerContent({ jsx: content, meta: { title: header } });
                }
            }
        }, {
            name: 'Projected Data',
            data: activeMonth === currentMonth ? projectedDataSeries : [],
            type: 'line',
            dashStyle: 'ShortDash',
            lineWidth: 2,
            color: 'blue'
        }],
        plotOptions: {
            series: { animation: false }
        },
        legend: { enabled: false },
        credits: { enabled: false }
    };

    return (
        <div className="budget-block">
            <h2>Day-to-day Spending</h2>
            <div className="budget-block-content">
                {monthHeader}
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
};
