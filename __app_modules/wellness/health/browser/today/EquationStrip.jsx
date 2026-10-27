import { useEffect, useRef, useState } from 'react';
import { Button } from '@mantine/core';
import { DateStepper } from '@/lib/ui';
import { budgetGeometry } from "./budgetGeometry.js";
import { budgetStory } from "./budgetStory.js";
import { budgetPresentation } from './budgetPresentation.js';
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";

const logger = createAppLogger('health').child('budget-card');

const n = (v) => Math.round(Number(v || 0)).toLocaleString('en-US');
const pct = (part, whole) => (whole > 0 ? `${(Math.max(0, part) / whole) * 100}%` : '0%');

// Macro goals live on goals as `macroGoals: { proteinG, carbsG, fatG }`.
const MACROS = [
  { key: 'protein', goalKey: 'proteinG', label: 'Protein' },
  { key: 'carbs', goalKey: 'carbsG', label: 'Carbs' },
  { key: 'fat', goalKey: 'fatG', label: 'Fat' },
];

/**
 * A ranged budget shows goal position and estimated energy balance separately,
 * above a food-scale ruler with a single endpoint-colored consumed fill.
 * A budget from an older server keeps the two-mark bar of NET
 * calories: green to the goal, amber to break even, red past it, with the
 * terms line stating net and the deficit.
 * Nothing here is shown as a negative except the legacy net term.
 */
// Room past the furthest mark, so the break-even label and a small surplus fit.
const HEADROOM = 1.12;
function BudgetBar({ budget, baseline = null, date = null, today = null, dayClose = null }) {
  const goal = Number(budget.budget) || 0;
  const breakEven = Number(budget.maintenance) || 0;
  const exercise = Math.max(0, Number(budget.exercise) || 0);
  const food = Math.max(0, Number(budget.food) || 0);
  // The legacy bar paints from 0; its terms line states the real net, which a
  // big workout can take below zero.
  const net = Math.max(0, food - exercise);
  const realNet = food - exercise;
  const over = budget.status === 'over';
  const story = budget.range && budget.zone ? budgetStory(budget, { date, today, baseline }) : null;
  const presentation = story ? budgetPresentation(budget, { finished: story.finished }) : null;
  const job = story?.job ?? null;
  useEffect(() => {
    if (job) logger.debug('budget-card.job', { job, date, spend: story.ladder.spend, finished: story.finished });
    // Once per job change, not per render or per drag frame.
  }, [job, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const headline = presentation?.position || { value: Math.abs(budget.remaining), text: over ? 'over goal' : 'left', sub: null };
  const spoken = headline.value == null ? headline.text : `${n(headline.value)} kcal ${headline.text}`;
  const scale = Math.max(goal, breakEven, food) * HEADROOM;
  const band = (from, to) => ({ left: pct(from, scale), width: pct(Math.max(0, to - from), scale) });
  // A mark's label hangs off the side of its line with more room.
  const mark = (value, cls, label) => <span className={`health-budget__mark health-budget__mark--${cls}${value / scale > 0.5 ? ' health-budget__mark--end' : ''}`}
    style={{ left: pct(value, scale) }}><span className="health-budget__mark-label">{label} <b>{n(value)}</b></span></span>;
  const sameMark = breakEven > 0 && Math.round(breakEven) === Math.round(goal);
  const balance = breakEven > 0 ? breakEven - realNet : null;
  const headlineClass = ['health-budget__headline',
    presentation && `health-budget__headline--${presentation.tone}`,
    job && `health-budget__headline--job-${job}`].filter(Boolean).join(' ');
  return (
    <div className="health-budget">
      <div className="health-budget__head">
        <span className="health-budget__lead">
          <span className={headlineClass} data-testid="budget-headline">
            {headline.value == null ? headline.text : <><strong>{n(headline.value)}</strong> kcal {headline.text}</>}
          </span>
          {presentation ? <span className="health-budget__sub" data-testid="budget-sub"><span data-testid="budget-balance">{presentation.balance}</span></span> : null}
        </span>
        <span className="health-budget__terms" data-testid="budget-terms">
          <span>{n(food)} eaten</span>
          {exercise > 0 ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className="health-budget__exercise-term">{n(exercise)} burned</span></> : null}
          {/* The ranged card states energy balance separately above the ruler. */}
          {!story && exercise > 0 ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span>{realNet < 0 ? `−${n(-realNet)}` : n(realNet)} net</span></> : null}
          {!story && balance != null ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className={balance >= 0 ? 'health-budget__deficit' : 'health-budget__surplus'}>{balance >= 0 ? `${n(balance)} deficit` : `${n(-balance)} surplus`}</span></> : null}
          {budget.stale ? <span className="health-equation__stale" title="Latest weigh-in is over a week old">stale wt</span> : null}
        </span>
        {dayClose}
      </div>
      {story ? <RulerScale budget={budget} baseline={baseline} spoken={`${spoken}; ${presentation.balance}`} tone={presentation.tone} finished={story.finished} tentative={story.tentative} /> : (
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
const endAnchored = (p) => (p > 50 ? ' health-budget__goal-range-label--end' : '');
/** A single food-scale bar: past intake is solid, future room is quiet. */
function RulerScale({ budget, baseline, spoken, tone, finished, tentative }) {
  const ref = useRef(null);
  const widthPx = useWidth(ref);
  const previewing = baseline && Number(baseline.food) !== Number(budget.food);
  const baselineRight = previewing ? budgetGeometry(baseline, { widthPx }).right : null;
  const g = budgetGeometry(budget, { widthPx, finished,
    baselineFood: previewing ? baseline.food : null, rightOverride: baselineRight });
  const rulerClass = ['health-budget__ruler', tentative && 'health-budget__ruler--tentative', finished && 'health-budget__ruler--finished']
    .filter(Boolean).join(' ');
  const segment = (part) => ({ left: at(part.fromPct), width: at(part.widthPct) });
  const goalLabel = g.goalRange ? `Goal ${n(g.goalRange.from)}–${n(g.goalRange.to)}` : null;
  return (
    <div className={rulerClass} ref={ref}>
      {g.goalRange ? <div className="health-budget__goal-rail" data-testid="budget-goal-range">
        <span className="health-budget__goal-bracket" style={segment(g.goalRange)} />
        <span className={`health-budget__goal-range-label${endAnchored(g.goalRange.toPct)}`}
          style={{ left: at(g.goalRange.toPct) }}>{goalLabel}</span>
      </div> : null}
      <div className={`health-budget__track health-budget__track--ruler health-budget__track--${tone}`} role="img" data-testid="budget-ruler" data-budget-tone={tone}
        aria-label={`${n(g.cursor.value)} kcal eaten${g.baselineCursor ? `, before preview ${n(g.baselineCursor.value)} kcal eaten` : ''}; ${g.posts.map(p => `${p.label.toLowerCase()} ${n(p.value)}`).join(', ')}; ${spoken}`}>
        <span className="health-budget__consumed" data-budget-consumed="eaten" style={{ left: '0%', width: at(g.cursor.pct) }} />
        {g.goalRange?.bonus?.spentWidthPct > 0 ? <span className="health-budget__bonus health-budget__bonus--spent"
          data-budget-bonus="spent" style={{ left: at(g.goalRange.bonus.fromPct), width: at(g.goalRange.bonus.spentWidthPct) }} /> : null}
        {g.posts.map(post => <span key={post.key}
          className={`health-budget__post health-budget__post--${post.key}`}
          style={{ left: at(post.pct) }} aria-hidden="true" />)}
        {g.baselineCursor ? <span className="health-budget__cursor health-budget__cursor--baseline"
          data-testid="budget-baseline-cursor" aria-label={`Before preview: ${n(g.baselineCursor.value)} kcal eaten`}
          style={{ left: at(g.baselineCursor.pct) }} /> : null}
        <span className={`health-budget__cursor${g.cursor.overflow ? ' health-budget__cursor--overflow' : ''}`}
          data-testid="budget-cursor" aria-label={`${n(g.cursor.value)} kcal eaten`}
          style={{ left: at(g.cursor.pct) }} />
      </div>
      <div className="health-budget__key" data-testid="budget-key">
        {g.posts.map(post => <span key={post.key} className="health-budget__key-item">
          <i className={`health-budget__key-mark health-budget__key-mark--${post.key}`} aria-hidden="true" />
          {post.label} {n(post.value)}
        </span>)}
        {g.boundaries.even == null ? <span className="health-budget__key-note">Break even unavailable</span> : null}
      </div>
      {g.capNote || g.floorIssue || g.cursor.overflow ? <div className="health-budget__detail">
        {g.capNote}{g.capNote && g.floorIssue ? ' · ' : null}{g.floorIssue ? 'Log floor exceeds plan' : null}
        {g.cursor.overflow ? `${g.capNote || g.floorIssue ? ' · ' : ''}${n(g.cursor.value)} eaten beyond scale` : null}
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
export function EquationStrip({ budget, baseline = null, budgetError, macroCoverage, goals, date, today, onDateChange, onSetupGoals, dayClose = null }) {
  const macroGoals = goals?.macroGoals || budget?.goals?.macroGoals || {};
  return (
    // A zoned budget colours its own headline; the legacy "over" tint is only
    // for a budget without a zone.
    <div className={`health-equation${budget?.status === 'over' && !budget?.zone ? ' health-equation--over' : ''}`}>
      <DateStepper date={date} onChange={onDateChange} max={today} />
      {budget ? (
        <div className="health-equation__math" aria-label="Daily nutrition summary">
          <BudgetBar budget={budget} baseline={baseline} date={date} today={today} dayClose={dayClose} />
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
