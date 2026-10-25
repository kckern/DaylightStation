import React, { useEffect, useState } from 'react';
import { requiresBuzzers, BUZZER_LEASE_MS } from '../../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
export default function BuzzerStatus({ state, teams = [], onReassign, pending }) {
  const [, tick] = useState(0);
  const now = Date.now();
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, []);
  if (!state || !requiresBuzzers(state)) return null;
  const setup = state.buzzerSetup;
  const live = setup && now >= setup.seenAt && now - setup.seenAt < BUZZER_LEASE_MS;
  const next = teams.find(team => !setup?.teams[team.id]?.tested || !setup?.teams[team.id]?.connected);
  const nextAssigned = next && setup?.teams[next.id]?.slot;
  return <section className="jp-buzzer-setup" aria-label="Team buzzers">
    <h2>Check team buzzers</h2>
    <p>{next ? nextAssigned ? `${next.name} — release and press your assigned buzzer again to test.` : `${next.name} — press your buzzer to assign it, then release and press again to test.` : 'All team buzzers tested. Start the game on your phone.'}</p>
    {teams.map(team => {
      const entry = setup?.teams[team.id];
      const label = !entry?.slot ? 'Not assigned' : !live || !entry.connected ? 'Assigned — disconnected / test needed' : entry.tested ? 'Assigned — Tested ✓' : 'Assigned — press again to test';
      return <div key={team.id} data-active={next?.id === team.id || undefined} role="status" style={{ color: team.color }}><strong>{team.name}</strong>: {label}{onReassign && <button type="button" disabled={pending} onClick={() => onReassign(team.id)}>Reassign {team.name}</button>}</div>;
    })}
  </section>;
}
