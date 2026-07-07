import { SpendingPieDrilldownChart } from "./drawer";
import { EmptyState } from "./EmptyState.jsx";
import { pressable } from "./lib/a11y.mjs";
export { formatAsCurrency } from './lib/format.mjs';

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

  // BudgetHoldings.jsx
  export function BudgetHoldings({ setDrawerContent, budget }) {

    const activeBudget = budget;

    const transferTransactions = [...(activeBudget.transferTransactions?.transactions || [])]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return (
      <div className="budget-block">
      <h2 {...pressable(() => setDrawerContent({ type: 'transfers', title: 'Transfers' }), { 'aria-label': 'Open transfers' })}>Transfers</h2>
      <div className="budget-block-content transfer-scroll">
        {transferTransactions.length === 0 ? (
          <EmptyState message="No transfers this period" />
        ) : (
          <table className="transaction-table">
          <thead>
            <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {transferTransactions.map((txn, index) => {
            const { date, description, amount, id } = txn;
            const formattedDate = new Date(date).toLocaleDateString();
            const formattedAmount = formatAsCurrency(amount);
              return (
              <tr key={txn.id || index} onClick={() => window.open(`https://www.buxfer.com/transactions?tids=${id}`, "_blank")}>
                <td>{formattedDate}</td>
                <td>{description}</td>
                <td>{formattedAmount}</td>
              </tr>
              );
            })}
          </tbody>
          </table>
        )}
      </div>
      </div>
    );
  }

  export function BudgetSpending({ setDrawerContent, budget }) {

    const activeBudget = budget;

    const budgetStartDate = new Date(activeBudget.startDate);

    const allTransactionsFromAllMonths = collectSpendingTransactions(activeBudget);

    const setTransactionFilter = (filterString) => {
      setDrawerContent({ type: 'spending-tag', title: `Spending: ${filterString}`, tag: filterString });
    };
    return (
      <div className="budget-block">
        <h2>Spending</h2>
        <div className="budget-block-content">
          {allTransactionsFromAllMonths.length === 0 ? (
            <EmptyState />
          ) : (
            <SpendingPieDrilldownChart transactions={allTransactionsFromAllMonths} key={budgetStartDate.toString()} setTransactionFilter={setTransactionFilter} />
          )}
        </div>
      </div>
    );
  }
  
