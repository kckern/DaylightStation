import { useState, useMemo } from 'react';
import { Stack, Paper } from '@mantine/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLifeUsername } from '../../hooks/useLifeUser.js';
import { ScopeSelector } from "./shared/ScopeSelector.jsx";
import { CategoryFilter } from "./shared/CategoryFilter.jsx";
import { LogDayDetail } from "./LogDayDetail.jsx";
import { LogWeekView } from "./LogWeekView.jsx";
import { LogMonthView } from "./LogMonthView.jsx";
import { LogSeasonView } from "./LogSeasonView.jsx";
import { LogYearView } from "./LogYearView.jsx";
import { LogDecadeView } from "./LogDecadeView.jsx";

const NO_CATEGORIES = [];

export function readLogVisit(location, owner) {
  const savedView = location.state?.logView;
  const ownView = savedView?.owner === owner ? savedView : undefined;
  return {
    // React Router assigns a new key on replace. Keep the initial visit key.
    visitKey: savedView?.visitKey ?? location.key,
    scope: ownView?.scope ?? 'week',
    categories: ownView?.categories ?? NO_CATEGORIES,
    date: ownView?.date,
  };
}

/**
 * Main log browser with scope switching and category filtering.
 * Renders the appropriate view based on the selected scope.
 */
export function LogBrowser({ username }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentMember = useLifeUsername();
  const owner = username ?? currentMember;
  const { visitKey, scope, categories, date } = readLogVisit(location, owner);
  const [initialDate] = useState(() => new Date().toISOString().slice(0, 10));
  const selectedDate = date ?? initialDate;

  const updateView = (nextScope, nextCategories) => {
    const { pathname, search, hash, state } = location;
    navigate({ pathname, search, hash }, {
      replace: true,
      state: { ...state, logView: { visitKey, owner, scope: nextScope, categories: nextCategories, date: selectedDate } },
    });
  };

  const viewProps = useMemo(() => ({
    username,
    categories: categories.length > 0 ? categories : undefined,
  }), [username, categories]);

  return (
    <Stack gap="md">
      <Paper p="sm" withBorder>
        <Stack gap="sm">
          <ScopeSelector value={scope} onChange={nextScope => updateView(nextScope, categories)} />
          <CategoryFilter selected={categories} onChange={nextCategories => updateView(scope, nextCategories)} />
        </Stack>
      </Paper>

      {scope === 'day' && <LogDayDetail date={selectedDate} {...viewProps} />}
      {scope === 'week' && <LogWeekView {...viewProps} />}
      {scope === 'month' && <LogMonthView {...viewProps} />}
      {scope === 'season' && <LogSeasonView {...viewProps} />}
      {scope === 'year' && <LogYearView {...viewProps} />}
      {scope === 'decade' && <LogDecadeView {...viewProps} />}
    </Stack>
  );
}
