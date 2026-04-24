// frontend/src/modules/Fitness/HRSimTrigger.jsx

import React from 'react';

/**
 * HRSimTrigger
 *
 * Small gear button to open HR Simulation Panel.
 * Renders on localhost OR in a Chrome browser (desktop dev/daily-driver).
 * Other browsers (Safari, Firefox) on non-localhost hosts do not see it.
 */
export function HRSimTrigger() {
  if (typeof window === 'undefined') return null;
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  // Chrome / Chromium detection — exclude Edge, Opera, Brave-derivative UAs
  // that include "Chrome" in their UA string.
  const ua = window.navigator?.userAgent || '';
  const isChrome = /Chrome\//.test(ua)
    && !/Edg\//.test(ua)      // Edge
    && !/OPR\//.test(ua)      // Opera
    && !/SamsungBrowser/.test(ua);
  if (!isLocalhost && !isChrome) return null;

  const openPanel = () => {
    window.open('/sim-panel.html', 'sim-panel', 'width=400,height=500');
  };

  return (
    <button
      type="button"
      className="hr-sim-trigger"
      onClick={openPanel}
      title="Open HR Simulation Panel"
      style={{
        position: 'fixed',
        bottom: '10px',
        left: '10px',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(100, 100, 100, 0.7)',
        color: '#ccc',
        cursor: 'pointer',
        fontSize: '16px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      &#9881;
    </button>
  );
}

export default HRSimTrigger;
