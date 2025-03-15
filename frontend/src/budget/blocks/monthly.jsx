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

  // BudgetMonthly.jsx
  export function BudgetMonthly({ setDrawerContent, budget }) {
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
  const activeBudget = budget[Object.keys(budget)[0]];

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
    const monthData = {month: activeBudget["monthlyBudget"][month], daytoday: activeBudget["dayToDayBudget"][month]};
    const monthString = moment(month, "YYYY-MM").format("MMM ‘YY");
    const isFuture = moment(month, "YYYY-MM").isAfter(moment().startOf('month'));
    const header = key === "income" ? "Income" : key === "fixed" ? "Operating Expenses" : "Day-to-Day Spending";
    const content = <Drawer transactions={transactions} cellKey={key} monthData={monthData} />;
    setDrawerContent({ jsx: content, meta: { title: `${isFuture ? "Anticipated" : ""}  ${header} for ${monthString}` } });
  }


  const rows = (() => {
    const { monthlyBudget } = activeBudget;
    if(!monthlyBudget) return [];
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
          <td onClick={()=>handleCellClick(month, 'month')} className={surplusClassName}>{formatAsCurrency(surplus || 0)}</td>
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