import { useEffect, useRef, useState } from 'react';
import { Button } from '@mantine/core';
import { DateStepper } from '@/lib/ui';
import { headlineFor } from '@shared-contracts/health/budgetZone.mjs';
import { budgetGeometry } from './budgetGeometry.js';

const n = (v) => Math.round(Number(v || 0)).toLocaleString();
const pct = (part, whole) => (whole > 0 ? `${(Math.max(0, part) / whole) * 100}%` : '0%');

// Macro goals live on goals as `macroGoals: { proteinG, carbsG, fatG }`.
const MACROS = [
  { key: 'protein', goalKey: 'proteinG', label: 'Protein' },
  { key: 'carbs', goalKey: 'carbsG', label: 'Carbs' },
  { key: 'fat', goalKey: 'fatG', label: 'Fat' },
];

/**
 * The day's calories as one bar on a fixed scale, with two marks that never
 * move with the day: the Goal (the budget — break-even less the planned
 * deficit) and Break even (the estimated burn, `maintenance`). The fill is NET
 * calories (eaten − burned): green up to the goal, amber between goal and
 * break-even, red past break-even. Exercise is a light band from net up to what
 * was eaten, so both numbers read off the same scale.
 * Nothing here is shown as a negative: "eaten", "burned", "left", "over".
 */
// Room past the furthest mark, so the break-even label and a small surplus fit.
const HEADROOM = 1.12;
function BudgetBar({ budget, dayClose = null }) {
  const goal = Number(budget.budget) || 0;
  const breakEven = Number(budget.maintenance) || 0;
  const exercise = Math.max(0, Number(budget.exercise) || 0);
  const food = Math.max(0, Number(budget.food) || 0);
  // The legacy bar paints from 0; the terms line states the real net, which a
  // big workout can take below zero.
  const net = Math.max(0, food - exercise);
  const realNet = food - exercise;
  const over = budget.status === 'over';
  const scale = Math.max(goal, breakEven, food) * HEADROOM;
  const band = (from, to) => ({ left: pct(from, scale), width: pct(Math.max(0, to - from), scale) });
  // A mark's label hangs off the side of its line with more room.
  const mark = (value, cls, label) => <span className={`health-budget__mark health-budget__mark--${cls}${value / scale > 0.5 ? ' health-budget__mark--end' : ''}`}
    style={{ left: pct(value, scale) }}><span className="health-budget__mark-label">{label} <b>{n(value)}</b></span></span>;
  const sameMark = breakEven > 0 && Math.round(breakEven) === Math.round(goal);
  const balance = breakEven > 0 ? breakEven - realNet : null;
  // The headline names the segment its number measures (the shared zone rule).
  // A legacy budget without a zone keeps the old two-way wording.
  const headline = budget.zone
    ? headlineFor(budget)
    : { value: Math.abs(budget.remaining), text: over ? 'over goal' : 'left' };
  const spoken = headline.value == null ? headline.text : `${n(headline.value)} ${headline.text}`;
  return (
    <div className="health-budget">
      <div className="health-budget__head">
        <span className={`health-budget__headline${budget.zone ? ` health-budget__headline--${budget.zone}` : ''}`} data-testid="budget-headline">
          {headline.value == null ? headline.text : <><strong>{n(headline.value)}</strong> kcal {headline.text}</>}
        </span>
        <span className="health-budget__terms" data-testid="budget-terms">
          <span>{n(food)} eaten</span>
          {exercise > 0 ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className="health-budget__exercise-term">{n(exercise)} burned</span>
            <span className="health-budget__sep" aria-hidden="true">·</span>
            <span>{realNet < 0 ? `−${n(-realNet)}` : n(realNet)} net</span></> : null}
          {balance != null ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className={balance >= 0 ? 'health-budget__deficit' : 'health-budget__surplus'}>{balance >= 0 ? `${n(balance)} deficit` : `${n(-balance)} surplus`}</span></> : null}
          {budget.stale ? <span className="health-equation__stale" title="Latest weigh-in is over a week old">stale wt</span> : null}
        </span>
        {dayClose}
      </div>
      {budget.range && budget.zone ? <RulerScale budget={budget} spoken={spoken} /> : (
      <div className="health-budget__scale">
        <div className="health-budget__track" role="img"
          aria-label={`${n(net)} net kcal of ${n(goal)} goal${breakEven ? `, break even ${n(breakEven)}` : ''}, ${spoken}`}>
          {exercise > 0 ? <span className="health-budget__burned" style={band(net, food)} /> : null}
          <span className="health-budget__net" style={band(0, Math.min(net, goal))} />
          {net > goal ? <span className="health-budget__over-goal" style={band(goal, breakEven > goal ? Math.min(net, breakEven) : net)} /> : null}
          {breakEven > goal && net > breakEven ? <span className="health-budget__surplus-fill" style={band(breakEven, net)} /> : null}
        </div>
        {mark(goal, 'goal', sameMark ? 'Goal · break even' : 'Goal')}
        {breakEven > 0 && !sameMark ? mark(breakEven, 'even', 'Break even') : null}
      </div>
      )}
    </div>
  );
}

// The track's rendered width, for tick density and label fit. jsdom (and any
// browser without ResizeObserver) keeps the phone default.
function useWidth(ref, fallback = 360) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const at = (p) => `${p.toFixed(2)}%`;
const endAnchored = (p) => (p > 50 ? ' health-budget__label--end' : '');

/**
 * The budget as a labelled ruler of FOOD eaten (budgetGeometry.js): the goal
 * band from the floor to the ceiling (top + exercise), a hatched exercise
 * credit from top to the ceiling, break-even, ticks, and the food block from 0
 * whose right edge is the one frontier, coloured by zone. A dotted run carries
 * the headline's number to the mark it measures against.
 */
function RulerScale({ budget, spoken }) {
  const ref = useRef(null);
  const g = budgetGeometry(budget, { widthPx: useWidth(ref) });
  const { band, even, earned, food, run, zone } = g;
  const hasWidth = band.toPct > band.fromPct;
  return (
    <div className="health-budget__ruler" ref={ref}>
      <div className="health-budget__rail health-budget__rail--above">
        <span className={`health-budget__band-label${endAnchored(band.fromPct)}`} style={{ left: at(band.fromPct) }}>{band.label}</span>
      </div>
      <div className="health-budget__track health-budget__track--ruler" role="img" data-testid="budget-ruler"
        aria-label={`${n(food.value)} kcal eaten; ${band.label.toLowerCase()}${earned ? `, plus ${n(earned.value)} burned` : ''}${even ? `; break even ${n(even.value)}` : ''}; ${spoken}`}>
        {hasWidth ? <span className="health-budget__band" style={{ left: at(band.fromPct), width: at(band.toPct - band.fromPct) }} /> : null}
        <span className={`health-budget__food health-budget__food--${zone}`} data-testid="budget-food" style={{ left: at(food.fromPct), width: at(food.widthPct) }} />
        {earned ? <span className="health-budget__earned" data-testid="budget-earned" style={{ left: at(earned.fromPct), width: at(earned.widthPct) }}>
          {earned.labelled ? <span className="health-budget__seg-label">+{n(earned.value)}</span> : null}</span> : null}
        {run ? <span className={`health-budget__run health-budget__run--${zone}`} data-testid="budget-run" style={{ left: at(run.fromPct), width: at(run.widthPct) }} /> : null}
        {hasWidth
          ? <span className="health-budget__band-edges" style={{ left: at(band.fromPct), width: at(band.toPct - band.fromPct) }} />
          : <span className="health-budget__goal-line" style={{ left: at(band.toPct) }} />}
        {/* Its own top layer, not a child of the food block: the band edges, the
            hatch and break-even all stack above the food and would cut through it. */}
        {food.labelled ? <span className={`health-budget__food-label health-budget__food-label--${food.outside ? 'outside' : zone}`} data-testid="budget-food-label"
          style={food.outside ? { left: at(food.fromPct + food.widthPct) } : { right: at(100 - (food.fromPct + food.widthPct)) }}>{n(food.value)} eaten</span> : null}
        {even ? <span className="health-budget__even" style={{ left: at(even.pct) }} /> : null}
      </div>
      <div className="health-budget__rail health-budget__ticks" aria-hidden="true">
        {g.ticks.map(t => <span key={t.value} className="health-budget__tick" style={{ left: at(t.pct) }}>
          {t.label ? <span className="health-budget__tick-label">{t.label}</span> : null}</span>)}
      </div>
      {even ? <div className="health-budget__rail health-budget__rail--below">
        <span className={`health-budget__even-label${endAnchored(even.pct)}`} style={{ left: at(even.pct) }}>
          {even.wordless ? null : 'Break even '}<b>{n(even.value)}</b></span>
      </div> : null}
    </div>
  );
}

/** One macro: grams, and a thin bar when it has a goal. */
function MacroMeter({ label, tone, value, partial, target }) {
  const hasGoal = target > 0;
  const over = hasGoal && value != null && value > target;
  const grams = value == null ? '—' : `${n(value)}${partial ? '+' : ''}`;
  const aria = `${label} ${grams} g${hasGoal ? ` of ${n(target)} g goal${over ? ', over goal' : ''}` : ''}${partial ? ', partial data' : ''}`;
  return (
    <div className={`health-macro-meter health-macro-tone--${tone}${over ? ' health-macro-meter--over' : ''}`} aria-label={aria}>
      <span className="health-macro-meter__label">{label}</span>
      <span className="health-macro-meter__value">{grams}{hasGoal ? <span className="health-macro-meter__target">{` / ${n(target)}`}</span> : null} g</span>
      {hasGoal ? <span className="health-macro-meter__track" aria-hidden="true">
        <span className="health-macro-meter__fill" style={{ width: `${Math.min(100, ((value || 0) / target) * 100)}%` }} />
      </span> : null}
    </div>
  );
}

/** Today's summary: the calorie budget as a bar, macros beside it. */
export function EquationStrip({ budget, budgetError, macroCoverage, goals, date, today, onDateChange, onSetupGoals, dayClose = null }) {
  const macroGoals = goals?.macroGoals || budget?.goals?.macroGoals || {};
  return (
    // A zoned budget colours its own headline; the legacy "over" tint is only
    // for a budget without a zone.
    <div className={`health-equation${budget?.status === 'over' && !budget?.zone ? ' health-equation--over' : ''}`}>
      <DateStepper date={date} onChange={onDateChange} max={today} />
      {budget ? (
        <div className="health-equation__math" aria-label="Daily nutrition summary">
          <BudgetBar budget={budget} dayClose={dayClose} />
          <div className="health-equation__macros">
            {MACROS.map(m => {
              const coverage = macroCoverage?.[m.key];
              return <MacroMeter key={m.key} label={m.label} tone={m.key} value={coverage?.value ?? null}
                partial={coverage?.value != null && coverage.covered < coverage.total}
                target={Number(macroGoals[m.goalKey]) || 0} />;
            })}
          </div>
        </div>
      ) : budgetError?.status === 409 ? (
        <Button size="xs" variant="light" onClick={onSetupGoals}>Set up goals</Button>
      ) : (
        <span className="health-equation__math">—</span>
      )}
    </div>
  );
}
export default EquationStrip;
