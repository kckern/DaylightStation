import React, { useEffect, useState } from "react";
import Highcharts, { attr } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Drawer } from "../drawer";

function formatAsCurrency(value) {
    return `$${(value||0).toLocaleString()}`;
}

export function BudgetYearly({ setDrawerContent, budget, budgetBlockDimensions }) {

    const budgetKeys = Object.keys(budget);
    const [activeBudget] = budgetKeys;

    const shortTermBudget = budget[activeBudget].shortTermBudget;
    const shortTermStatus = budget[activeBudget].shortTermStatus;


    const colors = {
        spent: "#0077b6",
        planned: "#90e0ef",
        remaining: "#AAAAAA"
      };

    const currentTime = 0.6;


    // Ensure all data points are valid
    const processedData = shortTermBudget.map((item) => {
        const { amount, spent, remaining, planned, over, transactions, category } = item;


        return {
            category,
            amount,
             spent,
             planned,
             remaining,
             over,
             count: transactions.length,
             transactions
        };
    });


    const series = Object.keys(colors).map((key) => {
      
      const data = processedData.map((item) => {

        const isOver = item.over > 0;
        const isSpent = key === 'spent';
        if (isOver && isSpent) {
          //override color and make it red
            return {
                y: item[key],
                color: '#c1121f'
            };
        }

        return item[key];
      })
      return {
        name: key,
        data: data,
        color: colors[key] || '#000000',
      };
    }
    );


    const options = {
        chart: {
            type: 'bar',
            height: budgetBlockDimensions.height - 50,
            width: budgetBlockDimensions.width,
            backgroundColor: 'rgba(0,0,0,0)',
            animation: false,
        },
        title: { text: '' },
        xAxis: {
            categories: processedData.map(item => `
                <div style="margin:0; padding:0; display:flex; flex-direction:column; align-items:center; justify-content:center">
                <b class="category-label">${item.category}</b>
                <br/><small class="category-label" style="color:#AAA; font-size:0.7rem">${formatAsCurrency(item.amount)}</small>
                </div>`),
            reversed: true
        },
        yAxis: {
            visible: true,
            title: { text: null },
            labels: { enabled: false },
            reversed: true,
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
                        setDrawerContent(<Drawer  header={category.category} transactions={category.transactions}  setDrawerContent={setDrawerContent} /> );
                    }
                }
            }
        },
        series: series
    };
    


    function handleRowClick(data) {
        // Example callback function, adjust as needed
        console.log('Row clicked:', data);
        setDrawerContent(data); // Assuming setDrawerContent updates some drawer content with the clicked data
    }


    const statusBadge = (
        <span className="status-badge">
            <span className="amount">${Math.round(shortTermStatus.amount).toLocaleString()}</span> +
            <span className="gained"> ${Math.round(shortTermStatus.gained).toLocaleString()}</span> −
            <span className="spent"> ${Math.round(shortTermStatus.spent).toLocaleString()}</span> = 
            <span className="remaining">${Math.round(shortTermStatus.remaining).toLocaleString()}</span>
        </span>
    );

    return (
        <div className="budget-block">
            <h2>Short Term Expenses</h2>
            <div className="budget-block-content">
                <div className="status-badge" style={{ textAlign: 'center' }}>
                {statusBadge}
                </div>
                <HighchartsReact
                    highcharts={Highcharts}
                    options={options}
                />
            </div>
        </div>
    );
}