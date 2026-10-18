// Shared Bluetooth command parsing and JSON transport for the Piano Bridge CLI.
// Device addresses and pairing secrets are inputs, never installation defaults.
export const bluetoothUsage = 'bluetooth [status|list|scan [1000..30000]|stop|pair ADDRESS|unpair ADDRESS|connect ADDRESS audio|midi|disconnect ADDRESS audio|midi|power on|off|confirm ADDRESS yes|no|pin ADDRESS PIN|cancel ADDRESS]';

export function parseBluetoothCommand(args) {
  const [action = 'status', ...values] = args;
  const invalid = () => { throw new Error(`Usage: ${bluetoothUsage}`); };
  const count = (n) => { if (values.length !== n) invalid(); };
  const address = () => {
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(values[0] || '')) invalid();
    return values[0].toUpperCase();
  };
  const post = (path, body) => ({ method: 'POST', path: `/bluetooth/${path}`, body });
  switch (action) {
    case 'status':
    case 'list':
      count(0);
      return { method: 'GET', path: '/bluetooth' };
    case 'scan': {
      if (values.length > 1) invalid();
      const durationMs = values.length ? Number(values[0]) : 12000;
      if (values.length && !/^\d+$/.test(values[0])) invalid();
      if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 30000) invalid();
      return post('scan', { durationMs });
    }
    case 'stop':
      count(0);
      return post('scan/stop', {});
    case 'pair':
    case 'unpair':
      count(1);
      return post(action, { address: address() });
    case 'connect':
    case 'disconnect':
      count(2);
      if (!['audio', 'midi'].includes(values[1])) invalid();
      return post(action, { address: address(), profile: values[1] });
    case 'power':
      count(1);
      if (!['on', 'off'].includes(values[0])) invalid();
      return post('power', { enabled: values[0] === 'on' });
    case 'confirm':
      count(2);
      if (!['yes', 'no'].includes(values[1])) invalid();
      return post('pairing', { address: address(), accept: values[1] === 'yes' });
    case 'pin':
      count(2);
      // Android setPin accepts 1–16 bytes. Reject control characters in CLI input.
      if (!values[1] || Buffer.byteLength(values[1], 'utf8') > 16 || /[\x00-\x1f\x7f]/.test(values[1])) invalid();
      return post('pairing', { address: address(), accept: true, pin: values[1] });
    case 'cancel':
      count(1);
      return post('pairing', { address: address(), accept: false });
    default:
      invalid();
  }
}

function redact(value, secret) {
  if (typeof value === 'string') return secret ? value.split(secret).join('[REDACTED]') : value;
  if (Array.isArray(value)) return value.map((item) => redact(item, secret));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(pin|passkey)$/i.test(key) && (typeof item === 'string' || typeof item === 'number') ? '[REDACTED]' : redact(item, secret)]));
  }
  return value;
}

/** Return a process exit code; POST acceptance never asserts a completed connection. */
export async function runBluetoothCommand(args, {
  base,
  fetchImpl = globalThis.fetch,
  write = (line) => process.stdout.write(line + '\n'),
  writeError = (line) => process.stderr.write(line + '\n'),
}) {
  // Retain a submitted secret even when parsing fails, so no failure path can echo it.
  const secret = args[0] === 'pin' ? args[2] : undefined;
  try {
    const { method, path, body } = parseBluetoothCommand(args);
    const response = await fetchImpl(base + path, {
      method,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Bluetooth request failed (HTTP ${response.status})`);
    let result;
    try { result = await response.json(); } catch { throw new Error('Bluetooth bridge returned invalid JSON'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.ok !== true) {
      throw new Error(typeof result?.error === 'string' ? result.error : 'Bluetooth request failed');
    }
    if (method === 'POST' && result.accepted !== true) {
      throw new Error('Bluetooth action was not accepted');
    }
    if (method === 'GET') {
      const adapter = result.adapter;
      const validAdapter = adapter && typeof adapter === 'object' && !Array.isArray(adapter)
        && ['supported', 'enabled', 'discovering'].every((key) => typeof adapter[key] === 'boolean');
      const validDevices = Array.isArray(result.devices) && result.devices.every((device) =>
        device && typeof device === 'object' && !Array.isArray(device)
        && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(device.address)
        && typeof device.connected === 'boolean'
        && ['none', 'bonding', 'bonded'].includes(device.bond)
        && Array.isArray(device.profiles) && device.profiles.every((profile) => ['audio', 'midi'].includes(profile)));
      if (!validAdapter || !validDevices) throw new Error('Bluetooth bridge returned invalid state');
    }
    write(JSON.stringify(redact(result, secret), null, 2));
    if (result.accepted === true) write('Request accepted; poll `bluetooth status` to observe the result.');
    return 0;
  } catch (error) {
    writeError(redact(error?.message || 'Bluetooth request failed', secret));
    return 1;
  }
}
