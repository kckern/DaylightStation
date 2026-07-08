import { Drawer as TransactionsDrawer } from './drawer';
import { MortgageDrawer } from './blocks/mortgage.jsx';
import { PayrollSyncContent } from './PayrollSync.jsx';
import { loadCellTransactions, getPeriodData } from './blocks/monthly.jsx';
import { gatherShortTermTransactions } from './blocks/shortterm.jsx';
import { collectSpendingTransactions } from './blocks.jsx';

/**
 * Resolves a serializable drawer descriptor against CURRENT data on every
 * render — an open drawer live-updates after a reload instead of showing
 * the click-time snapshot (2026-07-06 audit §2.3).
 */
export default function DrawerHost({ descriptor, budget, mortgage }) {
  if (!descriptor) return null;

  switch (descriptor.type) {
    case 'monthly-cell': {
      const transactions = (budget ? loadCellTransactions(budget, descriptor.month, descriptor.cellKey) : [])
        .slice()
        .sort((a, b) => b.amount - a.amount);
      return (
        <TransactionsDrawer
          transactions={transactions}
          cellKey={descriptor.cellKey}
          periodData={getPeriodData(budget, descriptor.month)}
        />
      );
    }
    case 'shortterm-bucket': {
      const transactions = budget?.shortTermBuckets?.[descriptor.bucket]?.transactions || [];
      return <TransactionsDrawer transactions={transactions} />;
    }
    case 'shortterm-status':
      return <TransactionsDrawer transactions={gatherShortTermTransactions(budget, descriptor.statusKey)} />;
    case 'daytoday-month': {
      const transactions = budget?.dayToDayBudget?.[descriptor.month]?.transactions || [];
      return <TransactionsDrawer transactions={transactions} />;
    }
    case 'spending-tag': {
      const transactions = collectSpendingTransactions(budget)
        .filter((txn) => txn.tagNames?.includes(descriptor.tag));
      return <TransactionsDrawer transactions={transactions} />;
    }
    case 'transfers': {
      const transactions = [...(budget?.transferTransactions?.transactions || [])]
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      return <TransactionsDrawer transactions={transactions} />;
    }
    case 'mortgage':
      return <MortgageDrawer mortgage={mortgage} defaultTab={descriptor.tab} />;
    case 'payroll':
      return <PayrollSyncContent />;
    default:
      return null;
  }
}
