import { useState, useMemo } from 'react';
import { Button, Select, Drawer } from '@mantine/core';
import { AppThemeProvider } from '@/lib/ui/AppThemeProvider.jsx';
import { PACKS } from '@/lib/theme/packs.mjs';
import { dsCssVars } from '@/lib/theme/tokens.mjs';
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import { BudgetHoldings, BudgetSpending } from "./blocks.jsx";
import { BudgetMortgage } from "./blocks/mortgage.jsx";
import { BudgetCashFlow } from "./blocks/monthly.jsx";
import { BudgetShortTerm } from "./blocks/shortterm.jsx";
import { BudgetDayToDay } from "./blocks/daytoday.jsx";
import { useFinanceData } from "./hooks/useFinanceData.mjs";
import { FinanceDataContext } from "./FinanceDataContext.jsx";
import { FinanceErrorBoundary } from "./FinanceErrorBoundary.jsx";
import DrawerHost from "./DrawerHost.jsx";
import 'react-modern-drawer/dist/index.css';
import "./FinanceApp.scss";
import '@mantine/core/styles.css';
import spinner from "../../../../frontend/src/assets/icons/spinner.svg";
import moment from 'moment';
import { getChildLogger } from "../../../../frontend/src/lib/logging/singleton.js";

// Mantine mounts the Drawer in a portal outside the themed root, so it carries the pack's vars itself.
const FINANCE_VARS = dsCssVars(PACKS.finance);

const financeLogger = getChildLogger({ app: 'finance' });

export default function App() {
  useDocumentTitle('Finances');
  const finance = useFinanceData();
  const { data, error, retry } = finance;

  return (
    <AppThemeProvider pack="finance">
      {error && (
        <div className="finance-error-banner">
          <strong>{error.source === 'refresh' ? 'Refresh failed — showing the last loaded data.' : 'Failed to load finance data.'}</strong>
          <div className="finance-error-detail">{String(error.error?.message || error.error)}</div>
          <Button onClick={retry} variant="outline" color="red">Retry</Button>
        </div>
      )}
      {!error && !data && (
        <div className="finance-loading">
          <div className="finance-loading-card">
            <strong>Loading...</strong>
          </div>
        </div>
      )}
      {data && (
        <FinanceErrorBoundary>
          <BudgetViewer budget={data.budgets} mortgage={data.mortgage} finance={finance} />
        </FinanceErrorBoundary>
      )}
    </AppThemeProvider>
  );
}

function ReloadButton({ finance }) {
  const { refresh, refreshing } = finance;
  return (
    <button
      className={refreshing ? 'reload reloading' : 'reload'}
      onClick={refresh}
      disabled={refreshing}
      aria-label="Refresh finance data"
    >
      {refreshing ? <img src={spinner} alt="loading" /> : '🔄'}
    </button>
  );
}

function Header({ availableBudgetKeys = [], activeBudgetKey, setActiveBudgetKey, finance, setDrawerContent }) {
  const budgetOptions = useMemo(() => (
    availableBudgetKeys.map((key) => ({
      value: key,
      label: moment(key).format('YYYY') + ' Budget',
    }))
  ), [availableBudgetKeys]);

  const handleChange = (value) => {
    financeLogger.info('finance.budget.change', { value });
    if (value === activeBudgetKey) return;
    if (!availableBudgetKeys.includes(value)) {
      financeLogger.error('finance.budget.invalidKey', { value, availableKeys: availableBudgetKeys });
      return;
    }
    setActiveBudgetKey(value);
  };

  return (
    <header>
      <h1 className="finance-header-bar">
        <div className="finance-header-spacer" />
        <div className="finance-header-center">
          <Select
            data={budgetOptions}
            value={activeBudgetKey}
            onChange={handleChange}
            styles={{
              input: {
                fontSize: '1.5rem',
                fontWeight: 'bold',
                border: '1px solid #FFFFFF33', // data-color: hairline on the charcoal header bar
                textAlign: 'center',
                backgroundColor: 'transparent',
                color: 'white',
                cursor: 'pointer',
              },
              rightSection: { pointerEvents: 'none' },
            }}
            rightSection={<span className="finance-header-caret">▼</span>}
            clearable={false}
          />
        </div>
        <div className="finance-header-actions">
          <ReloadButton finance={finance} />
          <button
            className="payroll-btn"
            onClick={() => setDrawerContent({ type: 'payroll', title: 'Sync Payroll' })}
            title="Sync Payroll"
            aria-label="Sync payroll"
          >
            💰
          </button>
        </div>
      </h1>
    </header>
  );
}

export function BudgetViewer({ budget, mortgage, finance }) {
  const [drawerContent, setDrawerContent] = useState(null);

  const [activeBudgetKey, setActiveBudgetKey] = useState(() => {
    const keys = Object.keys(budget);
    const today = moment().format('YYYY-MM-DD');
    const current = keys.find(k => {
      const b = budget[k];
      return today >= b.budgetStart && today <= b.budgetEnd;
    });
    return current || keys[0];
  });
  const activeBudget = budget[activeBudgetKey];
  const availableBudgetKeys = Object.keys(budget);
  const financeContextValue = useMemo(() => ({ reload: finance.load }), [finance.load]);

  return (
    <FinanceDataContext.Provider value={financeContextValue}>
      <div className="budget-viewer">
        <Header
          availableBudgetKeys={availableBudgetKeys}
          activeBudgetKey={activeBudgetKey}
          setActiveBudgetKey={setActiveBudgetKey}
          finance={finance}
          setDrawerContent={setDrawerContent}
        />
        <Drawer
          opened={!!drawerContent}
          onClose={() => setDrawerContent(null)}
          title={drawerContent?.title}
          size="90vw"
          position="right"
          padding="md"
          className="txn-drawer"
          style={FINANCE_VARS}
        >
          <FinanceErrorBoundary label="Drawer">
            <DrawerHost descriptor={drawerContent} budget={activeBudget} mortgage={mortgage} />
          </FinanceErrorBoundary>
        </Drawer>
        <div className="grid-container">
          <FinanceErrorBoundary label="Monthly Cash Flow"><BudgetCashFlow setDrawerContent={setDrawerContent} budget={activeBudget} /></FinanceErrorBoundary>
          <FinanceErrorBoundary label="Short Term Savings"><BudgetShortTerm setDrawerContent={setDrawerContent} budget={activeBudget} /></FinanceErrorBoundary>
          <FinanceErrorBoundary label="Day-to-day Spending"><BudgetDayToDay setDrawerContent={setDrawerContent} budget={activeBudget} /></FinanceErrorBoundary>
          <FinanceErrorBoundary label="Spending"><BudgetSpending setDrawerContent={setDrawerContent} budget={activeBudget} /></FinanceErrorBoundary>
          <FinanceErrorBoundary label="Mortgage"><BudgetMortgage setDrawerContent={setDrawerContent} mortgage={mortgage} /></FinanceErrorBoundary>
          <FinanceErrorBoundary label="Transfers"><BudgetHoldings setDrawerContent={setDrawerContent} budget={activeBudget} /></FinanceErrorBoundary>
        </div>
      </div>
    </FinanceDataContext.Provider>
  );
}
