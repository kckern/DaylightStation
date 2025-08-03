import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WebSocketProvider } from './contexts/WebSocketContext.jsx';
import HomeApp from './Apps/HomeApp.jsx';
import TVApp from './Apps/TVApp.jsx';
import FinanceApp from './Apps/FinanceApp.jsx';
import HealthApp from './Apps/HealthApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import Blank from './modules/Blank/Blank.jsx';

// Wrapper component for HomeApp with WebSocket
const HomeAppWithWebSocket = () => (
  <WebSocketProvider>
    <HomeApp />
  </WebSocketProvider>
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<HomeAppWithWebSocket />} />
      <Route path="/budget" element={<FinanceApp />} />
      <Route path="/finances" element={<FinanceApp />} />
      <Route path="/tv" element={<TVApp />} />
      <Route path="/health" element={<HealthApp />} />
      <Route path="/fitness" element={<FitnessApp />} />
      <Route path="*" element={<Blank />} />
    </Routes>
  </BrowserRouter>,
);