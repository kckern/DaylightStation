import moment from "moment";
import React, { useEffect, useState } from "react";
import { Drawer } from "./drawer";

  
  // BudgetOverview.jsx
  export function BudgetOverview({ setDrawerContent, budget }) {

    const budgets = Object.keys(budget);
    const activeBudget = budget[budgets[0]];
    
    const Transfers = <Drawer setDrawerContent={setDrawerContent} header="Transfers" transactions={activeBudget.transfers.transactions} />;

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
  




  // BudgetRetirement.jsx
  export function BudgetRetirement({ setDrawerContent, budget }) {
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
      switch(key) {
        case "income":
          return activeBudget["monthlyBudget"][month].paychecks.map((paycheck) => { 
            return {
              date: paycheck.date,
              accountName,
              amount: paycheck.amount,
              expenseAmount: paycheck.amount,
              description: "Paycheck",
              tagNames: []
            }
          });
        case "fixed":
          const categories = activeBudget["monthlyBudget"][month].categories;
          const catKeys = Object.keys(categories);
          return catKeys.map((cat) => {
            return {
              date,
              accountName,
              amount: categories[cat].amount,
              expenseAmount: categories[cat].amount,
              description: cat,
              tagNames: []
            }
          });
        case "day":
          return [
            {
              date,
              accountName,
              amount: activeBudget["dayToDayBudget"][month].amount,
              expenseAmount: activeBudget["dayToDayBudget"][month].amount,
              description: "Day-to-Day Spending",
              tagNames: []

            }

          ]
      }
      return [];
    }



    const loadTransactions = (month, key) => {

      const isFuture = moment(month, "YYYY-MM").isAfter(moment().startOf('month'));

      if (isFuture) return loadAnticipatedTransactions(month, key);

      switch (key) {
        case "month":
          return ((month) => {
            const a = loadTransactions(month, "fixed") || [];
            const b = loadTransactions(month, "day") || [];
            const c = loadTransactions(month, "income") || [];
            return [...a, ...b, ...c];
          })(month) || [];
        case "fixed":
          return Object.keys(activeBudget["monthlyBudget"][month].categories).reduce((acc, cat) => {
            return acc.concat(activeBudget["monthlyBudget"][month].categories[cat].transactions);
          }, []) || [];
        case "day":
          return activeBudget["dayToDayBudget"][month].transactions || [];
        case "income":
          return activeBudget["monthlyBudget"][month].income_transactions || [];
        default:
          return [];
      }
    }

    const handleCellClick = (month, key) => {
      const transactions = loadTransactions(month, key).sort((a, b) => b.amount - a.amount);
      const header = key === "income" ? "Income" : key === "fixed" ? "Fixed Expenses" : "Day-to-Day Spending";
      const content = <Drawer setDrawerContent={setDrawerContent} header={header} transactions={transactions} />;
      setDrawerContent(content);
    }


    const formatAsCurrency = (value) => {
      return `$${value?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
   

    const rows = ((activeBudget) => {
      const { dayToDayBudget, monthlyBudget, shortTermStatus } = activeBudget;
      const months = Object.keys(monthlyBudget);
      const currentMonth = moment().startOf('month');
    
      const rows = months.map((month) => {
        const { income, netspent,spent,amount, summary } = monthlyBudget[month];
        const monthMoment = moment(month, "YYYY-MM");
        let rowClassName = '';
    
        if (monthMoment.isBefore(currentMonth)) {
          rowClassName = 'past';
        } else if (monthMoment.isSame(currentMonth)) {
          rowClassName = 'present';
        } else {
          rowClassName = 'future';
        }
        const surplus = monthlyBudget[month].summary.surplus || 0;


    
        return (
          <tr key={month} className={rowClassName}>
            <td onClick={() => handleCellClick(month, 'month')}>{monthMoment.format("MMM ‘YY")}</td>
            <td onClick={() => handleCellClick(month, 'income')}>{formatAsCurrency(income)}</td>
            <td onClick={() => handleCellClick(month, 'fixed')}>{formatAsCurrency(netspent || spent || amount)}</td>
            <td onClick={() => handleCellClick(month, 'day')}>{formatAsCurrency(summary.dayToDaySpentOrBudgeted)}</td>
            <td >{formatAsCurrency(surplus)}</td>
          </tr>
        );
      });

      const sumRow = (
        <tr>
          <td>Total</td>
          <td>{formatAsCurrency(months.reduce((acc, month) => acc + monthlyBudget[month].summary.monthTopLine, 0))}</td>
          <td>{formatAsCurrency(months.reduce((acc, month) => acc + monthlyBudget[month].summary.monthNetSpent, 0))}</td>
          <td>{formatAsCurrency(months.reduce((acc, month) => acc + monthlyBudget[month].summary.dayToDaySpentOrBudgeted, 0))}</td>
          <td>{formatAsCurrency(months.reduce((acc, month) => acc + monthlyBudget[month].summary.surplus, 0))}</td>
        </tr>
      );
    
      return [...rows, sumRow];
    })(activeBudget);


    return (
      <table className="overviewTable">
        <thead>
          <tr>
            <th>Month</th>
            <th>Income</th>
            <th>Monthly</th>
            <th>Day-to-day</th>
            <th>Savings</th>
          </tr>
        </thead>
        <tbody>
          {rows}
        </tbody>
      </table>
    );
  }