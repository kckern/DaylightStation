import React from 'react';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { CHART_MARGIN } from '../../lib/chartConstants.js';

/**
 * First-load placeholder for the session detail pane. Built from the pane's own
 * layout classes — header row (poster · title + stats · 16:9 box), chart row,
 * heart-rate lanes — so the hydrated pane lands on exactly these boxes instead
 * of jumping into place. The chart and lanes keep the real chart margins, so the
 * plot area does not shift either.
 */
const LANES = 3;

export default function SessionDetailSkeleton() {
  return (
    <div className="session-detail session-detail--skeleton" aria-busy="true">
      <div className="session-detail__header">
        <Skeleton className="session-detail__poster" radius="sm" />
        <div className="session-detail__meta">
          <div className="session-detail__hero">
            <Skeleton height={30} width="70%" radius="xs" />
          </div>
          <div className="session-detail__meta-bottom">
            <Skeleton height={14} width="62%" radius="xs" />
            <Skeleton height={10} width="34%" radius="xs" />
          </div>
        </div>
        <Skeleton className="session-detail__thumb" radius="sm" />
      </div>
      <div className="session-detail__chart">
        <Skeleton
          className="session-detail__skeleton-plot"
          radius="xs"
          style={{ top: CHART_MARGIN.top, right: CHART_MARGIN.right, bottom: CHART_MARGIN.bottom, left: CHART_MARGIN.left }}
        />
      </div>
      <div className="session-detail__timeline">
        <div className="session-detail__skeleton-lanes" style={{ left: CHART_MARGIN.left, right: CHART_MARGIN.right }}>
          {Array.from({ length: LANES }, (_, i) => (
            <Skeleton key={i} radius="xs" className="session-detail__skeleton-lane" />
          ))}
        </div>
      </div>
    </div>
  );
}
