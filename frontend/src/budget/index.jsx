import { useState, useEffect } from 'react'
import { Button, MantineProvider, Select, TabsPanel } from '@mantine/core';
import { BudgetHoldings,  BudgetSpending} from './blocks.jsx';
import { BudgetMortgage } from './blocks/mortgage.jsx';
import { BudgetCashFlow } from './blocks/monthly.jsx';
import { BudgetShortTerm } from './blocks/shortterm.jsx';
import { BudgetDayToDay } from './blocks/daytoday.jsx';
import { Drawer } from '@mantine/core';
import 'react-modern-drawer/dist/index.css'
import "./budget.css"
import '@mantine/core/styles.css';
import spinner from '../assets/icons/spinner.svg';
import moment from 'moment';

const isLocalhost = /localhost/.test(window.location.href);

const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;

const fetchBudget = async () => {
  const response = await fetch(`${baseUrl}/data/budget`);
  const data = await response.json();
  return data;
}

const reloadBudget = async () => {
  await fetch(`${baseUrl}/harvest/budget`);
}


export default function App() {
  const [budgetData, setBudgetData] = useState(null);
  const [mortgageData, setMortgageData] = useState(null);
  useEffect(() => {
    fetchBudget().then(({budgets,mortgage}) => { setBudgetData(budgets); setMortgageData(mortgage); });
  }, []);
  return (
    <MantineProvider>
      {budgetData ? <BudgetViewer budget={budgetData} mortgage={mortgageData} setBudgetData={setBudgetData} /> : <div>Loading...</div>}
    </MantineProvider>
  );
}

function ReloadButton({setBudgetData}) {

  const [reloading, setReloading] = useState(false);
  const handleClick = async () => {
    setReloading(true);
    await reloadBudget();
    const newData = await fetchBudget()
    console.log(newData);
    setBudgetData(newData.budgets);
    setReloading(false);
  }
  return <button
    style={{float: 'right'}} className={reloading ? 'reload reloading' : 'reload'} onClick={handleClick}>{reloading  ? <img src={spinner} alt="loading" /> : '🔄'}</button>

}

export function BudgetViewer({ budget, mortgage, setBudgetData }) {

  const [drawerContent, setDrawerContent] = useState(null);
  const [budgetBlockDimensions, setBudgetBlockDimensions] = useState({ width: null, height: null });

  const [activeBudgetKey, setActiveBudgetKey] = useState(Object.keys(budget)[0]);
  const activeBudget = budget[activeBudgetKey];
  const availableBudgetKeys = Object.keys(budget);
  return (
    <div className="budget-viewer">
      <header>
        <h1 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '1rem'}}>
          <Select
            data={availableBudgetKeys.map((key) => ({ value: key, label: moment(key).format('YYYY') }))}
            value={activeBudgetKey}
            onChange={(value) => setActiveBudgetKey(value)}
            placeholder="Select Budget"
            style={{ width: '6rem',  }}
          />
          <span>Budget</span>
          <ReloadButton setBudgetData={setBudgetData} />
        </h1>
      </header>
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
        <BudgetHoldings setDrawerContent={setDrawerContent} budget={budget} />
      </div>
    </div>
  );


}