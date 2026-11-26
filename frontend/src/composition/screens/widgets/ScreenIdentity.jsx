import React, { useMemo } from 'react';
import { screenName } from '../../../../../__capabilities/screen-host/browser/lifecycle.mjs';

/**
 * The ad-hoc screen's resting face: what this browser is called as a screen, and how a
 * phone finds it. Calm on purpose: it sits behind whatever the screen opens (Charades).
 */
export default function ScreenIdentity() {
  const name = useMemo(() => screenName(
    typeof window !== 'undefined' ? window.location.search : '',
    typeof window !== 'undefined' ? window.localStorage : null,
  ), []);
  return (
    <div className="screen-identity" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      height: '100%', textAlign: 'center', gap: '0.75rem', opacity: 0.85,
    }}>
      <div style={{ fontSize: '1.1rem', letterSpacing: '0.04em', opacity: 0.7 }}>This browser is a screen</div>
      <div style={{ fontSize: '2.4rem', fontWeight: 700 }}>{name}</div>
      <div style={{ fontSize: '1rem', opacity: 0.6 }}>On the phone: Connect, then {name}, for a remote</div>
    </div>
  );
}
