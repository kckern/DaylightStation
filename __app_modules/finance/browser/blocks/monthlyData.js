// monthlyData.js — pure transaction/period derivation for monthly.jsx, split
// out so Fast Refresh can hot-reload the block components on their own.
import moment from "moment";

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
