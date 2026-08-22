// frontend/src/modules/Media/browse/HomeView.jsx
// Landing surface: resume card (current session) and recents. Recent leads —
// the config-driven "Browse X" category cards this view used to render below
// them duplicated the Browse tab that sits one thumb-tap below in the bottom
// nav, and pushed Recent off the fold on a phone screen (Task 16 / spec D7).
// Resume/recents bind to the local session; their empty states render
// friendly hints, never nothing.
import React from 'react';
import { Stack } from '@mantine/core';
import { ResumeCard } from './ResumeCard.jsx';
import { RecentsRow } from './RecentsRow.jsx';

export function HomeView() {
  return (
    <Stack data-testid="home-view" className="home-view" gap="lg">
      <ResumeCard />
      <RecentsRow />
    </Stack>
  );
}

export default HomeView;
