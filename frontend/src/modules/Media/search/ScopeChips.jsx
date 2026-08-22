// frontend/src/modules/Media/search/ScopeChips.jsx
// Tappable scope chips replacing the native scope <select> (spec D5). A
// 360px dock rendered the select at 96px/13px, and CSS hid it entirely
// while the search field had focus — the one moment scope mattered. Chips
// are laid out as a horizontally scrollable row instead of squeezing a
// fixed-width control, so a chip never gets shrunk into unreadability the
// way the select did.
//
// Interim state: on today's dock, MediaShell.scss still hides
// .media-scope-chips on mobile while the search field has focus, same as
// the select before it — the dock row genuinely doesn't have room for both
// at once. That collapse goes away when Task 13's full-screen Search Mode
// (spec D1) lands: the mobile dock stops carrying scope at all, and this
// component mounts inside the full-screen surface instead, where width
// isn't contested.
//
// No props — everything comes from useSearchContext(), so this exact
// component mounts unchanged inside the desktop popover header (here, via
// MediaContentSearch) and the full-screen mobile Search Mode surface
// (Task 13).
import React, { useMemo, useState } from 'react';
import { useSearchContext } from './SearchProvider.jsx';
import getLogger from '../../../lib/logging/Logger.js';

export function ScopeChips() {
  const { scopes, currentScopeKey, setScopeKey } = useSearchContext();
  const log = useMemo(() => getLogger().child({ component: 'scope-chips' }), []);

  // The child row auto-opens under whichever parent currently owns the
  // selected scope, so mounting with a child scope already chosen (e.g.
  // after Task 11's scoped-empty fallback keeps the chip selected) shows
  // the row that explains it, instead of an unexplained collapsed parent.
  const [expandedKey, setExpandedKey] = useState(() => {
    const owner = scopes.find(
      (s) => Array.isArray(s.children) && s.children.some((c) => c.key === currentScopeKey)
    );
    return owner?.key ?? null;
  });

  const selectScope = (scope) => {
    setScopeKey(scope.key);
    log.info('search.scope_selected', { scopeKey: scope.key, viaFallback: false });
  };

  const handleTopLevelClick = (scope) => {
    const hasChildren = Array.isArray(scope.children) && scope.children.length > 0;
    if (hasChildren) {
      setExpandedKey((prev) => (prev === scope.key ? null : scope.key));
      // A grouping-only parent (no params of its own — e.g. "Music" over
      // Library/Hymns/Ambient) isn't a searchable scope by itself; tapping
      // it only reveals its children. A parent that DOES carry params (per
      // search-scopes.md, "the whole category searchable in addition to
      // its leaves") is selectable too, same as any leaf.
      if (scope.params == null) return;
    }
    selectScope(scope);
  };

  const expandedScope = scopes.find((s) => s.key === expandedKey) ?? null;
  const childScopes = Array.isArray(expandedScope?.children) ? expandedScope.children : [];

  return (
    <div className="media-scope-chips" data-testid="scope-chips">
      <div className="media-scope-chip-row" role="group" aria-label="Search scope">
        {scopes.map((scope) => (
          <button
            key={scope.key}
            type="button"
            className="media-scope-chip"
            data-testid={`scope-chip-${scope.key}`}
            aria-pressed={scope.key === currentScopeKey}
            onClick={() => handleTopLevelClick(scope)}
          >
            {scope.label}
          </button>
        ))}
      </div>
      {childScopes.length > 0 && (
        <div
          className="media-scope-chip-row media-scope-chip-row--children"
          role="group"
          aria-label={`${expandedScope.label} scopes`}
        >
          {childScopes.map((child) => (
            <button
              key={child.key}
              type="button"
              className="media-scope-chip"
              data-testid={`scope-chip-${child.key}`}
              aria-pressed={child.key === currentScopeKey}
              onClick={() => selectScope(child)}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ScopeChips;
