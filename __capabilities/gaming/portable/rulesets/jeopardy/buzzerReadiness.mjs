// Session-authoritative hardware setup. Saved assignments never imply a live test.
export const BUZZER_LEASE_MS = 15000;
export const requiresBuzzers = (state) => state.set.rounds.some(round => round.mode !== 'turns');
export function buzzersReady(state, now = Date.now()) {
  if (!requiresBuzzers(state)) return true;
  const setup = state.buzzerSetup;
  return !!setup && now - setup.seenAt < BUZZER_LEASE_MS && now >= setup.seenAt && state.teamIds.length > 0 && state.teamIds.every(id => {
    const entry = setup.teams[id];
    return entry?.slot && entry.connected && entry.tested;
  });
}
export function reduceBuzzerSetup(state, action, now) {
  const previous = state.buzzerSetup;
  const fail = () => ({ error: { code: 'invalid_buzzer_report', message: 'Buzzer setup changed; retry with the current TV setup' } });
  if (action.type === 'BUZZER_SETUP') {
    if (typeof action.epoch !== 'string' || !action.epoch) return fail();
    return { state: { ...state, buzzerSetup: { epoch: action.epoch, seenAt: now, teams: Object.fromEntries(state.teamIds.map(id => [id, { generation: (previous?.teams[id]?.generation ?? -1) + 1, slot: previous?.teams[id]?.slot || null, connected: false, tested: false }])) } } };
  }
  if (!previous) return fail();
  if (action.type === 'BUZZER_REASSIGN') {
    const entry = previous.teams[action.teamId];
    if (!entry) return fail();
    return { state: { ...state, buzzerSetup: { ...previous, teams: { ...previous.teams, [action.teamId]: { generation: entry.generation + 1, slot: null, connected: false, tested: false } } } } };
  }
  if (action.epoch !== previous.epoch) return fail();
  if (action.type === 'BUZZER_PRESENCE') return { state: { ...state, buzzerSetup: { ...previous, seenAt: now } } };
  const entry = previous.teams[action.teamId];
  if (!entry || entry.generation !== action.generation || typeof action.slot !== 'string' || !action.slot.startsWith('gamepad:')) return fail();
  let next;
  if (action.kind === 'assign') {
    if (Object.entries(previous.teams).some(([id, value]) => id !== action.teamId && value.slot === action.slot)) return fail();
    if (entry.slot && entry.slot !== action.slot) return fail();
    next = { ...entry, slot: action.slot, connected: true, tested: false };
  } else {
    if (entry.slot !== action.slot) return fail();
    if (action.kind === 'test') next = { ...entry, connected: true, tested: true };
    else if (action.kind === 'disconnect') next = { ...entry, connected: false, tested: false, generation: entry.generation + 1 };
    else return fail();
  }
  return { state: { ...state, buzzerSetup: { ...previous, seenAt: now, teams: { ...previous.teams, [action.teamId]: next } } } };
}
