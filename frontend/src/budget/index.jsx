import { useState, useEffect } from 'react'
import { Button, MantineProvider, TabsPanel } from '@mantine/core';
import { BudgetHoldings, BudgetGoals} from './blocks.jsx';
import { BudgetMortgage } from './blocks/mortgage.jsx';
import { BudgetMonthly } from './blocks/monthly.jsx';
import { BudgetShortTerm } from './blocks/shortterm.jsx';
import { BudgetDayToDay } from './blocks/daytoday.jsx';
import { Drawer } from '@mantine/core';
import 'react-modern-drawer/dist/index.css'
import "./budget.css"
import '@mantine/core/styles.css';
import spinner from '../assets/icons/spinner.svg';

const isLocalhost = /localhost/.test(window.location.href);

const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;

const fetchBudget = async () => {
  console.log('fetching budget')
  const response = await fetch(`${baseUrl}/data/budget`);
  const data = await response.json();
  return data;
}

const reloadBudget = async () => {
  const response = await fetch(`${baseUrl}/harvest/budget`);
  const data = await response.json();
  return data;
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
    setBudgetData(newData);
    setReloading(false);
  }
  return <button
    style={{float: 'right'}} className={reloading ? 'reload reloading' : 'reload'} onClick={handleClick}>{reloading  ? <img src={spinner} alt="loading" /> : '🔄'}</button>

}

export function BudgetViewer({ budget, mortgage, setBudgetData }) {

  const [drawerContent, setDrawerContent] = useState(null);
  const [budgetBlockDimensions, setBudgetBlockDimensions] = useState({ width: null, height: null });
  return (
      <div className="budget-viewer">
        <header>
          <h1>Budget <ReloadButton setBudgetData={setBudgetData} /></h1>
          
        </header>
        <Drawer opened={!!drawerContent} onClose={() => setDrawerContent(null)} title={drawerContent?.meta?.title} size="90vw" position='right' offset={8} className='txn-drawer'>
          {drawerContent?.jsx || drawerContent}
        </Drawer>
        <div className="grid-container">
          <BudgetMonthly setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetShortTerm setDrawerContent={setDrawerContent} budget={budget} budgetBlockDimensions={budgetBlockDimensions}/>
          <BudgetDayToDay setDrawerContent={setDrawerContent} budget={budget} budgetBlockDimensions={budgetBlockDimensions}/>
    
          <BudgetMortgage setDrawerContent={setDrawerContent} mortgage={mortgage}/>
          <BudgetHoldings setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetGoals setDrawerContent={setDrawerContent} budget={budget}/>
        
        </div>
      </div>
    );


}