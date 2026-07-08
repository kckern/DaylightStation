import moment from "moment";
import React from "react";
import { formatAsCurrency } from "../blocks";
import { EmptyState } from "../EmptyState.jsx";
import { Menu, Button, Group } from '@mantine/core';
import { pressable } from "../lib/a11y.mjs";

export const loadAnticipatedTransactions = (budget, month, key) => {
  const date = moment(month, "YYYY-MM").endOf('month').format("YYYY-MM-DD");
  const accountName = "Anticipated";
  switch (key) {
    case "month":
      return [
        ...loadAnticipatedTransactions(budget, month, "fixed"),
        ...loadAnticipatedTransactions(budget, month, "day"),
        ...loadAnticipatedTransactions(budget, month, "income")
      ];
    case "income":
      return budget["monthlyBudget"][month].incomeTransactions.map((paycheck) => ({
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
      return Object.keys(budget["monthlyBudget"][month].monthlyCategories).map((cat) => ({
        date,
        accountName,
        amount: budget["monthlyBudget"][month].monthlyCategories[cat].amount,
        expenseAmount: budget["monthlyBudget"][month].monthlyCategories[cat].amount,
        description: cat,
        tagNames: [cat],
        label: cat
      }));
    case "day":
      return [{
        date,
        accountName,
        amount: budget["dayToDayBudget"][month].budget,
        expenseAmount: budget["dayToDayBudget"][month].budget,
        description: "Day-to-Day Spending",
        tagNames: ["Day-to-Day"],
        label: "Day-to-Day Spending",
        bucket: "day"
      }];
  }
  return [];
};

export const loadCellTransactions = (budget, month, key) => {
  if (!month) {
    return Object.keys(budget["monthlyBudget"]).flatMap(m => loadCellTransactions(budget, m, key));
  }

  const isFuture = moment(month, "YYYY-MM").isAfter(moment().startOf('month'));
  if (isFuture) {
    return loadAnticipatedTransactions(budget, month, key);
  }
  switch (key) {
    case "month":
      return [
        ...loadCellTransactions(budget, month, "fixed"),
        ...loadCellTransactions(budget, month, "day"),
        ...loadCellTransactions(budget, month, "income")
      ];
    case "fixed":
      return Object.keys(budget["monthlyBudget"][month].monthlyCategories).flatMap(cat => budget["monthlyBudget"][month].monthlyCategories[cat].transactions) || [];
    case "day":
      return budget["dayToDayBudget"][month].transactions || [];
    case "income":
      return budget["monthlyBudget"][month].incomeTransactions || [];
    default:
      return [];
  }
};

const EMPTY_AGGREGATE = {
  income: 0, nonBonusIncome: 0, spending: 0, surplus: 0,
  monthlySpending: 0, monthlyDebits: 0, monthlyCredits: 0,
  dayToDaySpending: 0, incomeTransactions: [], monthlyCategories: {}
};

export const getPeriodData = (budget, month) => {
  if (!month) {
    // Whole-period rollup is compiled backend-side (SSoT); the empty
    // fallback covers a pre-recompile finances.yml (or a missing budget).
    return { month: budget?.aggregate || EMPTY_AGGREGATE };
  }
  return {
    month: budget?.monthlyBudget?.[month],
    daytoday: budget?.dayToDayBudget?.[month]
  };
};

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
            {[...olderMonths].reverse().map((month) => {
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

  if (!activeBudget.monthlyBudget || Object.keys(activeBudget.monthlyBudget).length === 0) {
    return <EmptyState message="No budget months in this period" />;
  }

  const handleCellClick = (month, key) => {
    const monthString = month ? moment(month, "YYYY-MM").format("MMM ‘YY") : "Entire Budget Period";
    const isFuture = moment(month, "YYYY-MM").isAfter(moment().startOf('month'));
    const header = key === "income" ? "Income" : key === "fixed" ? "Operating Expenses" : key === "day" ? "Day-to-Day Spending" : "Cash Flow";
    setDrawerContent({
      type: 'monthly-cell',
      title: `${isFuture ? "Anticipated" : ""}  ${header} for ${monthString}`,
      month,
      cellKey: key
    });
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
          <td {...pressable(() => handleCellClick(month, 'month'))}>{monthMoment.format("MMM ‘YY")}</td>
          <td {...pressable(() => handleCellClick(month, 'income'))}>{formatAsCurrency(income)}</td>
          <td {...pressable(() => handleCellClick(month, 'fixed'))}>{formatAsCurrency(monthlySpending)}</td>
          <td {...pressable(() => handleCellClick(month, 'day'))}>{formatAsCurrency(dayToDaySpending)}</td>
          <td {...pressable(() => handleCellClick(month, 'month'))} className={surplusClassName}>{formatAsCurrency(surplus || 0)}</td>
        </tr>
      );
    });
    const totalSurplus = months.reduce((acc, month) => acc + (monthlyBudget[month]?.surplus || 0), 0);
    const surplusClassName = totalSurplus >= 0 ? "surplus positive" : "surplus negative";
    

    const sumRow = (
      <tr key="sum" className="sum">
      <td {...pressable(() => handleCellClick(null, 'month'))}>Total</td>
      <td {...pressable(() => handleCellClick(null, 'income'))}>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.income || 0), 0))}</td>
      <td {...pressable(() => handleCellClick(null, 'fixed'))}>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.monthlySpending || 0), 0))}</td>
      <td {...pressable(() => handleCellClick(null, 'day'))}>{formatAsCurrency(months.reduce((acc, month) => acc + (monthlyBudget[month]?.dayToDaySpending || 0), 0))}</td>
      <td {...pressable(() => handleCellClick(null, 'month'))} className={surplusClassName}>{formatAsCurrency(totalSurplus)}</td>
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