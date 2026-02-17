import { DaylightAPI } from '../../../../../lib/api.mjs';

const STYLES = {
  primary: { background: '#228be6', color: '#fff' },
  danger: { background: '#ff6b6b', color: '#fff' },
  default: { background: '#25262b', color: '#c1c2c5' },
};

export default function ActionsSection({ data }) {
  if (!data?.items?.length) return null;

  const handleAction = async (action) => {
    try {
      await DaylightAPI(action.endpoint, action.body || {}, action.method || 'POST');
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
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
