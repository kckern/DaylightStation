import React, { useEffect, useMemo, useState } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { MonthTabs } from "./monthly";
import moment from 'moment';
import { useToday } from '../hooks/useToday.mjs';
import { EmptyState } from '../EmptyState.jsx';

import { buildDayToDayBudgetOptions } from './dayToDayChartOptions.js';


export const BudgetDayToDay = ({ setDrawerContent, budget }) => {

  const dayToDayBudget = useMemo(() => budget.dayToDayBudget || {}, [budget.dayToDayBudget]);
  const months = Object.keys(dayToDayBudget);
  const currentMonth = moment().format("YYYY-MM");
  const [activeMonth, setActiveMonth] = useState(currentMonth);
  const nonFutureMonths = months.filter((m) => m <= currentMonth);
  const monthHeader = (
    <MonthTabs
      monthKeys={nonFutureMonths}
      activeMonth={activeMonth}
      setActiveMonth={setActiveMonth}
    />
  );
  useEffect(() => {
    if (dayToDayBudget[activeMonth] !== undefined) return;
    const available = Object.keys(dayToDayBudget).filter((m) => m <= currentMonth).sort();
    setActiveMonth(available[available.length - 1] ?? Object.keys(dayToDayBudget)[0]);
  }, [activeMonth, dayToDayBudget, currentMonth]);

  const today = useToday();
  const options = useMemo(
    () => buildDayToDayBudgetOptions(dayToDayBudget[activeMonth] || {}, setDrawerContent, { now: today }),
    [dayToDayBudget, activeMonth, setDrawerContent, today]
  );

  if (Object.keys(budget.dayToDayBudget || {}).length === 0) {
    return (<div className="budget-block"><h2>Day-to-day Spending</h2><EmptyState /></div>);
  }

  return (
    <div className="budget-block">
      <h2>Day-to-day Spending</h2>
      <div className="budget-block-content">
        {monthHeader}
        <HighchartsReact
          className="budget-burn-down-chart"
          highcharts={Highcharts}
          options={options}
        />
      </div>
    </div>
  );
};