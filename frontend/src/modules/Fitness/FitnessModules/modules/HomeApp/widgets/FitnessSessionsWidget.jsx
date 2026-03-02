import React, { useState, useRef } from 'react';
import { useScreenData } from '../../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useScreen } from '../../../../../../screen-framework/providers/ScreenProvider.jsx';
import { WorkoutsCard } from '../DashboardWidgets.jsx';

export default function FitnessSessionsWidget() {
  const rawSessions = useScreenData('sessions');
  const { replace, restore } = useScreen();
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const revertRef = useRef(null);

  const sessions = rawSessions?.sessions || [];

  const handleSessionClick = (sessionId) => {
    if (selectedSessionId === sessionId) {
      // Deselect — restore right area to original config
      revertRef.current?.revert();
      revertRef.current = null;
      setSelectedSessionId(null);
      return;
    }

    // Revert previous replacement if any
    revertRef.current?.revert();

    setSelectedSessionId(sessionId);
    revertRef.current = replace('right-area', {
      children: [{ widget: 'fitness:session-detail', props: { sessionId } }]
    });
  };

  return (
    <WorkoutsCard
      sessions={sessions}
      onSessionClick={handleSessionClick}
      selectedSessionId={selectedSessionId}
    />
  );
}
