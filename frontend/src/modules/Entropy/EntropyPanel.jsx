import React, { useState, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import './EntropyPanel.scss';

const EntropyPanel = () => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchEntropy = async () => {
    try {
      const data = await DaylightAPI('/home/entropy');
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
        <div style={{ textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>Loading...</div>
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

  const getStatusIcon = (status, value) => {
    if (status === 'green' && value === 0) return '☀️'; // Sunshine for perfect score
    if (status === 'green') return '✓';
    if (status === 'yellow') return '⚠️';
    return '❗';
  };

  return (
    <div className="entropy-panel">
      <div className="entropy-grid">
        {report.items.map(item => (
          <div key={item.id} className={`entropy-item status-${item.status}`}>
            <div className="item-icon">{item.icon}</div>
            <div className="item-details">
              <span className="item-name">{item.name}</span>
              <span className="item-label">{item.label}</span>
            </div>
            <div className="status-indicator">
              {getStatusIcon(item.status, item.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EntropyPanel;
