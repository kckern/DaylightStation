/**
 * The Portal presence gate (design: 2026-07-22-portal-presence-gate-design).
 * Pure: no I/O, no clock — `now` is injected.
 *
 * A physical parental control. The panel is usable while specific Bluetooth
 * devices are connected; the parent takes the headset away and School closes.
 *
 * The headset gate is not arbitrary. Every rung's prompt is audio, so no
 * headset means the drill genuinely cannot run — "disabled" describes reality
 * rather than imposing a punishment, which is a better thing to say to a child.
 * The keyboard gate IS arbitrary by comparison, so it gets the lighter
 * severity: the typing rungs leave the ladder and sentences graduate across the
 * gap, which is the capability path already built and tested.
 */

export const GATE_LEVELS = ['open', 'hindered', 'disabled'];

/** Absent → what. A role with no entry here cannot gate anything. */
export const ROLE_SEVERITY = {
  headset: 'disabled',
  keyboard: 'hindered',
};

const SEVERITY_RANK = { open: 0, hindered: 1, disabled: 2 };

/** Default staleness window. One missed heartbeat is noise; five is a signal. */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the gate from the last presence report.
 *
 * The failure direction is the whole design. "Cannot confirm" resolves to
 * `hindered` — never to `open`, so killing the APK cannot unlock anything, and
 * never to `disabled`, so a crash or a WiFi blip cannot leave a child staring
 * at a dead panel they have no way to fix. A glitch costs the lesson, not the
 * panel.
 *
 * @param {object}  args
 * @param {object|null} args.presence  last report: {at, devices:[{mac,role,connected}]}
 * @param {number}  args.now           epoch ms
 * @param {Array}   [args.required]    [{mac, role}] from config; [] disables the gate
 * @param {number}  [args.ttlMs]
 * @returns {{level: string, reason: string, missing: string[], stale: boolean}}
 */
export function resolveGate({ presence, now, required = [], ttlMs = DEFAULT_TTL_MS }) {
  // No configured requirements means the household has not opted in. An
  // unconfigured gate must not lock anyone out of anything.
  if (!Array.isArray(required) || required.length === 0) {
    return { level: 'open', reason: 'no-gate-configured', missing: [], stale: false };
  }

  const at = presence?.at ? Date.parse(presence.at) : NaN;
  const stale = !Number.isFinite(at) || (now - at) > ttlMs;
  if (stale) {
    return {
      level: 'hindered',
      reason: presence ? 'presence-stale' : 'presence-unknown',
      missing: [],
      stale: true,
    };
  }

  const connected = new Set(
    (presence.devices || [])
      .filter((d) => d?.connected === true && d.mac)
      .map((d) => String(d.mac).toUpperCase()),
  );

  const missing = [];
  let level = 'open';
  for (const req of required) {
    if (!req?.mac || connected.has(String(req.mac).toUpperCase())) continue;
    const severity = ROLE_SEVERITY[req.role];
    // An unrecognised role cannot gate. Failing closed on a config typo would
    // brick the panel for a spelling mistake.
    if (!severity) continue;
    missing.push(req.role);
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[level]) level = severity;
  }

  return {
    level,
    reason: level === 'open' ? 'all-present' : `missing:${missing.join(',')}`,
    missing,
    stale: false,
  };
}

/**
 * What to tell the learner, naming the remedy.
 *
 * A gate that does not say how to open it is the trap this project keeps
 * refusing to build — the same rule a blocked rung holds to.
 */
export function gateMessage(gate) {
  if (gate.level === 'open') return null;
  if (gate.stale) return 'Waiting for the panel to check in…';
  if (gate.missing.includes('headset')) return 'Connect the headset to continue';
  if (gate.missing.includes('keyboard')) return 'Connect the keyboard for writing practice';
  return 'Reconnect your device to continue';
}

/**
 * Capabilities the gate permits, intersected with what the device claims.
 *
 * Without a keyboard present there is no text input, whatever the client says
 * it can do — which is exactly the existing ladder filter, now driven by a real
 * signal instead of a stored declaration.
 */
export function capabilitiesUnder(gate, claimed = {}) {
  if (gate.level === 'disabled') return { microphone: false, textInput: [] };
  if (gate.level === 'open') return claimed;
  return { microphone: claimed.microphone === true, textInput: [] };
}

/** Tracked work requires an open gate; browsing and listening do not. */
export function allowsTrackedWork(gate) {
  return gate.level === 'open';
}
