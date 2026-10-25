import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import PartyGamesApp from '../../__app_modules/games/party-games/browser/app/PartyGamesApp.jsx';
import PartyGamesHost from '../../__app_modules/games/party-games/browser/surfaces/PartyGamesHost.jsx';
function TV() {
  const {
    definitionId
  } = useParams();
  return <PartyGamesApp definitionId={definitionId} />;
}
createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path="/party-games/host/:sessionId" element={<PartyGamesHost />} /><Route path="/screens/living-room/party-games/:definitionId" element={<TV />} /></Routes></BrowserRouter>);
