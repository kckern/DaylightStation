//
// The webapp shell: slim header, main scroll region, primary nav rendered
// as a bottom tab bar on mobile and a left rail on tablet-up (same DOM,
// CSS-switched). Nav pattern adopted from Media's PrimaryNav.
import { Link } from 'react-router-dom';
import { AppFrame } from './AppFrame.jsx';
export function AppChrome({ title, tabs = [], activeTab, onTabChange, headerActions, notices, footer, mainRef, sidebarRef, sidebarActive = false, children }) {
  const actions = Array.isArray(headerActions) ? headerActions : (headerActions ? [headerActions] : []);
  if (actions.length > 3) {
    throw new Error('AppChrome allows at most 3 header actions — quiet chrome is the contract');
  }
  return (
    <AppFrame
      mainRef={mainRef}
      expandedContext={sidebarActive}
      header={<>
        <h1 className="ds-chrome__title">{title}</h1>
        {actions.length ? <div className="ds-chrome__actions">{actions}</div> : null}
      </>}
      navigation={tabs.length > 0 && tabs.map(tab => {
        const active = tab.id === activeTab;
        const props = {
          className: `ds-chrome__tab${active ? ' ds-chrome__tab--active' : ''}`,
          'aria-current': active ? 'page' : undefined,
        };
        const label = <>
          <span className="ds-chrome__tab-icon">{tab.icon}</span>
          <span className="ds-chrome__tab-label">{tab.label}</span>
        </>;
        return tab.href
          ? <Link key={tab.id} to={tab.href} state={tab.state} {...props}>{label}</Link>
          : <button key={tab.id} type="button" {...props} onClick={() => onTabChange(tab.id)}>{label}</button>;
      })}
      context={sidebarRef && <div ref={sidebarRef} className="ds-chrome__context" hidden={!sidebarActive} />}
      notices={notices}
      footer={footer}
    >
      {children}
    </AppFrame>
  );
}

export default AppChrome;
