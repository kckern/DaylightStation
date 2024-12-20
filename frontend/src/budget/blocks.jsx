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
  // BudgetHoldings.jsx
  export function BudgetHoldings({ setDrawerContent, budget }) {

    const budgets = Object.keys(budget);
    const activeBudget = budget[budgets[0]];
    
    const Transfers = <Drawer setDrawerContent={setDrawerContent} header="Transfers" transactions={activeBudget.transferTransactions.transactions} />;

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
  export function BudgetGoals({ setDrawerContent, budget }) {
    return (
      <div className="budget-block">
        <h2>Financial Goals</h2>
        <div className="budget-block-content">
          {/* Placeholder for Mortgage content */}
        </div>
      </div>
    );
  }
  
