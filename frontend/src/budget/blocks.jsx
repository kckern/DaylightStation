import moment from "moment";
import React, { useEffect, useState } from "react";

  
  // BudgetOverview.jsx
  export function BudgetOverview({ setDrawerContent, budget }) {
    return (
      <div className="budget-block">
        <h2>Accounts</h2>
        <div className="budget-block-content">
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
  