import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import HomeApp from './Apps/HomeApp.jsx';
import TVApp from './Apps/TVApp.jsx';
import FinanceApp from './Apps/FinanceApp.jsx';
import HealthApp from './Apps/HealthApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import Blank from './modules/Blank/Blank.jsx';


// WebSocket listener component
import { useEffect } from 'react';

function WebSocketListener() {
  const navigate = useNavigate();
  useEffect(() => {
    // Use window.location for host/port, ws protocol
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost = window.location.hostname;
    const wsPort = 3112;
    const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}/ws/nav`;
    const ws = new window.WebSocket(wsUrl);
    ws.onopen = () => {
      // WebSocket connection opened
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.url) {
          navigate(data.url);
        }
      } catch (e) {
        // ignore non-JSON or irrelevant messages
      }
    };
    ws.onclose = () => {
      // WebSocket connection closed
    };
    ws.onerror = (err) => {
      // WebSocket error occurred
    };
    return () => ws.close();
  }, [navigate]);
  return null;
}


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <WebSocketListener />
      <Routes>
        <Route path="/" element={<HomeApp />} />
        <Route path="/budget" element={<FinanceApp />} />
        <Route path="/finances" element={<FinanceApp />} />
        <Route path="/tv" element={<TVApp />} />
        <Route path="/health" element={<HealthApp />} />
        <Route path="/fitness" element={<FitnessApp />} />
        <Route path="*" element={<Blank />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);