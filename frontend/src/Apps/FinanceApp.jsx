import { useState, useMemo, Component } from 'react';
import { Button, MantineProvider, Select, TextInput, Drawer } from '@mantine/core';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { BudgetHoldings, BudgetSpending } from '../modules/Finances/blocks.jsx';
import { BudgetMortgage } from '../modules/Finances/blocks/mortgage.jsx';
import { BudgetCashFlow } from '../modules/Finances/blocks/monthly.jsx';
import { BudgetShortTerm } from '../modules/Finances/blocks/shortterm.jsx';
import { BudgetDayToDay } from '../modules/Finances/blocks/daytoday.jsx';
import { useFinanceData } from '../modules/Finances/hooks/useFinanceData.mjs';
import { FinanceDataContext } from '../modules/Finances/FinanceDataContext.jsx';
import { DaylightAPI } from '../lib/api.mjs';
import 'react-modern-drawer/dist/index.css';
import './FinanceApp.scss';
import '@mantine/core/styles.css';
import spinner from '../assets/icons/spinner.svg';
import moment from 'moment';
import { getChildLogger } from '../lib/logging/singleton.js';

const financeLogger = getChildLogger({ app: 'finance' });

const syncPayroll = (token) =>
  DaylightAPI('api/v1/finance/payroll/sync', token ? { token } : {}, 'POST');

/** A render crash in any block must not blank the whole dashboard (audit 5.2). */
class FinanceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    financeLogger.error('finance.render.crash', { error: String(error), stack: info?.componentStack });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ margin: '1rem', padding: '1rem', border: '1px solid #c00', borderRadius: 8, background: '#fee', color: '#600' }}>
          <strong>Finance dashboard crashed.</strong>
          <div style={{ margin: '0.5rem 0', fontSize: '0.9em' }}>{String(this.state.error?.message || this.state.error)}</div>
          <Button onClick={() => window.location.reload()} variant="outline" color="red">Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useDocumentTitle('Finances');
  const finance = useFinanceData();
  const { data, error, load } = finance;

  return (
    <MantineProvider>
      {error && (
        <div style={{ margin: '1rem', padding: '1rem', border: '1px solid #c00', borderRadius: 8, background: '#fee', color: '#600' }}>
          <strong>Failed to load finance data.</strong>
          <div style={{ margin: '0.5rem 0', fontSize: '0.9em' }}>{String(error.message || error)}</div>
          <Button onClick={load} variant="outline" color="red">Retry</Button>
        </div>
      )}
      {!error && !data && (
        <div style={{ padding: '1rem' }}>
          <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, backgroundColor: '#f8f9fa', padding: '1rem', textAlign: 'center', color: '#495057' }}>
            <strong>Loading...</strong>
          </div>
        </div>
      )}
      {data && (
        <FinanceErrorBoundary>
          <BudgetViewer budget={data.budgets} mortgage={data.mortgage} finance={finance} />
        </FinanceErrorBoundary>
      )}
    </MantineProvider>
  );
}

function ReloadButton({ finance }) {
  const { refresh, refreshing } = finance;
  return (
    <button
      style={{ float: 'right' }}
      className={refreshing ? 'reload reloading' : 'reload'}
      onClick={refresh}
      disabled={refreshing}
    >
      {refreshing ? <img src={spinner} alt="loading" /> : '🔄'}
    </button>
  );
}

function PayrollSyncContent() {
  const [token, setToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const response = await syncPayroll(token);
      setResult(response);
      financeLogger.info('finance.payroll.sync.success', { response });
    } catch (err) {
      setError(err.message);
      financeLogger.error('finance.payroll.sync.error', { error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ padding: '1rem' }}>
      <p style={{ marginBottom: '1rem', color: '#666' }}>
        Enter your payroll session token to sync paychecks. Leave empty to use stored credentials.
      </p>
      <TextInput
        label="Session Token"
        placeholder="Paste token here (optional)"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={syncing}
        style={{ marginBottom: '1rem' }}
      />
      <Button onClick={handleSync} loading={syncing} disabled={syncing} fullWidth>
        {syncing ? 'Syncing...' : 'Sync Payroll'}
      </Button>
      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fee', borderRadius: 4, color: '#c00' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#efe', borderRadius: 4, color: '#060' }}>
          Payroll synced successfully!
        </div>
      )}
    </div>
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
      <h1 style={{ display: 'flex', alignItems: 'center', padding: '0 1rem' }}>
        <div style={{ flex: 1 }} />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Select
            data={budgetOptions}
            value={activeBudgetKey}
            onChange={handleChange}
            styles={{
              input: {
                fontSize: '1.5rem',
                fontWeight: 'bold',
                border: '1px solid #FFFFFF33',
                textAlign: 'center',
                backgroundColor: 'transparent',
                color: 'white',
                cursor: 'pointer',
              },
              rightSection: { pointerEvents: 'none' },
            }}
            rightSection={<span style={{ fontSize: '1rem' }}>▼</span>}
            clearable={false}
          />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <ReloadButton finance={finance} />
          <button
            className="payroll-btn"
            onClick={() => setDrawerContent({
              meta: { title: 'Sync Payroll' },
              jsx: <PayrollSyncContent />
            })}
            title="Sync Payroll"
            style={{ fontSize: '1.5rem', cursor: 'pointer', background: 'none', border: 'none', marginLeft: '0.5rem' }}
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
          title={drawerContent?.meta?.title}
          size="90vw"
          position="right"
          padding="md"
          className="txn-drawer"
        >
          {drawerContent?.jsx}
        </Drawer>
        <div className="grid-container">
          <BudgetCashFlow setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetShortTerm setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetDayToDay setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetSpending setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetMortgage setDrawerContent={setDrawerContent} mortgage={mortgage} />
          <BudgetHoldings setDrawerContent={setDrawerContent} budget={activeBudget} />
        </div>
      </div>
    </FinanceDataContext.Provider>
  );
}
