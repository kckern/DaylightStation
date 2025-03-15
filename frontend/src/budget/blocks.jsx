import React, { useEffect, useState } from "react";
import { Drawer } from "./drawer";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import SankeyModule from "highcharts/modules/sankey";

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
  export function BudgetSpending({ setDrawerContent, budget }) {
    return (
      <div className="budget-block">
        <h2>Spending</h2>
        <div className="budget-block-content">
          {/* Placeholder for Mortgage content */}
          <BudgetSankeyChart />
        </div>
      </div>
    );
  }
  
function BudgetSankeyChart(){


  const options = {
    chart: {
      // type not strictly necessary if using 'series.type = sankey' below
      // but you can include: type: 'sankey'
    },
    title: {
      text:''
    },
    subtitle: {
      enabled: false
    },
    credits: {
      enabled: false
    },
    accessibility: {
      point: {
        valueDescriptionFormat:
          '{index}. {point.from} to {point.to}, {point.weight}.'
      }
    },
    tooltip: {
      headerFormat: null,
      pointFormat:
        '{point.fromNode.name} → {point.toNode.name}: {point.weight:.2f} units',
      nodeFormat: '{point.name}: {point.sum:.2f} units'
    },
    series: [
      {
        type: 'sankey',
        name: 'Budget Flow',
        keys: ['from', 'to', 'weight'],
  
        // 1) Define the nodes and their positions.
        nodes: [
          // Top-level income sources (column 0)
          {
            id: 'Primary Income',
            color: '#1a8dff',
            column: 0
          },
          {
            id: 'Reimbursements',
            color: '#009c00',
            column: 0,
            offset: 50
          },
          {
            id: 'Gifts',
            color: '#ffa500',
            column: 0,
            offset: 100
          },
          {
            id: 'Hobby Income',
            color: '#f4c0ff',
            column: 0,
            offset: 150
          },
  
          // Top-level budget groupings (column 1)
          {
            id: 'Monthly Ops',
            color: '#74ffe7',
            column: 1
          },
          {
            id: 'Day-to-Day',
            color: '#8cff74',
            column: 1,
            offset: 80
          },
          {
            id: 'Surplus',
            color: '#ffc0cb',
            column: 1,
            offset: 160
          },
  
          // Subcategories for Monthly Ops (column 2)
          {
            id: 'Taxes',
            color: '#f49c9c',
            column: 2
          },
          {
            id: 'Housing',
            color: '#f49c9c',
            column: 2
          },
          {
            id: 'Utilities',
            color: '#f49c9c',
            column: 2
          },
          {
            id: 'Insurance',
            color: '#f49c9c',
            column: 2
          },
          {
            id: 'Long-term Savings',
            color: '#f49c9c',
            column: 2
          },
          {
            id: 'Subscriptions',
            color: '#f49c9c',
            column: 2
          },
  
          // Subcategories for Day-to-Day (also column 2)
          {
            id: 'Groceries',
            color: '#fffac0',
            column: 2
          },
          {
            id: 'Fuel',
            color: '#fffac0',
            column: 2
          },
          {
            id: 'Shopping',
            color: '#fffac0',
            column: 2
          },
          {
            id: 'Eating Out',
            color: '#fffac0',
            column: 2
          },
  
          // Subcategories for Surplus (also column 2)
          {
            id: 'Home & Auto',
            color: '#ffd700',
            column: 2
          },
          {
            id: 'Travel & Fun',
            color: '#ffd700',
            column: 2
          },
          {
            id: 'Bills, Fees & Gifts',
            color: '#ffd700',
            column: 2
          },
          {
            id: 'Health & Wellness',
            color: '#ffd700',
            column: 2
          },
          {
            id: 'Projects',
            color: '#ffd700',
            column: 2
          },
          {
            id: 'Tech & Tools',
            color: '#ffd700',
            column: 2
          },
          {
            id: 'Learning & Leisure',
            color: '#ffd700',
            column: 2
          },
          {
            id: 'Personal Care',
            color: '#ffd700',
            column: 2
          }
        ],
  
        // 2) Define the flows between nodes.
        data: [
          // Top-level split from primary income
          ['Primary Income', 'Monthly Ops', 12],
          ['Primary Income', 'Day-to-Day', 5],
          ['Primary Income', 'Surplus', 8],
  
          // Minor income flows
          ['Reimbursements', 'Day-to-Day', 1],
          ['Gifts', 'Surplus', 2],
          ['Hobby Income', 'Surplus', 1],
  
          // Monthly Ops → subcategories
          ['Monthly Ops', 'Taxes', 3],
          ['Monthly Ops', 'Housing', 3],
          ['Monthly Ops', 'Utilities', 2],
          ['Monthly Ops', 'Insurance', 1],
          ['Monthly Ops', 'Long-term Savings', 2],
          ['Monthly Ops', 'Subscriptions', 1],
  
          // Day-to-Day → subcategories
          ['Day-to-Day', 'Groceries', 2],
          ['Day-to-Day', 'Fuel', 1],
          ['Day-to-Day', 'Shopping', 1],
          ['Day-to-Day', 'Eating Out', 2],
  
          // Surplus → subcategories
          ['Surplus', 'Home & Auto', 1.5],
          ['Surplus', 'Travel & Fun', 1.5],
          ['Surplus', 'Bills, Fees & Gifts', 1],
          ['Surplus', 'Health & Wellness', 1],
          ['Surplus', 'Projects', 1],
          ['Surplus', 'Tech & Tools', 1],
          ['Surplus', 'Learning & Leisure', 1],
          ['Surplus', 'Personal Care', 1]
        ]
      }
    ]
  };
  
  return         <HighchartsReact
                      highcharts={Highcharts}
                      options={options}
                  />
}