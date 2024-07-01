import { useState, useEffect } from 'react'
import yaml from 'js-yaml'


const fetchBudget = async () => {
  //get from http://localhost:3112/data/budget
  const response = await fetch('http://localhost:3112/data/budget');
  const data = await response.json();
  return data;
}

function App() {
  const [budgetData, setBudgetData] = useState(null);
  useEffect(() => {
    fetchBudget().then(({budget}) => setBudgetData(budget));
  }, []);
  return (
    <>
      {budgetData ? <BudgetViewer budget={budgetData} /> : <div>Loading...</div>}
    </>
  )
}

function BudgetViewer({budget})
{
  const {timeframe, monthly, periodic} = budget;
  return (
    <>
      <h2>Period</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
            <th>Spent</th>
            <th>Remaining</th>      
          </tr>
        </thead>
        <tbody>
          {periodic.map(({category, amount, spent, remaining}) => (
            <tr key={category}>
              <td>{category}</td>
              <td>{amount}</td>
              <td>{spent}</td>
              <td>{remaining}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
export default App
