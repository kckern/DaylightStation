import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom'; // Step 2: Import BrowserRouter, Routes, and Route
import HomeApp from './Apps/HomeApp.jsx';
import TVApp from './Apps/TVApp.jsx';
import FinanceApp from './Apps/FinanceApp.jsx';
import HealthApp from './Apps/HealthApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import Blank from './modules/Blank.jsx';
import './index.css';



ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter> {/* Step 3: Wrap with BrowserRouter */}
      <Routes> {/* Step 4: Use Routes to define Route components */}
        <Route path="/" element={<HomeApp />} />
        <Route path="/budget" element={<FinanceApp />} /> {/* Example of another route */}
        <Route path="/finances" element={<FinanceApp />} /> {/* Example of another route */}
        <Route path="/tv" element={<TVApp />} /> {/* Example of another route */}
        <Route path="/health" element={<HealthApp />} /> {/* Added HealthApp route */}
        <Route path="/fitness" element={<FitnessApp />} /> {/* Added FitnessApp route */}
        {/* Evertyhign else */}
        <Route path="*" element={<Blank />} /> {/* Fallback route */}
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);