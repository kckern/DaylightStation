// SearchSkeletonRows.jsx — the result list's shape while a search is still
// on its way (Media addendum item 4, 2026-11-26): a few rows of thumbnail +
// two lines, with the words "Searching…" for screen readers only. Shared by
// the desktop dropdown (ContentCombobox) and the phone search sheet (Media
// SearchMode), so both wait the same way and neither says "No results" for
// words nobody has searched yet.
import React from 'react';
import Skeleton from '../../../../frontend/src/lib/ui/Skeleton.jsx';
import './SearchSkeletonRows.scss';

const WIDTHS = ['62%', '48%', '70%', '54%'];

export function SearchSkeletonRows({ rows = 4, testId = 'search-skeleton', as: Tag = 'div' }) {
  return (
    <Tag className="search-skeleton" data-testid={testId} aria-busy="true">
      <span className="search-skeleton__sr" role="status">Searching…</span>
      {WIDTHS.slice(0, rows).map((width, i) => (
        <div key={i} className="search-skeleton__row" data-testid={`${testId}-row`} aria-hidden="true">
          <Skeleton width={40} height={40} radius="sm" />
          <div className="search-skeleton__lines">
            <Skeleton height={12} width={width} radius="sm" />
            <Skeleton height={10} width="32%" radius="sm" />
          </div>
        </div>
      ))}
    </Tag>
  );
}

export default SearchSkeletonRows;
