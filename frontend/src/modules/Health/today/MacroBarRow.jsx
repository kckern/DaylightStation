import { useEffect, useMemo } from 'react';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('macro-bar-row');

// Macro targets live on goals as `macroGoals: { proteinG, carbsG, fatG }`;
// the day's sums arrive as `budget.macros` keyed by the storage field name.
const MACROS = [
  { key: 'protein', goalKey: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'carbs', goalKey: 'carbsG', label: 'Carbs', unit: 'g' },
  { key: 'fat', goalKey: 'fatG', label: 'Fat', unit: 'g' },
];

const MICRO_LABELS = {
  sodium: { label: 'Sodium', unit: 'mg' },
  fiber: { label: 'Fiber', unit: 'g' },
  sugar: { label: 'Sugar', unit: 'g' },
  cholesterol: { label: 'Cholesterol', unit: 'mg' },
};

const num = (v) => Math.round(Number(v) || 0);
const fmt = (v) => num(v).toLocaleString();
const pctOf = (value, target) => (target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0);

/**
 * One bar. The fill is an inline width percentage because the value is data,
 * not design — everything else (colors, geometry, the track) is health.scss.
 */
function Bar({ label, value, target, unit, tone, caption, ariaLabel }) {
  const pct = pctOf(value, target);
  return (
    <div className={`health-macrobar__item health-macrobar__item--${tone}`}>
      <span className="health-macrobar__label">{label}</span>
      <span className="health-macrobar__track" role="img" aria-label={ariaLabel}>
        <span className="health-macrobar__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="health-macrobar__value">{fmt(value)}<span className="health-macrobar__target">{` / ${fmt(target)} ${unit}`}</span></span>
      {caption ? <span className="health-macrobar__caption">{caption}</span> : null}
    </div>
  );
}

/**
 * Macro progress and watch-micro bars for Today, directly under the equation
 * strip (PRD F4.1/F4.2).
 *
 * THE COVERAGE CAPTION IS NOT DECORATION. Every stored row carries
 * fiber/sugar/sodium/cholesterol as numbers, defaulted to 0 when nothing ever
 * measured them, so a sodium bar summed over rows with no micro data reads as
 * "you had almost no sodium" when the truth is "we have no idea". The caption
 * is the only thing standing between that arithmetic and a false reassurance,
 * so it renders whenever any counted item on the day lacks micro provenance.
 * Never suppress it to tidy the layout.
 */
export function MacroBarRow({ macros, goals, microCoverage }) {
  const macroGoals = goals?.macroGoals || null;
  const watchMicros = Array.isArray(goals?.watchMicros) ? goals.watchMicros : [];

  const macroBars = useMemo(() => {
    if (!macros || !macroGoals) return [];
    return MACROS
      .filter((m) => Number(macroGoals[m.goalKey]) > 0)
      .map((m) => {
        const value = num(macros[m.key]);
        const target = Number(macroGoals[m.goalKey]);
        const over = value > target;
        return {
          ...m,
          value,
          target,
          // A macro goal is a floor you aim at; exceeding it is worth flagging
          // (var(--ds-warning)) but it is not a failure the way a ceiling is.
          tone: over ? 'over-goal' : 'goal',
          ariaLabel: `${m.label} ${fmt(value)} of ${fmt(target)} ${m.unit} goal, ${pctOf(value, target)} percent${over ? ', over goal' : ''}`,
        };
      });
  }, [macros, macroGoals]);

  const microBars = useMemo(() => {
    if (!macros) return [];
    return watchMicros
      .filter((w) => MICRO_LABELS[w?.key] && Number(w.limit) > 0)
      .map((w) => {
        const meta = MICRO_LABELS[w.key];
        const value = num(macros[w.key]);
        const target = Number(w.limit);
        const ceiling = w.direction !== 'floor';
        const over = value > target;
        const coverage = microCoverage?.[w.key] || null;
        const short = coverage && coverage.total > 0 && coverage.covered < coverage.total;
        const caption = short ? `based on ${coverage.covered} of ${coverage.total} items` : null;
        return {
          key: w.key,
          label: meta.label,
          unit: meta.unit,
          value,
          target,
          // Over a ceiling is the one state that earns var(--ds-danger).
          // A floor that has not been reached yet is simply incomplete.
          tone: ceiling ? (over ? 'over-limit' : 'limit') : (over ? 'reached' : 'floor'),
          caption,
          ariaLabel: [
            `${meta.label} ${fmt(value)} of ${fmt(target)} ${meta.unit} ${ceiling ? 'limit' : 'target'}`,
            ceiling && over ? 'over limit' : null,
            !ceiling && over ? 'target reached' : null,
            caption,
          ].filter(Boolean).join(', '),
        };
      });
  }, [macros, watchMicros, microCoverage]);

  const signature = `${macroBars.length}:${microBars.length}:${microBars.filter((b) => b.caption).length}`;
  useEffect(() => {
    logger.debug('rendered', {
      macroBars: macroBars.length,
      microBars: microBars.length,
      barsWithCoverageGap: microBars.filter((b) => b.caption).length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // No targets configured means no bars — Progress is where goals are set, and
  // an empty scaffold here would be chrome with nothing to say.
  if (!macroBars.length && !microBars.length) return null;

  return (
    <div className="health-macrobar">
      {macroBars.map((b) => (
        <Bar key={b.key} label={b.label} value={b.value} target={b.target}
          unit={b.unit} tone={b.tone} ariaLabel={b.ariaLabel} />
      ))}
      {microBars.map((b) => (
        <Bar key={b.key} label={b.label} value={b.value} target={b.target}
          unit={b.unit} tone={b.tone} caption={b.caption} ariaLabel={b.ariaLabel} />
      ))}
    </div>
  );
}
export default MacroBarRow;
