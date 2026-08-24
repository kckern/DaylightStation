import { useState } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import getLogger from '../../../../../lib/logging/Logger.js';

const log = getLogger().child({ app: 'feed', module: 'detail-actions' });

const STYLES = {
  primary: { background: '#228be6', color: '#fff' },
  danger: { background: '#ff6b6b', color: '#fff' },
  default: { background: '#25262b', color: '#c1c2c5' },
};

export default function ActionsSection({ data }) {
  const [error, setError] = useState('');
  if (!data?.items?.length) return null;

  const handleAction = async (action) => {
    try {
      setError('');
      await DaylightAPI(action.endpoint, action.body || {}, action.method || 'POST');
    } catch (err) {
      log.error('feed.detail.action_failed', { actionId: action.id, error: err.message });
      setError(`Could not ${action.label.toLowerCase()}. Try again.`);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
      {error && <div role="alert" style={{ flexBasis: '100%', color: '#ff8787', fontSize: '0.8rem' }}>{error}</div>}
      {data.items.map(action => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          style={{
            ...(STYLES[action.style] || STYLES.default),
            border: 'none',
            borderRadius: '8px',
            padding: '0.5rem 1rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
