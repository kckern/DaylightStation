import React, { useState, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import './EntropyPanel.scss';

const EntropyPanel = () => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchEntropy = async () => {
    try {
      const data = await DaylightAPI('/api/v1/home/entropy');
      setReport(data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch entropy report:', error.message, error.stack);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntropy();
    // Refresh every 5 minutes
    const interval = setInterval(fetchEntropy, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="entropy-panel">
        <div className="entropy-grid" style={{ gridTemplateColumns: `repeat(4, 1fr)` }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="entropy-item skeleton">
              <div className="item-icon" />
              <div className="item-value" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="entropy-panel">
        <div style={{ textAlign: 'center', color: '#ff6b6b', fontSize: '0.8rem' }}>Failed to load</div>
      </div>
    );
  }

  if (!report.items || report.items.length === 0) {
    return (
      <div className="entropy-panel">
        <div style={{ textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
          No trackers configured.<br/>
          <span style={{ fontSize: '0.7rem' }}>Check config/apps/entropy.yml</span>
        </div>
      </div>
    );
  }

  // Sort items by weight (descending), then by id as fallback
  const sortedItems = [...report.items].sort((a, b) => {
    const weightA = a.weight ?? 0;
    const weightB = b.weight ?? 0;
    if (weightB !== weightA) return weightB - weightA;
    return (a.id || '').localeCompare(b.id || '');
  });

  // Calculate grid dimensions to be as square as possible
  const numItems = sortedItems.length;
  const cols = Math.ceil(Math.sqrt(numItems));

  return (
    <div className="entropy-panel">
      <div className="entropy-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {sortedItems.map(item => {
          const isSvg = item.icon && item.icon.endsWith('.svg');
          const content = (
            <>
              <div className="item-icon">
                {isSvg ? (
                  <img
                    src={`/api/v1/static/entropy/${item.icon}`}
                    alt={item.name}
                    style={{ width: '1.2em', height: '1.2em', display: 'block' }}
                  />
                ) : (
                  item.icon
                )}
              </div>
              <div className="item-value">{item.value === 0 ? '☀' : item.value}</div>
            </>
          );


          if (item.url) {
            return (
              <a 
                key={item.id} 
                href={item.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className={`entropy-item status-${item.status}`} 
                title={item.label}
              >
                {content}
              </a>
            );
          }

          return (
            <div key={item.id} className={`entropy-item status-${item.status}`} title={item.label}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EntropyPanel;
