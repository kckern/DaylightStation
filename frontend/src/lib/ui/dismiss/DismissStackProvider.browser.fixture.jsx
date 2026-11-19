import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DismissStackProvider } from './DismissStackProvider.jsx';
import { useDismissLayer } from './useDismissLayer.js';

function Layer({ onDismiss, isActive }) {
  useDismissLayer(true, onDismiss, { isActive });
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
