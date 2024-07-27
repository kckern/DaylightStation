import moment from "moment";
import React, { useEffect, useState } from "react";
import Highcharts, { attr } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Drawer } from "../drawer";

const currentDayOfMonth = moment().format("DD");
const daysInMonth = moment().daysInMonth();
const currentTime = parseFloat(currentDayOfMonth) / daysInMonth;
export function formatAsCurrency(value, showcents=true) {
    if (!value) return `$Ø`;
    if (showcents) {
        return `$${value.toFixed(2).toLocaleString()}`;
    }
    return `$${Math.round(value).toLocaleString()}`;
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
        const { amount, spent, remaining, planned, over, transactions, balanced } = categories[category];


        return {
            category,
            amount,
             spent,
             planned,
             remaining,
             over,
             count: transactions.length,
             transactions,
              balanced
        };
    });


    const colors = {
      spent: "#0077b6",
      planned: "#90e0ef",
      remaining: "#AAAAAA"
    };

    const series = Object.keys(colors).map((key) => {
      const data = processedData.map((item) => {
        const isBalanced = item.balanced;
        const isOver = item.over > 1;
        const isSpent = key === 'spent';
        if(isBalanced){
          return {
            y: item[key],
            color: '#63af90',
            label: `BALANCED`
          };
        }
        else if (isOver && isSpent) {
          // Override color and make it red
          return {
            y: item[key],
            color: '#c1121f',
            label: `OVER`
          };
        }
        return item[key];
      });
      return {
        name: key,
        data: data,
        color: colors[key] || '#000000',
      };
    });

    
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
            gridLineWidth: 0,
            tickWidth: 0,
            reversed: true,
            plotLines: activeMonth === currentMonth ? [{
                color: '#EEEEEE',
                value: (1-currentTime) * 100,
                width: 1.5,
                dashStyle: 'dash',
                zIndex: 5
            }] : []
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
                      if(this.y === 0) return "";
                      const {over, spent} = processedData[this.point.index];
                      const spentLabel  = formatAsCurrency(spent,false);
                      const overlabel = over <= 0 ? "" :` (${formatAsCurrency(processedData[this.point.index].over,false)} OVER)`;
                      return `${spentLabel}${overlabel}`;
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
  
      return (
        <div className="budget-block">
          <h2>Regular Expenses</h2>
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



export const MonthTabs = ({monthKeys, activeMonth, setActiveMonth}) => {
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
  