import { useState, useCallback } from 'react';
import './FeedAssemblyOverlay.scss';

const TIER_COLORS = {
  wire: '#228be6',
  compass: '#fab005',
  scrapbook: '#748ffc',
  library: '#be4bdb',
};

function TierBar({ tier, data, maxAllocated, activeTiers, activeSources, onToggleTier, onToggleSource }) {
  const pct = maxAllocated > 0 ? (data.selected / maxAllocated) * 100 : 0;
  const color = TIER_COLORS[tier] || '#5c636a';
  const tierActive = activeTiers.has(tier);
  const hasAnyFilter = activeTiers.size > 0 || activeSources.size > 0;
  const tierDimmed = hasAnyFilter && !tierActive;

  return (
    <div className={`assembly-tier${tierDimmed ? ' assembly-tier--dimmed' : ''}`}>
      <div className="assembly-tier-header">
        <span
          className={`assembly-tier-name assembly-tier-name--clickable${tierActive ? ' assembly-tier-name--active' : ''}`}
          style={{ color }}
          onClick={() => onToggleTier(tier)}
        >
          {tier}
        </span>
        <span className="assembly-tier-count">{data.selected}/{data.allocated}</span>
      </div>
      <div className="assembly-tier-bar-bg">
        <div className="assembly-tier-bar" style={{ width: `${pct}%`, background: color }} />
      </div>
      {Object.keys(data.sources).length > 0 && (
        <div className="assembly-sources">
          {Object.entries(data.sources)
            .sort(([, a], [, b]) => b - a)
            .map(([src, count]) => {
              const srcActive = activeSources.has(src);
              const srcDimmed = hasAnyFilter && !srcActive && !tierActive;
              return (
                <span
                  key={src}
                  className={`assembly-source-chip assembly-source-chip--clickable${srcActive ? ' assembly-source-chip--active' : ''}${srcDimmed ? ' assembly-source-chip--dimmed' : ''}`}
                  onClick={() => onToggleSource(src)}
                >
                  {src} <strong>{count}</strong>
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

function BatchBlock({ batch, index, activeTiers, activeSources, onToggleTier, onToggleSource }) {
  const maxAllocated = Math.max(
    ...Object.values(batch.tiers || {}).map(t => t.allocated),
    1
  );
  const totalItems = Object.values(batch.tiers || {}).reduce((s, t) => s + t.selected, 0);

  return (
    <div className="assembly-batch">
      <div className="assembly-batch-header">
        <span>Batch {batch.batchNumber ?? index + 1}</span>
        <span className="assembly-batch-meta">
          {totalItems} items | decay {((batch.wireDecayFactor ?? 1) * 100).toFixed(0)}%
        </span>
      </div>
      {Object.entries(batch.tiers || {}).map(([tier, data]) => (
        <TierBar
          key={tier}
          tier={tier}
          data={data}
          maxAllocated={maxAllocated}
          activeTiers={activeTiers}
          activeSources={activeSources}
          onToggleTier={onToggleTier}
          onToggleSource={onToggleSource}
        />
      ))}
    </div>
  );
}

export default function FeedAssemblyOverlay({ batches, onFilterChange }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTiers, setActiveTiers] = useState(() => new Set());
  const [activeSources, setActiveSources] = useState(() => new Set());

  const emitFilter = useCallback((tiers, sources) => {
    onFilterChange?.({ tiers: [...tiers], sources: [...sources] });
  }, [onFilterChange]);

  const handleToggleTier = useCallback((tier) => {
    setActiveTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      setActiveSources(curSources => { emitFilter(next, curSources); return curSources; });
      return next;
    });
  }, [emitFilter]);

  const handleToggleSource = useCallback((source) => {
    setActiveSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      setActiveTiers(curTiers => { emitFilter(curTiers, next); return curTiers; });
      return next;
    });
  }, [emitFilter]);

  const handleClearAll = useCallback(() => {
    setActiveTiers(new Set());
    setActiveSources(new Set());
    emitFilter(new Set(), new Set());
  }, [emitFilter]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(batches, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [batches]);

  if (!batches || batches.length === 0) return null;

  const hasAnyFilter = activeTiers.size > 0 || activeSources.size > 0;

  return (
    <>
      <button
        className={`assembly-fab${hasAnyFilter ? ' assembly-fab--filtering' : ''}`}
        onClick={() => setOpen(true)}
        title="Feed Assembly Debug"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>

      {open && (
        <div className="assembly-overlay" onClick={() => setOpen(false)}>
          <div className="assembly-modal" onClick={e => e.stopPropagation()}>
            <div className="assembly-modal-header">
              <h3>Feed Assembly</h3>
              <div className="assembly-modal-actions">
                {hasAnyFilter && (
                  <button className="assembly-clear-btn" onClick={handleClearAll}>
                    Clear All
                  </button>
                )}
                <button className="assembly-copy-btn" onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy JSON'}
                </button>
                <button className="assembly-close-btn" onClick={() => setOpen(false)}>
                  &times;
                </button>
              </div>
            </div>
            <div className="assembly-modal-body">
              {batches.map((batch, i) => (
                <BatchBlock
                  key={i}
                  batch={batch}
                  index={i}
                  activeTiers={activeTiers}
                  activeSources={activeSources}
                  onToggleTier={handleToggleTier}
                  onToggleSource={handleToggleSource}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
