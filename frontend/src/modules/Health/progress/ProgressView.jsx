import { useEffect, useMemo, useRef, useState } from 'react';
import HighchartsReact from 'highcharts-react-official';
import Highcharts from 'highcharts';
import { Button, NumberInput, SegmentedControl, Stack, Text } from '@mantine/core';
import { SectionCard, StatCard, LoadingState, ErrorState } from '@/lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { localTodayISO } from '../today/mealBuckets.js';
import { MACRO_GOAL_FIELDS, WATCH_MICRO_FIELDS, setMacroGoal, setWatchMicro, watchFor } from './goalFields.js';

const logger = createAppLogger('health').child('progress');

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`); // noon anchor avoids DST edge shifts
  d.setDate(d.getDate() + n);
  return localTodayISO(d);
};

// Reads the --ds-* custom properties off a mounted DS-themed element — the
// chart config is ported from Weight.jsx's Highcharts usage, but hardcoded
// hex colors are swapped for the live token values (getComputedStyle, not
// Highcharts' CSS-styled mode: styled mode needs a stylesheet keyed to
// Highcharts' own class names, which is more machinery than one chart needs).
function readTokens(el) {
  const cs = getComputedStyle(el);
  const get = (name) => cs.getPropertyValue(name).trim();
  return {
    textMid: get('--ds-text-mid'),
    border: get('--ds-border'),
    accent: get('--ds-accent') || get('--ds-info'),
    success: get('--ds-success'),
  };
}

const fmtTrend = (dailyTrend) => {
  if (dailyTrend == null) return '—';
  const perWeek = Math.round(dailyTrend * 7 * 100) / 100;
  return perWeek > 0 ? `+${perWeek}` : `${perWeek}`;
};

const barHeightPx = (budget) => {
  if (!budget || !(budget.budget > 0)) return 4;
  const pct = Math.min(1, budget.food / budget.budget);
  return Math.max(4, Math.round(pct * 60));
};

/** Weight trend + goal editor + 14-day adherence bars — absorbs Weight.jsx's
 * chart and goal-setting UX for the new Health app (Weight.jsx itself stays,
 * unchanged, as the `health` screen-framework panel widget). */
export function ProgressView() {
  const containerRef = useRef(null);
  const [tokens, setTokens] = useState(null);
  useEffect(() => {
    if (containerRef.current) setTokens(readTokens(containerRef.current));
  }, []);

  const weightRes = useApiResource('api/v1/lifelog/weight', { label: 'weight', logger });
  const goalsRes = useApiResource('api/v1/health/goals', { label: 'goals', logger });
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Seed the form once goals load; a later reload (after save) must not
  // clobber in-progress edits, so only seed while form is still null.
  useEffect(() => {
    if (goalsRes.data?.goals && !form) setForm(goalsRes.data.goals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsRes.data]);

  const [adherence, setAdherence] = useState([]);
  const [adherenceLoading, setAdherenceLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setAdherenceLoading(true);
    const today = localTodayISO();
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));
    Promise.all(days.map((date) => DaylightAPI(`api/v1/health/budget?date=${date}`)
      .then((budget) => ({ date, budget }))
      .catch((err) => {
        logger.debug('adherence.day.gap', { date, status: err?.status });
        return { date, budget: null };
      })))
      .then((results) => { if (live) { setAdherence(results); setAdherenceLoading(false); } });
    return () => { live = false; };
  }, []);

  const entries = useMemo(() => {
    if (!weightRes.data) return [];
    return Object.values(weightRes.data)
      .filter((e) => e && e.date)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [weightRes.data]);

  const latest = entries[entries.length - 1] || null;

  const chartOptions = useMemo(() => {
    if (!tokens || !entries.length) return null;
    const windowed = entries.slice(-84); // ~12 weeks, matches Weight.jsx's precedent
    const categories = windowed.map((e) => new Date(`${e.date}T12:00:00`)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const avgData = windowed.map((e) => (e.lbs_adjusted_average != null ? e.lbs_adjusted_average : null));
    const goalLbs = form?.targetWeightLbs ?? goalsRes.data?.goals?.targetWeightLbs ?? null;
    const goalData = goalLbs ? windowed.map(() => goalLbs) : null;
    const values = avgData.filter((v) => v != null).concat(goalData || []);
    if (!values.length) return null;
    const minV = Math.min(...values);
    const maxV = Math.max(...values);

    return {
      chart: { backgroundColor: 'transparent', height: 240 },
      title: { text: null },
      credits: { enabled: false },
      legend: { enabled: false },
      yAxis: {
        min: Math.floor(minV) - 1,
        max: Math.ceil(maxV) + 1,
        tickInterval: 5,
        gridLineColor: tokens.border,
        gridLineWidth: 1,
        opposite: true,
        offset: -8,
        title: { enabled: false },
        labels: { style: { color: tokens.textMid, fontSize: '0.85rem' }, format: '{value} lbs' },
      },
      xAxis: {
        categories,
        tickInterval: 7,
        gridLineColor: tokens.border,
        gridLineWidth: 1,
        lineColor: tokens.border,
        labels: { rotation: -35, style: { color: tokens.textMid, fontSize: '0.75rem' } },
        // Weekly vertical guides (Weight.jsx's month-boundary plotLines,
        // ported to a week boundary — Monday — so the grid reads at the same
        // cadence as the weekly tickInterval above).
        plotLines: windowed.map((e, index) => (
          new Date(`${e.date}T12:00:00`).getDay() === 1
            ? { color: tokens.border, width: 1, value: index, zIndex: 1 }
            : null
        )).filter(Boolean),
      },
      plotOptions: {
        // Visible point markers on the smoothed series (Weight.jsx's
        // treatment) — small filled circles at every day, not just the
        // hover state.
        areaspline: {
          marker: { enabled: true, radius: 2.5, symbol: 'circle', fillColor: tokens.accent },
          lineWidth: 2,
          fillOpacity: 0.15,
          tooltip: {
            headerFormat: '',
            pointFormatter() { return `<b>${this.category}</b>: ${this.y.toFixed(1)} lbs`; },
          },
        },
        line: { marker: { enabled: false } },
      },
      series: [
        { type: 'areaspline', name: 'Weight (adjusted avg)', data: avgData, color: tokens.accent },
        ...(goalData ? [{ type: 'line', name: 'Goal', data: goalData, color: tokens.success, lineWidth: 1.5, dashStyle: 'Dash' }] : []),
      ],
    };
  }, [tokens, entries, form?.targetWeightLbs, goalsRes.data]);

  const saveGoals = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await DaylightAPI('api/v1/health/goals', form, 'PUT');
      logger.info('goals.saved', {});
      goalsRes.reload();
    } catch (err) {
      logger.error('goals.save.failed', { error: err?.message });
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="health-progress" ref={containerRef}>
      {weightRes.loading ? <LoadingState label="weight history" rows={5} /> : null}
      {weightRes.error ? <ErrorState error={weightRes.error} onRetry={weightRes.reload} label="Weight history" /> : null}
      {!weightRes.loading && !weightRes.error ? (
        <SectionCard title="Weight">
          {chartOptions ? <HighchartsReact highcharts={Highcharts} options={chartOptions} /> : null}
          {latest ? (
            <div className="health-progress__stats">
              <StatCard label="Current weight"
                value={Math.round((latest.lbs_adjusted_average || 0) * 10) / 10} unit="lbs" emphasis />
              <StatCard label="7-day trend" value={fmtTrend(latest.lbs_adjusted_average_7day_trend)} unit="lbs/wk" />
              <StatCard label="Body fat"
                value={latest.fat_percent_adjusted_average != null ? Math.round(latest.fat_percent_adjusted_average * 10) / 10 : '—'}
                unit="%" />
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Adherence — last 14 days">
        {adherenceLoading ? <LoadingState label="adherence" rows={2} /> : (
          <div className="health-progress__bars">
            {adherence.map(({ date, budget }) => (
              <div key={date}
                className={`health-progress__bar health-progress__bar--${budget ? budget.status : 'gap'}`}
                style={{ height: `${barHeightPx(budget)}px` }}
                title={budget ? `${date}: ${budget.food} / ${budget.budget} kcal (${budget.status})` : `${date}: no data`} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Goals">
        {!form ? <LoadingState label="goals" rows={4} /> : (
          <Stack gap="sm">
            {saveError ? <Text size="sm" c="red">{saveError.message}</Text> : null}
            <SegmentedControl value={form.sex || 'male'} onChange={(v) => setForm({ ...form, sex: v })}
              data={[{ label: 'Male', value: 'male' }, { label: 'Female', value: 'female' }]} />
            <NumberInput label="Target weight" suffix=" lbs" value={form.targetWeightLbs}
              onChange={(v) => setForm({ ...form, targetWeightLbs: v })} />
            <NumberInput label="Weekly rate" suffix=" lbs/wk" step={0.25} decimalScale={2} value={form.weeklyRateLbs}
              onChange={(v) => setForm({ ...form, weeklyRateLbs: v })} />
            <NumberInput label="Activity baseline" step={0.05} decimalScale={2} value={form.activityBaseline}
              onChange={(v) => setForm({ ...form, activityBaseline: v })} />
            <NumberInput label="Budget floor" suffix=" kcal" value={form.budgetFloor}
              onChange={(v) => setForm({ ...form, budgetFloor: v })} />
            <NumberInput label="Height" suffix=" in" value={form.heightIn}
              onChange={(v) => setForm({ ...form, heightIn: v })} />
            <NumberInput label="Birth year" hideControls={false} value={form.birthYear}
              onChange={(v) => setForm({ ...form, birthYear: v })} />

            {/* Macro targets (Task 6.1). Leave one blank and it is CLEARED, not
                zero — the bar row draws nothing for a macro with no target
                rather than drawing a bar against a goal of 0. */}
            <Text size="xs" c="dimmed">Macro goals — blank means no target</Text>
            {MACRO_GOAL_FIELDS.map((f) => (
              <NumberInput key={f.key} label={f.label} suffix=" g" min={0}
                value={form.macroGoals?.[f.key] ?? ''}
                onChange={(v) => setForm(setMacroGoal(form, f.key, v))} />
            ))}

            {/* Watch micros. Clearing a limit stops watching that micro
                outright — there is no "watched with no limit" state. */}
            <Text size="xs" c="dimmed">Watch micros — blank means not watched</Text>
            {WATCH_MICRO_FIELDS.map((f) => {
              const watch = watchFor(form, f.key);
              return (
                <div key={f.key} className="health-goals__watch">
                  <NumberInput label={`${f.label} limit`} suffix={` ${f.unit}`} min={0}
                    value={watch?.limit ?? ''}
                    onChange={(v) => setForm(setWatchMicro(form, f.key, { limit: v }))} />
                  {watch ? (
                    <SegmentedControl size="xs" value={watch.direction}
                      onChange={(v) => setForm(setWatchMicro(form, f.key, { direction: v }))}
                      data={[{ label: 'Stay under', value: 'ceiling' }, { label: 'Reach', value: 'floor' }]} />
                  ) : null}
                </div>
              );
            })}

            <Button onClick={saveGoals} loading={saving}>Save goals</Button>
          </Stack>
        )}
      </SectionCard>
    </div>
  );
}
export default ProgressView;
