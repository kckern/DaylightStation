import React, { useEffect, useState } from "react";
import Highcharts, { attr } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Drawer } from "../drawer";
import { formatAsCurrency } from "../blocks";
import moment from "moment";






export function BudgetShortTerm({ setDrawerContent, budget, budgetBlockDimensions }) {

    const budgetKeys = Object.keys(budget);
    const [activeBudget] = budgetKeys;
    

    const shortTermBudget = budget[activeBudget].shortTermBuckets;
    const shortTermStatus = budget[activeBudget].shortTermStatus;
    const {budgetStart, budgetEnd} = budget[activeBudget];
    const buckets = Object.keys(shortTermBudget);

    const colors = {
        spent: "#0077b6",
        planned: "#90e0ef",
        remaining: "#AAAAAA"
      };
    
    const weekCount = moment(budgetEnd).diff(moment(budgetStart), 'weeks');
    const currentWeek = moment().diff(moment(budgetStart), 'weeks');
    const weeksLeft = weekCount - currentWeek;
    const currentTime = (currentWeek / weekCount);
      
    // Ensure all data points are valid
    const processedData = buckets.map((label) => {
        const item = shortTermBudget[label];
        const { budget, spending, credits, debits, balance, transactions } = item;

        const over = balance < 0 ? Math.abs(balance) : 0;
        const remaining = Math.max(0, balance);
        const extendedBudget = budget + credits;
        const perc = budget > 0 ? Math.min(100, Math.round((debits / extendedBudget) * 100)) : 0;

        return {
             category: label,
             amount: budget,
             percentage: perc,
             spent: debits,
             gained: credits,
             planned: 0, //todo integrate planned
             remaining,
             over,
             extendedBudget,
             rateRemaining: parseFloat((remaining / weeksLeft).toFixed(0)),
             count: transactions.length,
             transactions
        };

    }).sort((a, b) => {

        //sort by percentage
        if (a.extendedBudget > b.extendedBudget) return -1;
        if (a.extendedBudget < b.extendedBudget) return 1;
        return 0;


    });


    const series = Object.keys(colors).map((key) => {
      
      const data = processedData.map((item) => {

        const isOver = item.over > 0;
        const isSpent = key === 'spent';
        if (isOver && isSpent) {
          //override color and make it red
            return {
                y: item[key],
                color: '#c1121f',
                label: `OVER`
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
            backgroundColor: 'rgba(0,0,0,0)',
            animation: false,
        },
        title: { text: '' },
        xAxis: {
            categories: processedData.map(item => `
                <div style="margin:0; padding:0; display:flex; flex-direction:column; align-items:center; justify-content:center">
                <b class="category-label">${item.category}</b>
                <br/><small class="category-label" style="color:#AAA; font-size:0.7rem">${formatAsCurrency(item.amount)}${item.gained > 0 ? ` <b class='green' style="color:#759c82"  >+ ${formatAsCurrency(item.gained)}` : ''}</b>
                </small>
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
                const { category, count, percentage, rateRemaining } = processedData[index];
                return `<b>${category}</b><br/>${count} transactions<br/>${100-(percentage||0)}% remaining<br/>$${rateRemaining}/week`;
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
                      if(this.y === 0) return "";
                      const item = processedData[this.point.index];
                      const seriesName = this.series.name;
                      if(seriesName === 'over') {
                        return formatAsCurrency(item.over,false);
                      }else{
                        return formatAsCurrency(item[seriesName],false);
                      }
                    }
                },
                cursor: 'pointer',
                events: {
                    click: function (event) {
                        const category = processedData[event.point.index];
                        const content = <Drawer  header={category.category} transactions={category.transactions}  setDrawerContent={setDrawerContent} />;
                        setDrawerContent({jsx: content, meta: {title: category.category}});
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

    const gatherTransactions = (key) => {
        const shortTermLabels = Object.keys(shortTermBudget);
        const alltransactions = shortTermLabels.reduce((acc, label) => {
            const item = shortTermBudget[label];
            return acc.concat(item.transactions);
        }, []).sort((b, a) => a.amount - b.amount);
        if(key === 'budget') return alltransactions;
        if(key === 'spent') return alltransactions.filter(transaction => transaction.expenseAmount > 0);
        if(key === 'gained') return alltransactions.filter(transaction => transaction.expenseAmount < 0)
    }

    const handleStatusClick = (key) => {
        const transactions = gatherTransactions(key);
        const header = key === 'budget' ? 'Short Term Budget' : key === 'spent' ? 'Spent' : 'Gained';
        const content = <Drawer setDrawerContent={setDrawerContent} header={header} transactions={transactions} />;
        setDrawerContent({jsx: content, meta: {title: header}});
    }

    const statusBadge = (
        <span className="status-badge">
            <span 
            onClick={() => handleStatusClick('budget')}
            className="amount">{formatAsCurrency(shortTermStatus.budget)}</span> +
            <span onClick={() => handleStatusClick('gained')}
            className="gained"> {formatAsCurrency(shortTermStatus.credits)}</span> -
            <span 
            onClick={() => handleStatusClick('spent')}

            className="spent"> {formatAsCurrency(shortTermStatus.debits)}</span> =
            <span className="remaining"> {formatAsCurrency(shortTermStatus.balance)}</span>
        </span>
    );

    return (
        <div className="budget-block">
            <h2>Short Term Savings</h2>
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