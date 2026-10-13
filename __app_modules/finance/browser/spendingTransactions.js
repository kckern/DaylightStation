// spendingTransactions.js — spending-transaction collection for blocks.jsx
// (and DrawerHost.jsx, which shares it for the spending-tag drawer), split
// out so Fast Refresh can hot-reload the block components on their own.

export const collectSpendingTransactions = (budget) => {
  const monthsDayToDay = Object.keys(budget.dayToDayBudget || {});
  const monthsMonthly = Object.keys(budget.monthlyBudget || {});
  const shortTermBuckets = Object.keys(budget.shortTermBuckets || {});
  const dayToDay = monthsDayToDay.flatMap((m) => budget.dayToDayBudget[m].transactions || []);
  const monthly = monthsMonthly.flatMap((m) =>
    Object.values(budget.monthlyBudget[m].monthlyCategories || {}).flatMap((c) => c.transactions || [])
  );
  const shortTerm = shortTermBuckets.flatMap((b) => budget.shortTermBuckets[b].transactions || []);
  return [...dayToDay, ...monthly, ...shortTerm].filter((txn) => txn?.expenseAmount > 0);
};
