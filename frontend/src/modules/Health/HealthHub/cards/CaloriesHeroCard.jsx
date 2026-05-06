export function CaloriesHeroCard({ data, onClick }) {
  const cal = data?.avg?.calories;
  const protein = data?.avg?.protein;

  return (
    <button className="metric-card metric-card--hero" onClick={onClick} type="button">
      <div className="metric-card__label">CALORIES</div>
      <div className="metric-card__value">
        {typeof cal === 'number' ? cal.toLocaleString() : '—'}
      </div>
      <div className="metric-card__trend">
        avg · 30d{typeof protein === 'number' ? ` · ${protein}g protein` : ''}
      </div>
    </button>
  );
}

export default CaloriesHeroCard;
