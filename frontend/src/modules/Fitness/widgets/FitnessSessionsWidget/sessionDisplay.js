import { getActivityDisplay, primaryActivity } from '@/modules/Fitness/lib/activities/fitnessActivityRegistry.jsx';

export function resolveSessionActivity(s) {
  if (s?.media?.primary) return null;
  const act = primaryActivity(s?.activities);
  if (!act) return null;
  const display = getActivityDisplay(act.type);
  return display ? { ...act, display } : null;
}

export function resolveSessionTitle(s) {
  const pm = s?.media?.primary;
  if (pm?.title) return pm.title;
  if (s?.strava?.name) return s.strava.name;
  const act = resolveSessionActivity(s);
  if (act) return act.display.label(act.count);
  return 'Workout';
}
