// shortTermTransactions.js — short-term-bucket transaction gathering for
// DrawerHost.jsx, split out of shortterm.jsx so Fast Refresh can hot-reload
// the block component on its own.

export const gatherShortTermTransactions = (budget, key) => {
  const shortTermBuckets = budget.shortTermBuckets || {};
  const all = Object.keys(shortTermBuckets)
    .reduce((acc, label) => acc.concat(shortTermBuckets[label].transactions), [])
    .sort((b, a) => a.amount - b.amount);
  if (key === 'budget') return all;
  if (key === 'spent') return all.filter(t => t.expenseAmount > 0);
  if (key === 'gained') return all.filter(t => t.expenseAmount < 0);
  return [];
};
