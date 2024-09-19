import { useState, useEffect } from 'react'
import { Button, MantineProvider, TabsPanel } from '@mantine/core';
import { BudgetHoldings, BudgetGoals, BudgetMortgage} from './blocks.jsx';
import { BudgetMonthly } from './blocks/monthly.jsx';
import { BudgetShortTerm } from './blocks/shortterm.jsx';
import { BudgetDayToDay } from './blocks/daytoday.jsx';
import { Drawer } from '@mantine/core';
import 'react-modern-drawer/dist/index.css'
import "./budget.css"
import '@mantine/core/styles.css';

const fetchBudget = async () => {
  //get from http://localhost:3112/data/budget
  const response = await fetch('http://localhost:3112/data/budget');
  const data = await response.json();
  return data;
}


export default function App() {
  const [budgetData, setBudgetData] = useState(null);
  useEffect(() => {
    fetchBudget().then((budget) => setBudgetData(budget));
  }, []);
  return (
    <MantineProvider>
      {budgetData ? <BudgetViewer budget={budgetData} /> : <div>Loading...</div>}
    </MantineProvider>
  );
}


export function BudgetViewer({ budget }) {

  const [drawerContent, setDrawerContent] = useState(null);
  const [budgetBlockDimensions, setBudgetBlockDimensions] = useState({ width: null, height: null });
  return (
      <div className="budget-viewer">
        <header>
          <h1>Budget</h1>
        </header>
        <Drawer opened={!!drawerContent} onClose={() => setDrawerContent(null)} title={drawerContent?.meta?.title} size="90vw" position='right' offset={8} className='txn-drawer'>
          {drawerContent?.jsx || drawerContent}
        </Drawer>
        <div className="grid-container">
          <BudgetMonthly setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetShortTerm setDrawerContent={setDrawerContent} budget={budget} budgetBlockDimensions={budgetBlockDimensions}/>
          <BudgetDayToDay setDrawerContent={setDrawerContent} budget={budget} budgetBlockDimensions={budgetBlockDimensions}/>
    
          <BudgetMortgage setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetHoldings setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetGoals setDrawerContent={setDrawerContent} budget={budget}/>
        
        </div>
      </div>
    );


}