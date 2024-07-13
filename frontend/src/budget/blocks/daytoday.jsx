import React, { useEffect, useState } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const daysInMonth = 31;
const today = 20; // Assume today's date is the 20th
const initialBudget = 1500;
const finalBudget = 500;

const generateActualData = (start, end, days) => {
    let data = [start]; // Start with initialBudget as the first value
    let diff = (start - end) / days;
    for (let i = 1; i < days; i++) { // Start loop from 1 since day 0 is already included
        let value = start - i * diff + Math.random() * 50 - 25; // Add some randomness
        data.push(value);
    }
    return data;
};

const actualData = generateActualData(initialBudget, finalBudget, today + 1); // Adjust to include day zero
const averageDailyBurn = (actualData[0] - actualData[today]) / today; // Adjust index for today
const projectedData = [actualData[today]].concat(
    Array.from({ length: daysInMonth - today  }, (_, i) => actualData[today] - (i + 1) * averageDailyBurn)
);

// Generate the baseline data
const generateBaselineData = (start, days) => {
    let data = [];
    let dailyDecrease = start / (days);
    for (let i = 0; i <= days; i++) {
        data.push(start - i * dailyDecrease);
    }
    return data;
};
const baselineData = generateBaselineData(initialBudget, daysInMonth);

// No need to add "day zero" to the baseline data
const projectedDataWithZero = [null].concat(Array(today - 1).fill(null)).concat(projectedData);

// Find the index of the first non-null value in projectedDataWithZero
const firstNonNullIndex = projectedDataWithZero.findIndex(value => value !== null);
const lastIndex = projectedDataWithZero.length - 1;

// Customize the marker for the first non-null index
const projectedDataSeries = projectedDataWithZero.map((value, index) => ({
    y: value,
    marker: {
        enabled: index === firstNonNullIndex || lastIndex === index,
        radius: 4,
        fillColor: 'blue',
        symbol: index === firstNonNullIndex ? 'circle' : 'square'
    }
}))

const actualDataSeries = actualData.map((value, index) => ({
    y: value,
    color: //index === 0 || index === today ? 'blue' : undefined // Set color for day zero and today
        (()=>{
            if (index === today) return '#0077b6';
            if (!index) return 'black';
            return  '#0077b6`';

        })()
}));

const options = {
    title: {
        text: 'Your Main Title',
        align: 'right',
        verticalAlign: 'top',
        floating: true,
    },
    subtitle: {
        text: 'Your Subtitle',
        align: 'right',
        verticalAlign: 'top',
        y: 30, // Adjusts the position of the subtitle downwards
        floating: true,
    },
    xAxis: {
        categories: [''].concat(Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString())),
        tickInterval: 1
    },
    yAxis: {
        min: 0,
        max: initialBudget,
        title: {
            text: ''
        },
        labels: {
            formatter: function () {
                // Convert the number to a string and format it with commas
                const formattedNumber = this.axis.defaultLabelFormatter.call(this).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                return '$' + formattedNumber;
            }
        }
    },
    series: [{
        name: 'Baseline',
        data: baselineData,
        type: 'area',
        color: 'rgba(255, 0, 0, 0.1)',
        lineColor: 'rgba(255, 0, 0, 0.5)',
        marker: { enabled: false }
    }, {
        name: 'Actual Data',
        data: actualDataSeries,
        type: 'column',
        zIndex : 2,
    }, {
        name: 'Projected Data',
        data: projectedDataSeries,
        type: 'line',
        dashStyle: 'ShortDash',
        lineWidth: 2,
        color: 'blue'
    }],
    plotOptions: {
        series: {
            animation: false
        }
    },
    legend: { enabled: false },
    credits: { enabled: false }
};

export const BudgetBurnDownChart = ({ setDrawerContent }) => {
    const [budgetBlockDimensions, setBudgetBlockDimensions] = useState({ width: null, height: null });
    useEffect(() => {
        const handleResize = () => {
            const budgetBlock = document.querySelector('.budget-block-content');
            if (budgetBlock) {
                setBudgetBlockDimensions({
                    width: budgetBlock.clientWidth,
                    height: budgetBlock.clientHeight
                });
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    options.chart = {
        type: 'column',
        height: budgetBlockDimensions.height - 1,
        width: budgetBlockDimensions.width,
        backgroundColor: 'rgba(0,0,0,0)',
        animation: false,
    };

    return (
        <div className="budget-block">
            <h2>Monthly Budget Burn Down ({budgetBlockDimensions.width} x {budgetBlockDimensions.height})</h2>
            <div className="budget-block-content">
                <HighchartsReact
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
