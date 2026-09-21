import React, { useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DismissContext, DismissStackProvider } from './DismissStackProvider.jsx';

function Layer({ onDismiss, isActive }) {
  const register = useContext(DismissContext);
  useEffect(() => register('browser-menu', onDismiss, false, isActive), [isActive, onDismiss, register]);
  return null;
}

function EscapeFixture() {
  const [active, setActive] = useState(true);
  const [dismissals, setDismissals] = useState(0);
  const [targetHandled, setTargetHandled] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [events, setEvents] = useState([]);

  return <DismissStackProvider>
    <Layer
      isActive={() => active}
      onDismiss={() => {
        setDismissals(count => count + 1);
        setEvents(current => [...current, 'dismiss']);
      }}
    />
    <button
      id="escape-target"
      type="button"
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        setTrusted(event.nativeEvent.isTrusted);
        event.preventDefault();
        setTargetHandled(true);
        setActive(false);
        setEvents(current => [...current, 'target']);
      }}
    >Open menu</button>
    <output id="target-handled">{String(targetHandled)}</output>
    <output id="trusted-event">{String(trusted)}</output>
    <output id="dismissals">{dismissals}</output>
    <output id="event-order">{events.join(',')}</output>
  </DismissStackProvider>;
}

createRoot(document.getElementById('root')).render(<EscapeFixture />);
