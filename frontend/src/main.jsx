import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom'; // Step 2: Import BrowserRouter, Routes, and Route
import App from './App.jsx';
import BudgetApp from './budget/index.jsx'; // Step 5: Import the new component
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter> {/* Step 3: Wrap with BrowserRouter */}
      <Routes> {/* Step 4: Use Routes to define Route components */}
        <Route path="/" element={<App />} />
        <Route path="/budget" element={<BudgetApp />} /> {/* Example of another route */}
        {/* Add more <Route> components as needed */}
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);