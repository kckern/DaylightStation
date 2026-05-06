import { Skeleton } from '@mantine/core';
import { WeightHeroCard } from './cards/WeightHeroCard.jsx';
import { WorkoutsHeroCard } from './cards/WorkoutsHeroCard.jsx';
import { CaloriesHeroCard } from './cards/CaloriesHeroCard.jsx';
import WeightCard from '../cards/WeightCard.jsx';
import NutritionCard from '../cards/NutritionCard.jsx';
import SessionsCard from '../cards/SessionsCard.jsx';
import RecencyCard from '../cards/RecencyCard.jsx';
import GoalsCard from '../cards/GoalsCard.jsx';
import CoachingComplianceCard from '../widgets/CoachingComplianceCard.jsx';

/**
 * Adapt the raw API dashboard (today/recency/goals/history) shape to the
 * WeightHeroCard contract: { current: { lbs }, trend: { direction, slopePerWeek }, history[] }
 *
 * The API puts weight in dashboard.today.weight = { lbs, trend } where
 * trend is lbs/day (negative = loss). The history array comes from
 * dashboard.history.daily (objects with .weight.lbs).
 */
function buildWeightHeroData(dashboard) {
  const w = dashboard?.today?.weight;
  if (!w) return null;

  const slopeDay = typeof w.trend === 'number' ? w.trend : null;
  const slopePerWeek = slopeDay != null ? parseFloat((slopeDay * 7).toFixed(3)) : null;
  let direction = 'flat';
  if (slopePerWeek != null) {
    if (slopePerWeek < -0.005) direction = 'down';
    else if (slopePerWeek > 0.005) direction = 'up';
  }

  // Pull lbs values from history.daily for sparkline
  const history = (dashboard?.history?.daily || [])
    .map(d => d?.weight?.lbs)
    .filter(v => typeof v === 'number');

  return {
    current: { lbs: w.lbs ?? null },
    trend: slopePerWeek != null ? { direction, slopePerWeek } : null,
    history,
  };
}

/**
 * Adapt to WorkoutsHeroCard contract: { weekCount, breakdown[] }
 *
 * The API does not directly expose weekly workout count in the dashboard
 * response — today.sessions is today's sessions only. We derive a
 * best-effort count from history.weekly[0] if available.
 */
function buildWorkoutsHeroData(dashboard) {
  const todaySessions = dashboard?.today?.sessions || [];
  const latestWeek = dashboard?.history?.weekly?.[0] || null;

  // weekCount: prefer the weekly roll-up, fall back to today's session count
  const weekCount = typeof latestWeek?.sessionCount === 'number'
    ? latestWeek.sessionCount
    : todaySessions.length;

  // Build breakdown from today's sessions (type → count)
  const typeMap = {};
  for (const s of todaySessions) {
    const type = s.type || s.activity || 'workout';
    typeMap[type] = (typeMap[type] || 0) + 1;
  }
  const breakdown = Object.entries(typeMap).map(([type, count]) => ({ type, count }));

  return { weekCount, breakdown };
}

/**
 * Adapt to CaloriesHeroCard contract: { avg: { calories, protein } }
 *
 * Average over the last 30 days of history.daily, or today's values if
 * history is not populated.
 */
function buildCaloriesHeroData(dashboard) {
  const daily = dashboard?.history?.daily || [];
  const recent = daily.slice(0, 30).filter(d => d?.nutrition?.calories != null);

  if (recent.length > 0) {
    const avgCal = Math.round(recent.reduce((s, d) => s + (d.nutrition.calories || 0), 0) / recent.length);
    const proteinDays = recent.filter(d => d?.nutrition?.protein != null);
    const avgProtein = proteinDays.length > 0
      ? Math.round(proteinDays.reduce((s, d) => s + (d.nutrition.protein || 0), 0) / proteinDays.length)
      : null;
    return { avg: { calories: avgCal, protein: avgProtein } };
  }

  // Fall back to today
  const todayNutrition = dashboard?.today?.nutrition;
  return {
    avg: {
      calories: todayNutrition?.calories ?? null,
      protein: todayNutrition?.protein ?? null,
    },
  };
}

export default function HealthHub({ dashboard, loading, onCardClick = () => {}, onRefresh }) {
  if (loading) return <HealthHubSkeleton />;
  if (!dashboard) return null;

  const { today, recency, goals, userId } = dashboard;

  const weightHeroData = buildWeightHeroData(dashboard);
  const workoutsHeroData = buildWorkoutsHeroData(dashboard);
  const caloriesHeroData = buildCaloriesHeroData(dashboard);

  return (
    <main className="health-hub">
      <section className="health-hub__hero">
        <WeightHeroCard data={weightHeroData} onClick={() => onCardClick('weight')} />
        <WorkoutsHeroCard data={workoutsHeroData} onClick={() => onCardClick('sessions')} />
        <CaloriesHeroCard data={caloriesHeroData} onClick={() => onCardClick('nutrition')} />
      </section>

      <section className="health-hub__secondary">
        <WeightCard
          weight={today?.weight}
          recency={recency?.find(r => r.source === 'weight')}
          onClick={() => onCardClick('weight')}
        />
        <NutritionCard
          nutrition={today?.nutrition}
          onRefresh={onRefresh}
          onClick={() => onCardClick('nutrition')}
        />
        <SessionsCard
          sessions={today?.sessions}
          onClick={() => onCardClick('sessions')}
        />
        <CoachingComplianceCard username={userId} onSaved={onRefresh} />
        <RecencyCard recency={recency} />
        <GoalsCard
          goals={goals}
          onClick={() => onCardClick('goals')}
        />
      </section>
    </main>
  );
}

function HealthHubSkeleton() {
  return (
    <main className="health-hub">
      <section className="health-hub__hero">
        <Skeleton height={140} radius="md" />
        <Skeleton height={140} radius="md" />
        <Skeleton height={140} radius="md" />
      </section>
      <section className="health-hub__secondary">
        <Skeleton height={100} radius="md" />
        <Skeleton height={100} radius="md" />
        <Skeleton height={100} radius="md" />
      </section>
    </main>
  );
}
