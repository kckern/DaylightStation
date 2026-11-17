/** User-requested restart, visible failure/retry, and independently checked recovery.
 * Neither command acknowledgement nor this prompt claims physical containment.
 */
export default function RebootPromptModal({ open, onReboot, onDismiss, onCheckRecovery, recovery = { status: 'idle' } }) {
  if (!open) return null;
  return (
    <div
      className="piano-reboot-prompt"
      role="dialog"
      aria-modal="true"
      aria-label="Display is running slowly"
      data-testid="reboot-prompt"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="piano-reboot-prompt__card"
        style={{
          maxWidth: '30rem', margin: '1.5rem', padding: '1.75rem 2rem',
          borderRadius: '1rem', background: '#1c1e26', color: '#f2f3f7',
          border: '1px solid #33364a', boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
          textAlign: 'center', font: '400 1.05rem/1.5 system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }} aria-hidden="true">🐢</div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.35rem', fontWeight: 600 }}>
          The display is running slowly
        </h2>
        <p style={{ margin: '0 0 1.5rem', color: '#b9bcce' }}>
          {recovery.status === 'failed' ? 'Could not restart. Restart is unavailable, was rejected, or is blocked by current safety settings. You can retry.'
            : recovery.status === 'expired' ? 'Could not verify the earlier restart because its recovery evidence expired or was invalid. This does not prove the restart failed. You can request a fresh restart.'
            : recovery.status === 'requested' || recovery.status === 'unverified' ? 'Restart requested. Recovery has not been verified. Check again after the device restarts.'
              : recovery.status === 'verified' ? 'A new device boot and fresh healthy page heartbeat were observed.'
                : recovery.status === 'checking' ? 'Checking current safety settings before requesting restart…'
                  : 'A restart may help the display recover. It usually takes about a minute and a half.'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={['requested', 'unverified'].includes(recovery.status) ? onCheckRecovery : onReboot}
            disabled={recovery.status === 'checking'}
            style={{
              padding: '0.75rem 1.5rem', borderRadius: '0.6rem', border: 'none',
              background: '#4f7cff', color: '#fff', font: '600 1rem system-ui, sans-serif',
              cursor: 'pointer', minWidth: '9rem',
            }}
          >
            {['requested', 'unverified'].includes(recovery.status) ? 'Check recovery' : ['failed', 'expired'].includes(recovery.status) ? 'Retry reboot' : 'Reboot now'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '0.75rem 1.5rem', borderRadius: '0.6rem',
              border: '1px solid #44475c', background: 'transparent', color: '#d7d9e6',
              font: '500 1rem system-ui, sans-serif', cursor: 'pointer', minWidth: '9rem',
            }}
          >
            {recovery.status === 'verified' ? 'Close' : 'Not now'}
          </button>
        </div>
      </div>
    </div>
  );
}
