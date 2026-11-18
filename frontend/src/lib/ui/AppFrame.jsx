import './ds.scss';

export const CHROME_SCROLL_CLASS = 'ds-chrome__main';

export function AppFrame({ className = '', header, navigation, context, footer, mainRef, expandedContext = false, children }) {
  return (
    <div className={['ds-chrome', expandedContext && 'ds-chrome--context', className].filter(Boolean).join(' ')}>
      {header && <header className="ds-chrome__header">{header}</header>}
      {(navigation || context) && (
        <nav className="ds-chrome__nav" aria-label="Primary">
          {navigation}
          {context}
        </nav>
      )}
      <main ref={mainRef} className={CHROME_SCROLL_CLASS}>{children}</main>
      {footer && <div className="ds-chrome__footer">{footer}</div>}
    </div>
  );
}

// Playback surfaces supply their own main landmark and scrolling content. The
// session engine and overlays keep their identities while that content changes.
export function PlaybackFrame({ className, header, controls, navigation, overlays, player, children, ...rootProps }) {
  return (
    <div {...rootProps} className={`ds-playback-frame ${className || ''}`.trim()}>
      {header}
      {children}
      {controls}
      {navigation}
      {overlays}
      {player}
    </div>
  );
}
