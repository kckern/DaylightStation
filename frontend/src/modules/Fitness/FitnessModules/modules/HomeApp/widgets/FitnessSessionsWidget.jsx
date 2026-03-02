import React, { useState } from 'react';
import { useScreenData } from '../../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useSlot } from '../../../../../../screen-framework/slots/ScreenSlotProvider.jsx';
import { WorkoutsCard } from '../DashboardWidgets.jsx';

export default function FitnessSessionsWidget() {
  const rawSessions = useScreenData('sessions');
  const { show } = useSlot('detail-area');
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  const sessions = rawSessions?.sessions || [];

  const handleSessionClick = (sessionId) => {
    setSelectedSessionId(sessionId);
    show('fitness:chart', { sessionId });
  };

  return (
    <WorkoutsCard
      sessions={sessions}
      onSessionClick={handleSessionClick}
      selectedSessionId={selectedSessionId}
    />
  );
}
