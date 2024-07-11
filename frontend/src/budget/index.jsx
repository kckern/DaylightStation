import { useState, useEffect } from 'react'
import { Button, MantineProvider, TabsPanel } from '@mantine/core';
import { BudgetMonthOverMonth, BudgetOverview, BudgetMortgage, BudgetMonthlyExpenses, BudgetYearly, BudgetRetirement} from './blocks.jsx';
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
    fetchBudget().then(({budget}) => setBudgetData(budget));
  }, []);
  
  return (
    <MantineProvider>
      {budgetData ? <BudgetViewer budget={budgetData} /> : <div>Loading...</div>}
    </MantineProvider>
  );
}


export function BudgetViewer({ budget }) {

  const [drawerContent, setDrawerContent] = useState(null);

return (
    <div className="budget-viewer">
      <header>
        <h1>Budget</h1>
      </header>
      <Drawer opened={!!drawerContent} onClose={() => setDrawerContent(null)} title="Authentication" size="90vw" position='right' offset={8}>
        <Button onClick={() => setDrawerContent(null)}>Close</Button>
        {drawerContent}
      </Drawer>
      <div className="grid-container">
          <BudgetMonthlyExpenses setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetYearly setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetMonthOverMonth setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetOverview setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetMortgage setDrawerContent={setDrawerContent} budget={budget}/>
          <BudgetRetirement setDrawerContent={setDrawerContent} budget={budget}/>
        </div>
    </div>
  );


}