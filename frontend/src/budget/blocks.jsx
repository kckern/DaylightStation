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
        <h2>Retirement</h2>
        <div className="budget-block-content">
          {/* Placeholder for Retirement content */}
        </div>
      </div>
    );
  }
  