/** A transient announcement. Change `momentKey` to replay the entrance animation. */
export default function MomentBanner({ text, momentKey, title, subtitle, className = '' }) {
  if (!text && !title) return null;
  return (
    <div key={momentKey} className={`game-hud-moment ${className}`.trim()} role="status" aria-live="polite">
      {text || (
        <>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </>
      )}
    </div>
  );
}
