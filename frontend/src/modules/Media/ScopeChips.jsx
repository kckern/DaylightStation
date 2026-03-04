// frontend/src/modules/Media/ScopeChips.jsx
import React, { useMemo } from 'react';

/**
 * Shows scope suggestion chips above results based on source distribution.
 * Only shown when current scope is broad (has children or is "all").
 *
 * @param {{
 *   results: Array<{source: string, mediaType?: string}>,
 *   scopes: Array<{key, label, params, children?}>,
 *   activeKey: string,
 *   onSelect: (scope) => void,
 * }} props
 */
const ScopeChips = ({ results, scopes, activeKey, onSelect }) => {
  const chips = useMemo(() => {
    if (!results.length) return [];

    // Build flat list of leaf scopes with their source/mediaType from params
    const leafScopes = [];
    for (const scope of scopes) {
      if (scope.children) {
        for (const child of scope.children) {
          leafScopes.push(child);
        }
      }
    }

    // Count results matching each leaf scope's source param
    const counts = [];
    for (const scope of leafScopes) {
      if (scope.key === activeKey) continue; // skip current scope
      const params = new URLSearchParams(scope.params);
      const scopeSource = params.get('source');
      const scopeMediaType = params.get('mediaType');

      const matchCount = results.filter(r => {
        if (scopeSource && r.source !== scopeSource) return false;
        if (scopeMediaType && r.mediaType && r.mediaType !== scopeMediaType) return false;
        return true;
      }).length;

      if (matchCount > 0) {
        counts.push({ scope, count: matchCount });
      }
    }

    return counts.sort((a, b) => b.count - a.count);
  }, [results, scopes, activeKey]);

  // Only show when scope is broad enough to have suggestions
  const activeScope = scopes.find(s => s.key === activeKey)
    || scopes.find(s => s.children?.some(c => c.key === activeKey));
  const isNarrow = activeScope && !activeScope.children && activeScope.key !== 'all';
  if (isNarrow || chips.length === 0) return null;

  return (
    <div className="scope-chips">
      {chips.map(({ scope, count }) => (
        <button
          key={scope.key}
          className="scope-chip"
          onClick={() => onSelect(scope)}
        >
          {scope.label}
          <span className="scope-chip-count">({count})</span>
        </button>
      ))}
    </div>
  );
};

export default ScopeChips;
