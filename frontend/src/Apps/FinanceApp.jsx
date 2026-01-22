import { useState, useEffect, useMemo } from 'react'
import { Button, MantineProvider, Select, TextInput } from '@mantine/core';
import { BudgetHoldings,  BudgetSpending} from '../modules/Finances/blocks.jsx';
import { BudgetMortgage } from '../modules/Finances/blocks/mortgage.jsx';
import { BudgetCashFlow } from '../modules/Finances/blocks/monthly.jsx';
import { BudgetShortTerm } from '../modules/Finances/blocks/shortterm.jsx';
import { BudgetDayToDay } from '../modules/Finances/blocks/daytoday.jsx';
import { Drawer } from '@mantine/core';
import 'react-modern-drawer/dist/index.css'
import "./FinanceApp.scss"
import '@mantine/core/styles.css';
import spinner from '../assets/icons/spinner.svg';
import moment from 'moment';
import { getChildLogger } from '../lib/logging/singleton.js';

const isLocalhost = /localhost/.test(window.location.href);

const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
const financeLogger = getChildLogger({ app: 'finance' });

const fetchBudget = async () => {
  const response = await fetch(`${baseUrl}/api/v1/finance/data`);
  const data = await response.json();
  return data;
}

const reloadBudget = async () => {
  await fetch(`${baseUrl}/api/v1/harvest/budget`);
}

const syncPayroll = async (token) => {
  const url = token
    ? `${baseUrl}/api/v1/harvest/payroll?token=${encodeURIComponent(token)}`
    : `${baseUrl}/api/v1/harvest/payroll`;
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Payroll sync failed');
  }
  return response.json();
}


export default function App() {
  const [budgetData, setBudgetData] = useState(null);
  const [mortgageData, setMortgageData] = useState(null);
  useEffect(() => {
    fetchBudget().then(({budgets,mortgage}) => { setBudgetData(budgets); setMortgageData(mortgage); });
  }, []);
  return (
    <MantineProvider>
      {budgetData ? (
        <BudgetViewer budget={budgetData} mortgage={mortgageData} setBudgetData={setBudgetData} />
      ) : (
        <div style={{ padding: '1rem' }}>
          <div
            style={{
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              backgroundColor: '#f8f9fa',
              padding: '1rem',
              textAlign: 'center',
              color: '#495057',
            }}
          >
            <strong>Loading...</strong>
          </div>
        </div>
      )}
    </MantineProvider>
  );
}

function ReloadButton({setBudgetData}) {

  const [reloading, setReloading] = useState(false);
  const handleClick = async () => {
    setReloading(true);
    await reloadBudget();
    const newData = await fetchBudget()
    setBudgetData(newData.budgets);
    setReloading(false);
  }
  return <button
    style={{float: 'right'}} className={reloading ? 'reload reloading' : 'reload'} onClick={handleClick}>{reloading  ? <img src={spinner} alt="loading" /> : '🔄'}</button>

}

function PayrollSyncContent({ onClose }) {
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
      <Button
        onClick={handleSync}
        loading={syncing}
        disabled={syncing}
        fullWidth
      >
        {syncing ? 'Syncing...' : 'Sync Payroll'}
      </Button>
      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fee', borderRadius: '4px', color: '#c00' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#efe', borderRadius: '4px', color: '#060' }}>
          Payroll synced successfully!
        </div>
      )}
    </div>
  );
}




function Header({
  availableBudgetKeys = [],
  activeBudgetKey,
  setActiveBudgetKey,
  setBudgetData,
  setDrawerContent,
}) {
  // Transform available budget keys into data for the Select component
  const budgetOptions = useMemo(() => (
    availableBudgetKeys.map((key) => ({
      value: key,
      label: moment(key).format('YYYY') + ' Budget',
    }))
  ), [availableBudgetKeys]);

  // Default to the first key if activeBudgetKey is missing
  const defaultValue = activeBudgetKey || budgetOptions?.[0]?.value || '';


  const handleChange = (value) => {
    financeLogger.info('finance.budget.change', { value });
    const isSameAsactiveBudgetKey = value === activeBudgetKey;
    if (isSameAsactiveBudgetKey) {
      return;
    }
    if (availableBudgetKeys.includes(value) === false) {
      financeLogger.error('finance.budget.invalidKey', { value, availableKeys: availableBudgetKeys });
      return;
    }
    setActiveBudgetKey(value);
  }

  return (
    <header>
      <h1 style={{ display: 'flex', alignItems: 'center', padding: '0 1rem' }}>
        <div style={{ flex: 1 }} />

        {/* Centered, subtle "title" dropdown */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Select
            data={budgetOptions}
            value={defaultValue}
            onChange={handleChange}
            // Make the font size larger since it acts as a page title
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
              rightSection: {
                pointerEvents: 'none',
              },
            }}
            rightSection={<span style={{ fontSize: '1rem' }}>▼</span>}
            // Remove placeholder since we auto-select the first value
            clearable={false}
          />
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <ReloadButton setBudgetData={setBudgetData} />
          <button
            className="payroll-btn"
            onClick={() => setDrawerContent({
              meta: { title: 'Sync Payroll' },
              jsx: <PayrollSyncContent onClose={() => setDrawerContent(null)} />
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

export function BudgetViewer({ budget, mortgage, setBudgetData }) {

  const [drawerContent, setDrawerContent] = useState(null);
  const [budgetBlockDimensions, setBudgetBlockDimensions] = useState({ width: null, height: null });

  const [activeBudgetKey, setActiveBudgetKey] = useState(Object.keys(budget)[0]);
  const activeBudget = budget[activeBudgetKey];
  const availableBudgetKeys = Object.keys(budget);
  return (
    <div className="budget-viewer">
      <Header
        availableBudgetKeys={availableBudgetKeys}
        activeBudgetKey={activeBudgetKey}
        setActiveBudgetKey={setActiveBudgetKey}
        setBudgetData={setBudgetData}
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
        {drawerContent?.jsx || drawerContent}
      </Drawer>
      <div className="grid-container">
        <BudgetCashFlow setDrawerContent={setDrawerContent} budget={activeBudget} />
        <BudgetShortTerm
          setDrawerContent={setDrawerContent}
          budget={activeBudget}
          budgetBlockDimensions={budgetBlockDimensions}
        />
        <BudgetDayToDay
          setDrawerContent={setDrawerContent}
          budget={activeBudget}
          budgetBlockDimensions={budgetBlockDimensions}
        />
        <BudgetSpending setDrawerContent={setDrawerContent} budget={activeBudget} />
        <BudgetMortgage setDrawerContent={setDrawerContent} mortgage={mortgage} />
        <BudgetHoldings setDrawerContent={setDrawerContent} budget={activeBudget} />
      </div>
    </div>
  );


}