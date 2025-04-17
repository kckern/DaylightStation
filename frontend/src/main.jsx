import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom'; // Step 2: Import BrowserRouter, Routes, and Route
import App from './App.jsx';
import TVApp from './TVApp.jsx';
import FinanceApp from './budget/index.jsx'; // Step 5: Import the new component
import './index.css';


function CatchAll() {
  return (
    <div style={{ 
      // flex, vertical center, horizontal center
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      width: '100vw',
      fontSize: '2rem',
      color: '#FFF',
    }}>
      {/* Show host, path, parameters */}
      <pre>
        {JSON.stringify({
          url: window.location.href,
          host: window.location.host,
          path: window.location.pathname,
          searchParams: Object.fromEntries(new URLSearchParams(window.location.search))
        }, null, 2)}
      </pre>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter> {/* Step 3: Wrap with BrowserRouter */}
      <Routes> {/* Step 4: Use Routes to define Route components */}
        <Route path="/" element={<App />} />
        <Route path="/budget" element={<FinanceApp />} /> {/* Example of another route */}
        <Route path="/finances" element={<FinanceApp />} /> {/* Example of another route */}
        <Route path="/tv" element={<TVApp />} /> {/* Example of another route */}
        {/* Evertyhign else */}
        <Route path="*" element={<CatchAll />} /> {/* Fallback route */}
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);