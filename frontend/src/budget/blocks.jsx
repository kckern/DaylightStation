import React, { useEffect, useState } from "react";
import { Drawer, DrawerTreeMapChart, SpendingPieDrilldownChart } from "./drawer";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import SankeyModule from "highcharts/modules/sankey";

//https://coolors.co/palette/2364aa-3da5d9-73bfb8-fec601-ea7317
//https://coolors.co/palette/1e3888-47a8bd-73BFB8-137547-f5e663-ffad69-EA7317-9c3848

SankeyModule(Highcharts);
export const formatAsCurrency = (value) => {
  const isNegative = value < 0;
  const absoluteValue = Math.abs(value);
  //if nan or infinity return Ø
  if (!isFinite(absoluteValue)) return `$Ø`;
  const formattedValue = absoluteValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return isNegative ? `-$${formattedValue}` : `$${formattedValue}`;
};
  // BudgetHoldings.jsx
  export function BudgetHoldings({ setDrawerContent, budget }) {

    const activeBudget = budget;
    
    const Transfers = <Drawer setDrawerContent={setDrawerContent} header="Transfers" transactions={activeBudget.transferTransactions?.transactions || []} />;

    return (
      <div className="budget-block">
        <h2>Holdings</h2>
        <div className="budget-block-content">
          <button onClick={() => setDrawerContent(Transfers)}>View Transfers</button>
        </div>
      </div>
    );
  }
  
  // BudgetMortgage.jsx
  export function BudgetSpending({ setDrawerContent, budget }) {

    const activeBudget = budget;

    const budgetStartDate = new Date(activeBudget.startDate);

    const monthsDayToDay = Object.keys(activeBudget.dayToDayBudget);
    const monthsMonthly = Object.keys(activeBudget.monthlyBudget);
    const shortTermBuckets = Object.keys(activeBudget.shortTermBuckets);

    const dayToDayTransactionsAllMonths = monthsDayToDay.map((month) => activeBudget.dayToDayBudget[month].transactions).flat();
    const monthlyTransactionsAllMonths = monthsMonthly.map((month) => {
      const categories = Object.keys(activeBudget.monthlyBudget[month].monthlyCategories);
      return categories.map((category) => activeBudget.monthlyBudget[month].monthlyCategories[category].transactions).flat();
    }).flat();

    const shortTermTransactions = shortTermBuckets.map((bucket) => activeBudget.shortTermBuckets[bucket].transactions).flat();

    const allTransactionsFromAllMonths = dayToDayTransactionsAllMonths
    .concat(monthlyTransactionsAllMonths)
    .concat(shortTermTransactions)
    //.filter((txn) => !["Housing", "Taxes", "Health Insurance", "Utilities", "Long-term Savings"].includes(txn.label))
    .filter((txn) => txn?.expenseAmount > 0);

    const setTransactionFilter = (filterString) => {

      const txns = allTransactionsFromAllMonths.filter((txn) => txn.tagNames?.includes(filterString));
      console.log({txns,filterString});
      setDrawerContent(
        <Drawer
          setDrawerContent={setDrawerContent}
          transactions={txns}  
        />
      );

    }
    const budgetKey =activeBudget.budgetStart;
    return (
      <div className="budget-block">
        <h2>Spending</h2>
        <div className="budget-block-content">
          <SpendingPieDrilldownChart transactions={allTransactionsFromAllMonths} key={budgetStartDate.toString()} setTransactionFilter={setTransactionFilter}  budgetKey={budgetKey} />
        </div>
      </div>
    );
  }
  
