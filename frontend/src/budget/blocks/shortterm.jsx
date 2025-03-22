import React, { useEffect, useState } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Drawer } from "../drawer";
import { formatAsCurrency } from "../blocks";
import moment from 'moment';

export function BudgetShortTerm({ setDrawerContent, budget, budgetBlockDimensions }) {

    const budgetKeys = Object.keys(budget);
    const [activeBudget] = budgetKeys;

    const shortTermBudget = budget[activeBudget].shortTermBuckets;
    const shortTermStatus = budget[activeBudget].shortTermStatus;
    const { budgetStart, budgetEnd } = budget[activeBudget];
    const buckets = Object.keys(shortTermBudget);

    const weekCount = moment(budgetEnd).diff(moment(budgetStart), 'weeks');
    const currentWeek = moment().diff(moment(budgetStart), 'weeks');
    const weeksLeft = weekCount - currentWeek;
    const currentTime = currentWeek / weekCount;

    const processedData = buckets.map((label) => {
        const item = shortTermBudget[label];
        const { budget, debits, credits, balance, transactions } = item;
        const extendedBudget = budget + credits;
        const overage = debits > extendedBudget ? debits - extendedBudget : 0;
        const spentWithinAllotted = Math.min(debits, extendedBudget);
        const remainingPortion = balance < 0 ? 0 : balance;

        return {
            category: label,
            extendedBudget,
            overage,
            allotted: spentWithinAllotted,
            remaining: remainingPortion,
            transactions,
            debits,
            credits,
            balance,
            budget
        };
    }).sort((a, b) => {
        if (a.category === 'Unbudgeted') return 1;
        if (a.extendedBudget > b.extendedBudget) return -1;
        if (a.extendedBudget < b.extendedBudget) return 1;
        return 0;
    });

    const series = [
        {
            name: 'allotted',
            data: processedData.map((item) => ({
                y: item.allotted,
                color: item.overage > 0 ? '#c1121f' : item.balance === 0 ? '#023e8a' : '#0077b6'
            })),
            stack: 'shortTerm'
        },
        {
            name: 'overage',
            data: processedData.map((item) => item.overage),
            color: '#82000A',
            stack: 'shortTerm'
        },
        {
            name: 'remaining',
            data: processedData.map((item) => item.remaining),
            color: '#AAAAAA',
            stack: 'shortTerm'
        },
    ];

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
                  <br/>
                  <small class="category-label" style="color:#AAA; font-size:0.7rem">
                    ${formatAsCurrency(item.budget)}
                    ${item.credits > 0 ? ` <b class='green' style="color:#759c82">+ ${formatAsCurrency(item.credits)}</b>` : ''}
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
                value: (1 - currentTime) * 100,
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
                const item = processedData[index];
                const spent = item.debits;
                const gained = item.credits;
                const count = item.transactions.length;
                const percentageSpent = item.extendedBudget > 0 ? Math.round((spent / item.extendedBudget) * 100) : 0;
                const rateRemaining = weeksLeft > 0 && item.remaining > 0
                  ? (item.remaining / weeksLeft).toFixed(0)
                  : 0;
                return `<b>${item.category}</b><br/>
                        ${count} transactions<br/>
                        ${100 - (percentageSpent||0)}% remaining<br/>
                        $${rateRemaining}/week`;
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
                    formatter: function () {
                        const item = processedData[this.point.index];
                        if (this.y === 0) return "";
                        if (this.series.name === 'allotted') {
                            return formatAsCurrency(item.allotted, false);
                        } else if (this.series.name === 'overage') {
                            return formatAsCurrency(item.overage, false);
                        } else if (this.series.name === 'remaining') {
                            return formatAsCurrency(item.remaining, false);
                        }
                    }
                },
                cursor: 'pointer',
                events: {
                    click: function (event) {
                        const category = processedData[event.point.index];
                        const content = (
                            <Drawer
                                header={category.category}
                                transactions={category.transactions}
                                setDrawerContent={setDrawerContent}
                            />
                        );
                        setDrawerContent({ jsx: content, meta: { title: category.category } });
                    }
                }
            }
        },
        series
    };

    function gatherTransactions(key) {
        const shortTermLabels = Object.keys(shortTermBudget);
        const alltransactions = shortTermLabels.reduce((acc, label) => {
            const item = shortTermBudget[label];
            return acc.concat(item.transactions);
        }, []).sort((b, a) => a.amount - b.amount);

        if (key === 'budget') return alltransactions;
        if (key === 'spent') return alltransactions.filter(transaction => transaction.expenseAmount > 0);
        if (key === 'gained') return alltransactions.filter(transaction => transaction.expenseAmount < 0);
        return [];
    }

    const handleStatusClick = (key) => {
        const transactions = gatherTransactions(key);
        const header = key === 'budget' ? 'Short Term Budget' : key === 'spent' ? 'Spent' : 'Gained';
        const content = <Drawer setDrawerContent={setDrawerContent} header={header} transactions={transactions} />;
        setDrawerContent({ jsx: content, meta: { title: header } });
    };

    const statusBadge = (
        <span className="status-badge">
            <span onClick={() => handleStatusClick('budget')} className="amount">
                {formatAsCurrency(shortTermStatus.budget)}
            </span> +
            <span onClick={() => handleStatusClick('gained')} className="gained">
                {formatAsCurrency(shortTermStatus.credits)}
            </span> -
            <span onClick={() => handleStatusClick('spent')} className="spent">
                {formatAsCurrency(shortTermStatus.debits)}
            </span> =
            <span className="remaining">
                {formatAsCurrency(shortTermStatus.balance)}
            </span>
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