import React, { useEffect, useState } from 'react';
import { requiresBuzzers, BUZZER_LEASE_MS } from '../../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
export default function BuzzerStatus({ state, teams = [], onReassign, pending, hardware }) {
  const [, tick] = useState(0);
  const now = Date.now();
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, []);
  if (!state || !requiresBuzzers(state)) return null;
  const setup = state.buzzerSetup;
  const staleHardware = hardware?.fresh === false;
  const connected = entry => entry?.connected && (!hardware || (hardware.fresh && hardware.slots.includes(entry.slot)));
  const live = !staleHardware && setup && now >= setup.seenAt && now - setup.seenAt < BUZZER_LEASE_MS;
  const next = teams.find(team => !live || !setup?.teams[team.id]?.tested || !connected(setup?.teams[team.id]));
  const nextAssigned = next && setup?.teams[next.id]?.slot;
  return <section className="jp-buzzer-setup" aria-label="Team buzzers">
    <h2>Team buzzers</h2>
    <p>{staleHardware ? 'Wake the TV, then press each buzzer again.' : !live && setup ? 'TV reconnecting — reconnect and press again.' : next ? nextAssigned && !connected(setup?.teams[next.id]) ? `${next.name} — reconnect and press again` : nextAssigned ? `${next.name} — press again to test` : `${next.name} — press your buzzer` : 'All teams ready. Start the game on your phone.'}</p>
    {teams.map(team => {
      const entry = setup?.teams[team.id];
      const label = !entry?.slot ? 'Press your buzzer' : !live || !connected(entry) ? 'Reconnect and press again' : entry.tested ? 'Ready ✓' : 'Press again to test';
      return <div key={team.id} data-active={next?.id === team.id || undefined} role="status" style={{ color: team.color }}><strong>{team.name}</strong>: {label}{onReassign && <button type="button" disabled={pending} onClick={() => onReassign(team.id)}>Reassign {team.name}</button>}</div>;
    })}
  </section>;
}
