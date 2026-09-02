//
// The webapp shell: slim header, main scroll region, primary nav rendered
// as a bottom tab bar on mobile and a left rail on tablet-up (same DOM,
// CSS-switched). Nav pattern adopted from Media's PrimaryNav.
import './ds.scss';

export function AppChrome({ title, tabs = [], activeTab, onTabChange, headerActions, footer, children }) {
  const actions = Array.isArray(headerActions) ? headerActions : (headerActions ? [headerActions] : []);
  if (actions.length > 3) {
    throw new Error('AppChrome allows at most 3 header actions — quiet chrome is the contract');
  }
  return (
    <div className="ds-chrome">
      <header className="ds-chrome__header">
        <h1 className="ds-chrome__title">{title}</h1>
        {actions.length ? <div className="ds-chrome__actions">{actions}</div> : null}
      </header>
      <nav className="ds-chrome__nav" aria-label="Primary">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            role="link"
            tabIndex={0}
            className={`ds-chrome__tab${tab.id === activeTab ? ' ds-chrome__tab--active' : ''}`}
            aria-current={tab.id === activeTab ? 'page' : undefined}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTabChange(tab.id); }}
          >
            <span className="ds-chrome__tab-icon">{tab.icon}</span>
            <span className="ds-chrome__tab-label">{tab.label}</span>
          </a>
        ))}
      </nav>
      <main className="ds-chrome__main">{children}</main>
      {footer ? <div className="ds-chrome__footer">{footer}</div> : null}
    </div>
  );
}

export default AppChrome;
