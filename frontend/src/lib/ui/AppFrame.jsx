import { createContext, useContext, useRef } from 'react';
import { useMergedRef } from '@mantine/hooks';
import './ds.scss';

const AppMainContext = createContext(null);
const ViewOverlaysContext = createContext(true);

/** Get the nearest AppFrame's ref. Read its current element in an event or effect. */
export function useAppMainRef() {
  return useContext(AppMainContext);
}

export function useViewOverlaysActive() {
  return useContext(ViewOverlaysContext);
}

// Keep a view mounted while its route is inactive so drafts can be resumed.
export function AppView({ active, suspendOverlays = false, children }) {
  const parentOverlaysActive = useViewOverlaysActive();
  const overlaysActive = parentOverlaysActive && active && !suspendOverlays;
  return (
    <ViewOverlaysContext.Provider value={overlaysActive}>
      <div hidden={!active}>{children}</div>
    </ViewOverlaysContext.Provider>
  );
}

export function AppFrame({ className = '', header, navigation, context, notices, footer, mainRef, expandedContext = false, onKeyDown, children }) {
  const scrollRef = useRef(null);
  const setMainRef = useMergedRef(scrollRef, mainRef);
  return (
    <div className={['ds-chrome', expandedContext && 'ds-chrome--context', className].filter(Boolean).join(' ')} onKeyDown={onKeyDown}>
      {header && <header className="ds-chrome__header">{header}</header>}
      {(navigation || context) && (
        <nav className="ds-chrome__nav" aria-label="Primary">
          {navigation}
          {context}
        </nav>
      )}
      {notices && <div className="ds-chrome__notices">{notices}</div>}
      <main ref={setMainRef} className="ds-chrome__main">
        <AppMainContext.Provider value={scrollRef}>{children}</AppMainContext.Provider>
      </main>
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
