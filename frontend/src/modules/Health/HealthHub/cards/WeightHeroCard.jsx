import { Sparkline } from '@mantine/charts';

const TREND_COLOR = { down: '#10b981', up: '#ef4444', flat: '#94a3b8' };
const TREND_ARROW = { down: '▼', up: '▲', flat: '–' };

export function WeightHeroCard({ data, onClick }) {
  const lbs = data?.current?.lbs;
  const trend = data?.trend;
  const history = data?.history || [];

  const sparkData = history
    .map(h => (typeof h === 'number' ? h : (h?.lbs ?? null)))
    .filter(Number.isFinite);

  return (
    <button className="metric-card metric-card--hero" onClick={onClick} type="button">
      <div className="metric-card__label">WEIGHT</div>
      <div className="metric-card__value">
        {typeof lbs === 'number' ? lbs.toFixed(1) : '—'}{' '}
        <span className="metric-card__unit">lbs</span>
      </div>
      {trend && typeof trend.slopePerWeek === 'number' && (
        <div
          className="metric-card__trend"
          style={{ color: TREND_COLOR[trend.direction] || TREND_COLOR.flat }}
        >
          {TREND_ARROW[trend.direction] || '–'} {Math.abs(trend.slopePerWeek).toFixed(2)} lbs/wk
          <span className="metric-card__trend-period"> · last 30d</span>
        </div>
      )}
      {sparkData.length >= 2 && (
        <div className="metric-card__sparkline">
          <Sparkline
            data={sparkData}
            color="blue"
            curveType="natural"
            fillOpacity={0.2}
            strokeWidth={1.5}
            h={28}
          />
        </div>
      )}
    </button>
  );
}

export default WeightHeroCard;
