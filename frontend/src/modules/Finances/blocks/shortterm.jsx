import React, { useMemo } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { formatAsCurrency } from "../blocks";
import { EmptyState } from "../EmptyState.jsx";
import { PALETTE } from "../lib/format.mjs";
import { budgetProgress } from "../lib/budgetMath.mjs";
import { useToday } from "../hooks/useToday.mjs";
import { pressable } from "../lib/a11y.mjs";

export const gatherShortTermTransactions = (budget, key) => {
  const shortTermBuckets = budget.shortTermBuckets || {};
  const all = Object.keys(shortTermBuckets)
    .reduce((acc, label) => acc.concat(shortTermBuckets[label].transactions), [])
    .sort((b, a) => a.amount - b.amount);
  if (key === 'budget') return all;
  if (key === 'spent') return all.filter(t => t.expenseAmount > 0);
  if (key === 'gained') return all.filter(t => t.expenseAmount < 0);
  return [];
};

export function BudgetShortTerm({ setDrawerContent, budget }) {


    const { budgetStart, budgetEnd } = budget;
    const shortTermBuckets = budget.shortTermBuckets || {};
    const shortTermStatus = budget.shortTermStatus || { budget: 0, credits: 0, debits: 0, balance: 0 };
    const buckets = Object.keys(shortTermBuckets);
    const today = useToday();

    const { processedData, options } = useMemo(() => {
    const { weeksLeft, progress } = budgetProgress(budgetStart, budgetEnd);

    const processedData = buckets.map((label) => {
        const item = shortTermBuckets[label];
        const { budget, debits, credits, balance, transactions } = item;
        const extendedBudget = budget + credits;
        const snapped = balance === 0 && debits > 0;
        const overage = snapped ? 0 : (debits > extendedBudget ? parseFloat((debits - extendedBudget).toFixed(2)) : 0);
        const spentWithinAllotted = snapped ? debits : Math.min(debits, extendedBudget);
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
        if (b.category === 'Unbudgeted') return -1;
        return b.extendedBudget - a.extendedBudget;
    });

    const series = [
        {
            name: 'allotted',
            data: processedData.map((item) => ({
                y: item.allotted,
                color: item.overage > 0 ? PALETTE.over : item.balance === 0 ? PALETTE.spentDone : PALETTE.spent
            })),
            stack: 'shortTerm'
        },
        {
            name: 'overage',
            data: processedData.map((item) => item.overage),
            color: PALETTE.overDark,
            stack: 'shortTerm'
        },
        {
            name: 'remaining',
            data: processedData.map((item) => item.remaining),
            color: PALETTE.remaining,
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
                    ${item.credits > 0 ? ` <b class='green' style="color:${PALETTE.gain}">+ ${formatAsCurrency(item.credits)}</b>` : ''}
                  </small>
                </div>`),
            labels: { useHTML: true },
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
                value: (1 - progress) * 100,
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
                        ${Math.max(0, 100 - (percentageSpent || 0))}% remaining<br/>
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
                        setDrawerContent({ type: 'shortterm-bucket', title: category.category, bucket: category.category });
                    }
                }
            }
        },
        series
    };
    return { processedData, options };
    }, [budget, setDrawerContent, today]);

    if (buckets.length === 0) {
        return (<div className="budget-block"><h2>Short Term Savings</h2><EmptyState /></div>);
    }

    const handleStatusClick = (key) => {
        const header = key === 'budget' ? 'Short Term Budget' : key === 'spent' ? 'Spent' : 'Gained';
        setDrawerContent({ type: 'shortterm-status', title: header, statusKey: key });
    };

    const statusBadge = (
        <span className="status-badge">
            <span {...pressable(() => handleStatusClick('budget'), { className: 'amount' })}>
                {formatAsCurrency(shortTermStatus.budget)}
            </span> +
            <span {...pressable(() => handleStatusClick('gained'), { className: 'gained' })}>
                {formatAsCurrency(shortTermStatus.credits)}
            </span> -
            <span {...pressable(() => handleStatusClick('spent'), { className: 'spent' })}>
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
                <div className="status-badge-row">
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