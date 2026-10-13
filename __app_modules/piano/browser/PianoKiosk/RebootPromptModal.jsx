/**
 * RebootPromptModal — shown only when rendering has been durably degraded (the
 * SM-T590 GPU/renderer latch). Replaces the watchdog's old silent reboot: the
 * user decides. "Reboot now" clears the latch (~90s); "Not now" defers for an
 * hour, then the prompt re-arms. Rarely seen, so it is self-styled (no new SCSS
 * dependency) and deliberately calm — not an error, just an offer to fix.
 */
export default function RebootPromptModal({ open, onReboot, onDismiss }) {
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
          A quick reboot (about a minute and a half) will make it smooth again.
          Your progress is saved.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onReboot}
            style={{
              padding: '0.75rem 1.5rem', borderRadius: '0.6rem', border: 'none',
              background: '#4f7cff', color: '#fff', font: '600 1rem system-ui, sans-serif',
              cursor: 'pointer', minWidth: '9rem',
            }}
          >
            Reboot now
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
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
