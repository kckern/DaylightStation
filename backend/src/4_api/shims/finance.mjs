// backend/src/4_api/shims/finance.mjs

/**
 * Finance shims transform new API responses to legacy format.
 * Used during migration to maintain frontend compatibility.
 */

export const financeShims = {
  'finance-data-v1': {
    name: 'finance-data-v1',
    description: 'Transforms budget array to legacy object-keyed format',
    transform: (newResponse) => {
      const budgets = {};
      for (const budget of (newResponse.budgets || [])) {
        budgets[budget.periodStart] = {
          ...budget,
          budgetStart: budget.periodStart,
          budgetEnd: budget.periodEnd,
        };
      }
      return {
        budgets,
        mortgage: newResponse.mortgage,
      };
    },
  },

  'finance-daytoday-v1': {
    name: 'finance-daytoday-v1',
    description: 'Flattens current month data to legacy flat format',
    transform: (newResponse) => ({
      spending: newResponse.current?.spending,
      budget: newResponse.current?.allocated,
      remaining: newResponse.current?.balance,
    }),
  },
};
