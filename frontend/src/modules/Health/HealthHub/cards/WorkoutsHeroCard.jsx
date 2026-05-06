export function WorkoutsHeroCard({ data, onClick }) {
  const count = data?.weekCount ?? 0;
  const breakdown = data?.breakdown || [];
  const breakdownText = breakdown
    .map(b => `${b.count} ${b.type}${b.count !== 1 ? 's' : ''}`)
    .join(' · ');

  return (
    <button className="metric-card metric-card--hero" onClick={onClick} type="button">
      <div className="metric-card__label">WORKOUTS</div>
      <div className="metric-card__value">{count}</div>
      <div className="metric-card__trend">
        this week{breakdownText ? ` · ${breakdownText}` : ''}
      </div>
    </button>
  );
}

export default WorkoutsHeroCard;
