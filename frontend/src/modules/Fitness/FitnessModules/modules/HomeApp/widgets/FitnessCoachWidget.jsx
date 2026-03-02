import React from 'react';
import { useScreenData } from '../../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '../../../../FitnessScreenProvider.jsx';
import { CoachCard } from '../DashboardWidgets.jsx';

export default function FitnessCoachWidget() {
  const dashboard = useScreenData('dashboard');
  const nutrition = useScreenData('nutrition');
  const { onCtaAction } = useFitnessScreen();

  if (!dashboard?.dashboard?.coach) return null;

  return (
    <CoachCard
      coach={dashboard.dashboard.coach}
      liveNutrition={nutrition?.data ? { logged: true } : null}
      onCtaAction={onCtaAction}
    />
  );
}
