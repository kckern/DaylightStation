import moment from "moment";
import React, { useEffect, useState } from "react";
import Highcharts, { attr } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const currentTime = 0.6;
function formatAsCurrency(value) {
    if (!value) return `$Ø`;
    return `$${value.toLocaleString()}`;
}
  
  
  export function BudgetMonthOverMonth({ setDrawerContent, budget , budgetBlockDimensions}) {
  
    const budgetKeys = Object.keys(budget);
    const months = budgetKeys.map((key) => budget[key].monthlyBudget).reduce((acc, months) => {
      return {...acc, ...months};
    }, {});
    const monthKeys = Object.keys(months);
      const currentMonth = moment().format("YYYY-MM");
      const [activeMonth, setActiveMonth] = useState(currentMonth);
      const nonFutureMonths = monthKeys.filter((month) => month <= currentMonth);
  
  
      const monthHeader = <MonthTabs monthKeys={nonFutureMonths}  activeMonth={activeMonth} setActiveMonth={setActiveMonth} />;
  
    const { categories } = months[activeMonth];
    const catKeys = Object.keys(categories);
    const processedData = catKeys.map((category) => {
        const { amount, remaining, transactions } = categories[category];
        const spent = amount - remaining;
        const planned = amount;
        const over = spent > planned ? spent - planned : 0;

        return {
            category,
            Spent: spent,
            Planned: planned,
            Remaining: remaining,
            Over: over
        };
    });

    const series = [
        { name: "Spent", color: "#0077b6" },
        { name: "Planned", color: "#90e0ef" },
        { name: "Remaining", color: "#AAAAAA" },
        { name: "Over", color: "red" }
    ].map(serie => ({
        ...serie,
        data: processedData.map(item => item[serie.name])
    }));
 

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
  
      return (
        <div className="budget-block">
          <h2>Fixed Expenses</h2>
          <div className="budget-block-content">
            {monthHeader}
            <HighchartsReact
                    highcharts={Highcharts}
                    options={options}
                />
          </div>
        </div>
      );
    }



const MonthTabs = ({monthKeys, activeMonth, setActiveMonth}) => {
    const recentMonths = monthKeys.slice(-6); // Get the most recent 6 months
    const olderMonths = monthKeys.slice(0, -6); // Get the rest
  
  
    return (
        <div className="month-header">
          {recentMonths.map((month) => {
            const monthLabel = moment(month, "YYYY-MM").format("MMM ‘YY");
            return <div key={monthLabel} onClick={() => setActiveMonth(month)}  className={activeMonth === month ? "month active" : "month"}>
              {monthLabel}</div>
          })}
          {olderMonths.length > 0 && (
            <div className="dropdown">
              <button className="dropbtn">Older Months</button>
              <div className="dropdown-content">
                {olderMonths.map((month) => {
                  const monthLabel = moment(month, "YYYY-MM").format("MMM ‘YY");
                  return <a key={monthLabel} href="#">{monthLabel}</a>
                })}
              </div>
            </div>
          )}
        </div>
    );
  };
  