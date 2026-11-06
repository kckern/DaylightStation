/**
 * A transient announcement. Change `momentKey` to replay the entrance animation.
 *
 * The live region is a persistent wrapper: it is always mounted, so a screen
 * reader is already watching it when the text arrives (a region that mounts
 * together with its text is often not announced). It takes no layout
 * (`display: contents`); the keyed visual child carries `game-hud-moment` and
 * the caller's `className`, and is remounted whenever `momentKey` changes.
 */
export default function MomentBanner({ text, momentKey, title, subtitle, className = '' }) {
  const shown = Boolean(text || title);
  return (
    <div className="game-hud-moment-region" role="status" aria-live="polite">
      {shown && (
        <div key={momentKey} className={`game-hud-moment ${className}`.trim()}>
          {text || (
            <>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
