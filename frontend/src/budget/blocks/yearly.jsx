import React, { useEffect, useState } from "react";
import Highcharts, { attr } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';


export function BudgetYearly({ setDrawerContent, budget }) {

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


    const categories = [
        { "Spent": "#0077b6" },
        { "Planned": "#90e0ef" },
        { "Remaining": "#AAAAAA" },
        { "Over": "red" }
    ];

    const currentTime = 0.6;

    const data = [
        {
            category: 'Air Travel',
            budget: 1000,
            numbers: { Spent: 1200, Planned: 100, Remaining: 300, Over: 0 },
            subtitle: 'Air travel expenses',
            count: 4
        },
        {
            category: 'Furniture',
            budget: 1000,
            numbers: { Spent: 1900, Planned: 0, Remaining: 100, Over: 0 },
            subtitle: 'Furniture expenses',
            count: 3
        },
        {
            category: 'Clothing',
            budget: 1000,
            numbers: { Spent: 400, Planned: 0, Remaining: 600, Over: 0 },
            subtitle: 'Clothing expenses',
            count: 3
        },
        {
            category: 'Housewares',
            budget: 1000,
            numbers: { Spent: 1000, Planned: 0, Remaining: 500, Over: 0 },
            subtitle: 'Housewares expenses',
            count: 3
        },
        {
            category: 'Electronics',
            budget: 1000,
            numbers: { Spent: 800, Planned: 0, Remaining: 200, Over: 0 },
            subtitle: 'Electronics expenses',
            count: 3
        },
        {
            category: 'Groceries',
            budget: 1000,
            numbers: { Spent: 750, Planned: 0, Remaining: 0, Over: 100 },
            subtitle: 'Groceries expenses',
            count: 4
        },
    ];

    // Ensure all data points are valid
    const processedData = data.map(item => ({
        ...item,
        numbers: Object.keys(item.numbers).reduce((prev, key) => {
            prev[key] = isNaN(item.numbers[key]) ? 0 : item.numbers[key];
            return prev;
        }, {})
    }));

    const series = categories.reverse().map(cat => {
        const [category, color] = Object.entries(cat)[0];
        return {
            name: category,
            color: color,
            data: processedData.map(item => item.numbers[category])
        };
    });

    const options = {
        chart: {
            type: 'bar',
            height: budgetBlockDimensions.height - 1,
            width: budgetBlockDimensions.width,
            backgroundColor: 'rgba(0,0,0,0)',
            animation: false,
        },
        title: { text: '' },
        xAxis: {
            categories: processedData.map(item => `
                <div style="margin:0; padding:0; display:flex; flex-direction:column; align-items:center; justify-content:center">
                <b class="category-label">${item.category}</b>
                <br/><small class="category-label" style="color:#AAA; font-size:0.7rem">${formatAsCurrency(item.budget)}</small>
                </div>`),
            reversed: true
        },
        yAxis: {
            visible: true,
            title: { text: null },
            labels: { enabled: false },
            gridLineWidth: 0,
            tickWidth: 0,
            plotLines: [{
                color: '#EEEEEE',
                value: currentTime * 100,
                width: 1.5,
                dashStyle: 'dash',
                zIndex: 5
            }]
        },
        legend: { enabled: false },
        credits: { enabled: false },
        tooltip: {
            shared: true,
            formatter: function () {
                const index = this.points[0].point.index;
                const { category, count } = processedData[index];
                return `<b>${category}</b><br/>${count} transactions`;
            }
        },
        plotOptions: {
            series: {
                animation: false,
                stacking: 'percent',
                pointPadding: 0,
                groupPadding: 0.05,
                dataLabels: {
                    enabled: true,
                    style: {
                        fontFamily: 'Roboto Condensed',
                        fontSize: '0.8em',
                        textOutline: '2px #00000077',
                        color: '#FFFFFF'
                    },
                    formatter: function() {
                        return this.y !== 0 ? `$${this.y.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` : null;
                    }
                },
                cursor: 'pointer',
                events: {
                    click: function (event) {
                        const category = processedData[event.point.index];
                        setDrawerContent(
                            <div>
                                <h3>{category.category}</h3>
                                <p>{category.subtitle}</p>
                                <p>{category.count} transactions</p>
                            </div>
                        );
                    }
                }
            }
        },
        series: series
    };
    

    function formatAsCurrency(value) {
        return `$${value.toLocaleString()}`;
    }

    function handleRowClick(data) {
        // Example callback function, adjust as needed
        console.log('Row clicked:', data);
        setDrawerContent(data); // Assuming setDrawerContent updates some drawer content with the clicked data
    }

    return (
        <div className="budget-block">
            <h2>Yearly Expenses ({budgetBlockDimensions.width} x {budgetBlockDimensions.height})</h2>
            <div className="budget-block-content">
                <HighchartsReact
                    highcharts={Highcharts}
                    options={options}
                />
            </div>
        </div>
    );
}