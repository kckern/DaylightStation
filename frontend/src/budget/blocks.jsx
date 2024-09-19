import moment from "moment";
import React, { useEffect, useState } from "react";
import { Drawer } from "./drawer";

  
export const formatAsCurrency = (value) => {
  const isNegative = value < 0;
  const absoluteValue = Math.abs(value);
  //if nan or infinity return Ø
  if (!isFinite(absoluteValue)) return `$Ø`;
  const formattedValue = absoluteValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return isNegative ? `-$${formattedValue}` : `$${formattedValue}`;
};
  // BudgetAccounts.jsx
  export function BudgetAccounts({ setDrawerContent, budget }) {

    const budgets = Object.keys(budget);
    const activeBudget = budget[budgets[0]];
    
    const Transfers = <Drawer setDrawerContent={setDrawerContent} header="Transfers" transactions={activeBudget.transferTransactions.transactions} />;

    return (
      <div className="budget-block">
        <h2>Accounts</h2>
        <div className="budget-block-content">
          <button onClick={() => setDrawerContent(Transfers)}>View Transfers</button>
        </div>
      </div>
    );
  }
  
  // BudgetMortgage.jsx
  export function BudgetMortgage({ setDrawerContent, budget }) {
    return (
      <div className="budget-block">
        <h2>Mortgage</h2>
        <div className="budget-block-content">
          {/* Placeholder for Mortgage content */}
        </div>
      </div>
    );
  }
  
  // BudgetMonthlyExpenses.jsx
  export function BudgetMonthlyExpenses({ setDrawerContent, budget }) {
    return (
      <div className="budget-block">
        <h2>Day-to-day Spending</h2>
        <div className="budget-block-content">
          {/* Placeholder for Monthly Expenses content */}
        </div>
      </div>
    );
  }
  




  // BudgetOverview.jsx
  export function BudgetOverview({ setDrawerContent, budget }) {
    return (
      <div className="budget-block">
        <h2>Overview</h2>
        <div className="budget-block-content">
          <BudgetTable setDrawerContent={setDrawerContent} budget={budget} />
        </div>
      </div>
    );
  }
  

  
function BudgetTable({ setDrawerContent, budget }) {
  const activeBudget = budget[Object.keys(budget)[0]];

  const loadAnticipatedTransactions = (month, key) => {
    const date = moment(month, "YYYY-MM").endOf('month').format("YYYY-MM-DD");
    const accountName = "Anticipated";
    switch (key) {
      case "income":
        return activeBudget["monthlyBudget"][month].incomeTransactions.map((paycheck) => ({
          date: paycheck.date,
          accountName,
          amount: paycheck.amount,
          expenseAmount: paycheck.amount,
          description: paycheck.description || "Paycheck",
          tagNames: []
        }));
      case "fixed":
        return Object.keys(activeBudget["monthlyBudget"][month].monthlyCategories).map((cat) => ({
          date,
          accountName,
          amount: activeBudget["monthlyBudget"][month].monthlyCategories[cat].amount,
          expenseAmount: activeBudget["monthlyBudget"][month].monthlyCategories[cat].amount,
          description: cat,
          tagNames: []
        }));
      case "day":
        return [{
          date,
          accountName,
          amount: activeBudget["dayToDayBudget"][month].budget,
          expenseAmount: activeBudget["dayToDayBudget"][month].budget,
          description: "Day-to-Day Spending",
          tagNames: []
        }];
    }
    return [];
  }

  const loadTransactions = (month, key) => {
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

  const handleCellClick = (month, key) => {
    const transactions = loadTransactions(month, key).sort((a, b) => b.amount - a.amount);
    const monthString = moment(month, "YYYY-MM").format("MMM ‘YY");
    const isFuture = moment(month, "YYYY-MM").isAfter(moment().startOf('month'));
    const header = key === "income" ? "Income" : key === "fixed" ? "Fixed Expenses" : "Day-to-Day Spending";
    const content = <Drawer setDrawerContent={setDrawerContent} header={header} transactions={transactions} />;
    setDrawerContent({ jsx: content, meta: { title: `${isFuture ? "Anticipated" : ""}  ${header} for ${monthString}` } });
  }

  const rows = (() => {
    const { monthlyBudget } = activeBudget;
    const months = Object.keys(monthlyBudget);
    const currentMonth = moment().startOf('month');

    const rows = months.map((month) => {
      const monthData = monthlyBudget[month];
      //const netSpent = Object.values(monthData.monthlyCategories).reduce((sum, cat) => sum + cat.spent, 0);
      const monthMoment = moment(month, "YYYY-MM");
      const rowClassName = monthMoment.isBefore(currentMonth) ? 'past' : monthMoment.isSame(currentMonth) ? 'present' : 'future';

      const {income, monthlySpending, dayToDaySpending, surplus} = monthData;
      const surplusClassName = surplus >= 0 ? "surplus positive" : "surplus negative";
      return (
        <tr key={month} className={rowClassName}>
          <td onClick={() => handleCellClick(month, 'month')}>{monthMoment.format("MMM ‘YY")}</td>
          <td onClick={() => handleCellClick(month, 'income')}>{formatAsCurrency(income)}</td>
          <td onClick={() => handleCellClick(month, 'fixed')}>{formatAsCurrency(monthlySpending)}</td>
          <td onClick={() => handleCellClick(month, 'day')}>{formatAsCurrency(dayToDaySpending)}</td>
          <td className={surplusClassName}>{formatAsCurrency(surplus || 0)}</td>
        </tr>
      );
    });
    const totalSurplus = months.reduce((acc, month) => acc + (monthlyBudget[month]?.surplus || 0), 0);
    const surplusClassName = totalSurplus >= 0 ? "surplus positive" : "surplus negative";
    
    const sumRow = (
      <tr key="sum" className="sum">
        <td>Total</td>
        <td>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.income || 0), 0))}</td>
        <td>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.monthlySpending || 0), 0))}</td>
        <td>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.dayToDaySpending || 0), 0))}</td>
        <td className={surplusClassName}>{formatAsCurrency(totalSurplus)}</td>
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