// frontend/src/modules/Media/ScopeDropdown.jsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Two-level scope dropdown for search filtering.
 *
 * @param {{
 *   scopes: Array<{label, key, params, icon?, children?: Array<{label, key, params}>}>,
 *   activeKey: string,
 *   onSelect: (scope: {label, key, params}) => void,
 *   recents: string[],
 *   favorites: string[],
 *   onToggleFavorite: (key: string) => void,
 * }} props
 */
const ScopeDropdown = ({ scopes, activeKey, onSelect, recents, favorites, onToggleFavorite }) => {
  const logger = useMemo(() => getLogger().child({ component: 'ScopeDropdown' }), []);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Build flat lookup of all scopes (parents + children)
  const allScopes = useMemo(() => {
    const map = new Map();
    for (const scope of scopes) {
      map.set(scope.key, scope);
      if (scope.children) {
        for (const child of scope.children) {
          map.set(child.key, child);
        }
      }
    }
    return map;
  }, [scopes]);

  const activeScope = allScopes.get(activeKey) || scopes[0];

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleSelect = useCallback((scope) => {
    logger.info('scope-dropdown.selected', { key: scope.key, label: scope.label });
    onSelect(scope);
    setOpen(false);
  }, [onSelect, logger]);

  const handleToggleFav = useCallback((e, key) => {
    e.stopPropagation();
    onToggleFavorite(key);
  }, [onToggleFavorite]);

  // Resolve recent/favorite keys to scope objects (skip missing)
  const recentScopes = recents
    .filter(k => k !== 'all' && allScopes.has(k))
    .map(k => allScopes.get(k))
    .slice(0, 3);
  const favoriteScopes = favorites
    .filter(k => allScopes.has(k))
    .map(k => allScopes.get(k));

  return (
    <div className="scope-dropdown" ref={dropdownRef}>
      <button
        className="scope-dropdown-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="scope-dropdown-label">{activeScope?.label || 'All'}</span>
        <span className="scope-dropdown-chevron">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div className="scope-dropdown-menu" role="listbox">
          {scopes.map((scope) => (
            <React.Fragment key={scope.key}>
              {scope.children ? (
                <>
                  <div className="scope-dropdown-group-header">{scope.label}</div>
                  {scope.children.map((child) => (
                    <button
                      key={child.key}
                      className={`scope-dropdown-item${child.key === activeKey ? ' active' : ''}`}
                      onClick={() => handleSelect(child)}
                      role="option"
                      aria-selected={child.key === activeKey}
                    >
                      <span className="scope-dropdown-item-label">{child.label}</span>
                      <span
                        className={`scope-dropdown-star${favorites.includes(child.key) ? ' starred' : ''}`}
                        onClick={(e) => handleToggleFav(e, child.key)}
                      >
                        {favorites.includes(child.key) ? '\u2605' : '\u2606'}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <button
                  className={`scope-dropdown-item scope-dropdown-item--top${scope.key === activeKey ? ' active' : ''}`}
                  onClick={() => handleSelect(scope)}
                  role="option"
                  aria-selected={scope.key === activeKey}
                >
                  <span className="scope-dropdown-item-label">{scope.label}</span>
                </button>
              )}
            </React.Fragment>
          ))}

          {recentScopes.length > 0 && (
            <>
              <div className="scope-dropdown-divider" />
              <div className="scope-dropdown-group-header">Recent</div>
              {recentScopes.map((scope) => (
                <button
                  key={`recent-${scope.key}`}
                  className={`scope-dropdown-item${scope.key === activeKey ? ' active' : ''}`}
                  onClick={() => handleSelect(scope)}
                  role="option"
                >
                  <span className="scope-dropdown-item-label">{scope.label}</span>
                </button>
              ))}
            </>
          )}

          {favoriteScopes.length > 0 && (
            <>
              <div className="scope-dropdown-divider" />
              <div className="scope-dropdown-group-header">Favorites</div>
              {favoriteScopes.map((scope) => (
                <button
                  key={`fav-${scope.key}`}
                  className={`scope-dropdown-item${scope.key === activeKey ? ' active' : ''}`}
                  onClick={() => handleSelect(scope)}
                  role="option"
                >
                  <span className="scope-dropdown-item-label">{scope.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ScopeDropdown;
