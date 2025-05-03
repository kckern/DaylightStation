import moment from "moment";
import React, { useEffect, useState } from "react";
import { Drawer } from "../drawer";
import { formatAsCurrency } from "../blocks";
import { Menu, Button, Group } from '@mantine/core';

export const MonthTabs = ({ monthKeys, activeMonth, setActiveMonth }) => {
  const recentMonths = monthKeys.slice(-6); // Get the most recent 6 months
  const olderMonths = monthKeys.slice(0, -6); // Get the rest

  return (
    <div className="month-header">
      {olderMonths.length > 0 && (
        <Menu>
          <Menu.Target>
            <Button
              style={{ padding: "0", width: "100%" }}
              variant="outline"
              className="month-dropdown"
            >{olderMonths.length} Previous Months</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {olderMonths.reverse().map((month) => {
              const monthLabel = moment(month, "YYYY-MM").format("MMM ‘YY");
              return (
                <Menu.Item key={month} onClick={() => setActiveMonth(month)}>
                  {monthLabel}
                </Menu.Item>
              );
            })}
          </Menu.Dropdown>
        </Menu>
      )}
      <Group style={{ marginLeft: "auto", display: "flex", flexWrap: "nowrap", gap: "0.5rem", justifyContent: "space-around" , width: "100%"}}>
        {recentMonths.map((month) => {
          const monthLabel = moment(month, "YYYY-MM").format("MMM ‘YY");
          return (
            <Button
            style={{ padding: "1ex" }}
              key={month}
              onClick={() => setActiveMonth(month)}
              variant={activeMonth === month ? "filled" : "outline"}
            >
              {monthLabel}
            </Button>
          );
        })}
      </Group>
    </div>
  );
};

  // BudgetCashFlow.jsx
  export function BudgetCashFlow({ setDrawerContent, budget }) {
    return (
      <div className="budget-block">
        <h2>Monthly Cash Flow</h2>
        <div className="budget-block-content">
          <BudgetTable setDrawerContent={setDrawerContent} budget={budget} />
        </div>
      </div>
    );
  }
  

  
function BudgetTable({ setDrawerContent, budget }) {
  const activeBudget = budget;

  const loadAnticipatedTransactions = (month, key) => {
    const date = moment(month, "YYYY-MM").endOf('month').format("YYYY-MM-DD");
    const accountName = "Anticipated";
    switch (key) {
      case "month":
        return [...loadAnticipatedTransactions(month, "fixed"), ...loadAnticipatedTransactions(month, "day"), ...loadAnticipatedTransactions(month, "income")];
      case "income":
        return activeBudget["monthlyBudget"][month].incomeTransactions.map((paycheck) => ({
          date: paycheck.date,
          accountName,
          amount: paycheck.amount,
          expenseAmount: paycheck.amount,
          description: paycheck.description || "Paycheck",
          tagNames: ["Income"],
          label: 'Income',
          bucket: 'income'
        }));
      case "fixed":
        return Object.keys(activeBudget["monthlyBudget"][month].monthlyCategories).map((cat) => ({
          date,
          accountName,
          amount: activeBudget["monthlyBudget"][month].monthlyCategories[cat].amount,
          expenseAmount: activeBudget["monthlyBudget"][month].monthlyCategories[cat].amount,
          description: cat,
          tagNames: [cat],
          label: cat
        }));
      case "day":
        return [{
          date,
          accountName,
          amount: activeBudget["dayToDayBudget"][month].budget,
          expenseAmount: activeBudget["dayToDayBudget"][month].budget,
          description: "Day-to-Day Spending",
          tagNames: ["Day-to-Day"],
          label: "Day-to-Day Spending",
          bucket: "day"
        }];
    }
    return [];
  }
  const loadTransactions = (month, key) => {
    if (!month) {
      return Object.keys(activeBudget["monthlyBudget"]).flatMap(m => loadTransactions(m, key));
    }

    const isFuture = moment(month, "YYYY-MM").isAfter(moment().startOf('month'));
    if (isFuture) {
      return loadAnticipatedTransactions(month, key);
    }
    switch (key) {
      case "month":
        return [...loadTransactions(month, "fixed"), ...loadTransactions(month, "day"), ...loadTransactions(month, "income")];
      case "fixed":
        return Object.keys(activeBudget["monthlyBudget"][month].monthlyCategories).flatMap(cat => activeBudget["monthlyBudget"][month].monthlyCategories[cat].transactions) || [];
      case "day":
        return activeBudget["dayToDayBudget"][month].transactions || [];
      case "income":
        return activeBudget["monthlyBudget"][month].incomeTransactions || [];
      default:
        return [];
    }
  }

  function getPeriodData(month, key) {
    const allMonths = Object.keys(activeBudget["monthlyBudget"]);
  
    if (!month) {
      const aggregatedData = {
        month: {
          income: 0,
          nonBonusIncome: 0,
          spending: 0,
          surplus: 0,
          monthlySpending: 0,
          monthlyDebits: 0,
          monthlyCredits: 0,
          dayToDaySpending: 0,
          incomeTransactions: [],
          monthlyCategories: {}
        },
        daytoday: {
          spending: 0,
          budget: 0,
          balance: 0,
          transactions: [],
          dailyBalances: {},
          spent: 0,
          daysRemaining: 0,
          dailySpend: 0,
          dailyBudget: null,
          dailyAdjustment: null,
          adjustPercentage: null
        }
      };
  
      allMonths.forEach(m => {
        const currentMonthData = activeBudget["monthlyBudget"][m] || {};
        const currentDayToDayData = activeBudget["dayToDayBudget"][m] || {};
  
        aggregatedData.month.income            += currentMonthData.income            || 0;
        aggregatedData.month.nonBonusIncome    += currentMonthData.nonBonusIncome    || 0;
        aggregatedData.month.spending         += currentMonthData.spending          || 0;
        aggregatedData.month.surplus          += currentMonthData.surplus           || 0;
        aggregatedData.month.monthlySpending  += currentMonthData.monthlySpending   || 0;
        aggregatedData.month.monthlyDebits    += currentMonthData.monthlyDebits     || 0;
        aggregatedData.month.monthlyCredits   += currentMonthData.monthlyCredits    || 0;
        aggregatedData.month.dayToDaySpending += currentMonthData.dayToDaySpending  || 0;
  
        const monthIncomeTransactions = currentMonthData.incomeTransactions || [];
        aggregatedData.month.incomeTransactions.push(...monthIncomeTransactions);
  
        const currentCategories = currentMonthData.monthlyCategories || {};
        Object.keys(currentCategories).forEach(cat => {
          if (!aggregatedData.month.monthlyCategories[cat]) {
            aggregatedData.month.monthlyCategories[cat] = {
              amount: 0,
              credits: 0,
              debits: 0,
              transactions: []
            };
          }
          aggregatedData.month.monthlyCategories[cat].amount   += currentCategories[cat].amount   || 0;
          aggregatedData.month.monthlyCategories[cat].credits  += currentCategories[cat].credits  || 0;
          aggregatedData.month.monthlyCategories[cat].debits   += currentCategories[cat].debits   || 0;
          aggregatedData.month.monthlyCategories[cat].transactions.push(...(currentCategories[cat].transactions || []));
        });
  
        aggregatedData.daytoday.spending += currentDayToDayData.spending || 0;
        aggregatedData.daytoday.budget   += currentDayToDayData.budget   || 0;
        aggregatedData.daytoday.balance  += currentDayToDayData.balance  || 0;
        aggregatedData.daytoday.spent    += currentDayToDayData.spent    || 0;
  
        const dayTransactions = currentDayToDayData.transactions || [];
        aggregatedData.daytoday.transactions.push(...dayTransactions);
  
        const dailyBalances = currentDayToDayData.dailyBalances || {};
        Object.keys(dailyBalances).forEach(day => {
          if (!aggregatedData.daytoday.dailyBalances[day]) {
            aggregatedData.daytoday.dailyBalances[day] = { ...dailyBalances[day] };
          } else {
            aggregatedData.daytoday.dailyBalances[day].credits          += dailyBalances[day].credits          || 0;
            aggregatedData.daytoday.dailyBalances[day].debits           += dailyBalances[day].debits           || 0;
            aggregatedData.daytoday.dailyBalances[day].transactionCount += dailyBalances[day].transactionCount || 0;
            aggregatedData.daytoday.dailyBalances[day].endingBalance    += dailyBalances[day].endingBalance    || 0;
          }
        });
      });
  
      return aggregatedData;
    }
  
    const periodData = {
      month: activeBudget["monthlyBudget"][month],
      daytoday: activeBudget["dayToDayBudget"][month]
    };
    console.log("Period data", month, key, periodData);
    return periodData;
  }


  const handleCellClick = (month, key) => {


    console.log("Clicked cell", month, key);
    const transactions = loadTransactions(month, key).sort((a, b) => b.amount - a.amount);
    const periodData = getPeriodData(month, key);
    const monthString = month ? moment(month, "YYYY-MM").format("MMM ‘YY") : "Entire Budget Period";
    const isFuture = moment(month, "YYYY-MM").isAfter(moment().startOf('month'));
    const header = key === "income" ? "Income" : key === "fixed" ? "Operating Expenses" : key === "day" ? "Day-to-Day Spending" : "Cash Flow";
    const content = <Drawer transactions={transactions} cellKey={key} periodData={periodData} />;
    setDrawerContent({ jsx: content, meta: { title: `${isFuture ? "Anticipated" : ""}  ${header} for ${monthString}` } });
  }


  const rows = (() => {
    const { monthlyBudget } = activeBudget;
    if(!monthlyBudget) return [];
    const months = Object.keys(monthlyBudget);
    const currentMonth = moment().startOf('month');

    const rows = months.map((month) => {
      const periodData = monthlyBudget[month];
      //const netSpent = Object.values(periodData.monthlyCategories).reduce((sum, cat) => sum + cat.spent, 0);
      const monthMoment = moment(month, "YYYY-MM");
      const rowClassName = monthMoment.isBefore(currentMonth) ? 'past' : monthMoment.isSame(currentMonth) ? 'present' : 'future';

      const {income, monthlySpending, dayToDaySpending, surplus} = periodData;
      const surplusClassName = surplus >= 0 ? "surplus positive" : "surplus negative";
      return (
        <tr key={month} className={rowClassName}>
          <td onClick={() => handleCellClick(month, 'month')}>{monthMoment.format("MMM ‘YY")}</td>
          <td onClick={() => handleCellClick(month, 'income')}>{formatAsCurrency(income)}</td>
          <td onClick={() => handleCellClick(month, 'fixed')}>{formatAsCurrency(monthlySpending)}</td>
          <td onClick={() => handleCellClick(month, 'day')}>{formatAsCurrency(dayToDaySpending)}</td>
          <td onClick={()=>handleCellClick(month, 'month')} className={surplusClassName}>{formatAsCurrency(surplus || 0)}</td>
        </tr>
      );
    });
    const totalSurplus = months.reduce((acc, month) => acc + (monthlyBudget[month]?.surplus || 0), 0);
    const surplusClassName = totalSurplus >= 0 ? "surplus positive" : "surplus negative";
    

    const sumRow = (
      <tr key="sum" className="sum">
      <td onClick={() => handleCellClick(null, 'month')}>Total</td>
      <td onClick={() => handleCellClick(null, 'income')}>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.income || 0), 0))}</td>
      <td onClick={() => handleCellClick(null, 'fixed')}>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.monthlySpending || 0), 0))}</td>
      <td onClick={() => handleCellClick(null, 'day')}>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.dayToDaySpending || 0), 0))}</td>
      <td onClick={() => handleCellClick(null, 'month')} className={surplusClassName}>{formatAsCurrency(totalSurplus)}</td>
      </tr>
    );

    return [...rows, sumRow];
  })();

  return (
    <table className="overviewTable">
      <thead>
        <tr>
          <th>Month</th>
          <th>Income</th>
          <th>Monthly</th>
          <th>Day-to-day</th>
          <th>Surplus</th>
        </tr>
      </thead>
      <tbody>
        {rows}
      </tbody>
    </table>
  );
}

export default BudgetTable;