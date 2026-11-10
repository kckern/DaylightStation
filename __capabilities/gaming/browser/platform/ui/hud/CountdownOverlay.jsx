export default function CountdownOverlay({ value, className = '' }) {
  if (value === null || value === undefined) return null;
  return <div className={`game-hud-countdown${className ? ` ${className}` : ''}`}>{value}</div>;
}
