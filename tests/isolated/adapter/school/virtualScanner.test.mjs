import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualScannerAdapter } from '#adapters/hardware/scanner/VirtualScannerAdapter.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** Tiny fake of the WebSocketEventBus surface the relay uses. */
const makeBus = () => {
  const broadcasts = [];
  return {
    broadcasts,
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    on: (topic) => broadcasts.filter((b) => b.topic === topic).map((b) => b.payload),
  };
};

let bus, scanner;

beforeEach(() => {
  bus = makeBus();
  scanner = new VirtualScannerAdapter({ eventBus: bus, logger: silent });
});

describe('construction', () => {
  it('requires an event bus with broadcast', () => {
    expect(() => new VirtualScannerAdapter({})).toThrow(/eventBus/);
    expect(() => new VirtualScannerAdapter({ eventBus: {} })).toThrow(/broadcast/);
  });
});

describe('scan — emits the relay\'s normalized event', () => {
  it('broadcasts on the barcode-relay topic', () => {
    scanner.scan('sch:abc123');
    expect(bus.broadcasts).toHaveLength(1);
    expect(bus.broadcasts[0].topic).toBe('barcode-relay');
  });

  it('emits exactly the field set the real relay broadcasts', () => {
    const payload = scanner.scan('sch:abc123');
    expect(Object.keys(payload).sort()).toEqual(['code', 'device', 'route', 'source', 'ts']);
    expect(payload.source).toBe('barcode-relay');
    expect(payload.code).toBe('sch:abc123');
    expect(payload.route).toBe('content');
    expect(payload.device).toBe('virtual-scanner');
    expect(payload.ts).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('returns the same object it put on the bus', () => {
    const payload = scanner.scan('sch:abc123');
    expect(bus.broadcasts[0].payload).toEqual(payload);
  });

  it('honours a per-scan device and route override', () => {
    const payload = scanner.scan('012345678905', { device: 'kitchen-scanner', route: 'nutribot' });
    expect(payload).toMatchObject({ device: 'kitchen-scanner', route: 'nutribot' });
  });

  it('falls back to the default route for an unrecognized route, like the relay does', () => {
    expect(scanner.scan('x', { route: 'wormhole' }).route).toBe('content');
  });

  it('trims the code the way the relay trims it', () => {
    expect(scanner.scan('  sch:abc  ').code).toBe('sch:abc');
  });

  it('drops an empty code without broadcasting, like the relay does', () => {
    expect(scanner.scan('   ')).toBe(null);
    expect(scanner.scan('')).toBe(null);
    expect(bus.broadcasts).toEqual([]);
  });

  it('passes garbage through untouched — an unknown code is a real scan', () => {
    const payload = scanner.scan('~~NOT-A-TOKEN~~');
    expect(payload.code).toBe('~~NOT-A-TOKEN~~');
    expect(bus.broadcasts).toHaveLength(1);
  });
});

describe('onScan dispatch', () => {
  it('hands the payload to the injected onScan router', () => {
    const seen = [];
    const s = new VirtualScannerAdapter({ eventBus: bus, onScan: (p) => seen.push(p), logger: silent });
    s.scan('sch:abc123');
    expect(seen).toHaveLength(1);
    expect(seen[0].code).toBe('sch:abc123');
  });

  it('an onScan failure never breaks the broadcast, like the relay', () => {
    const s = new VirtualScannerAdapter({
      eventBus: bus,
      onScan: () => { throw new Error('router blew up'); },
      logger: silent,
    });
    expect(() => s.scan('sch:abc123')).not.toThrow();
    expect(bus.broadcasts).toHaveLength(1);
  });
});

describe('scanTwice — replay for idempotency tests', () => {
  it('emits the same code twice as two separate events', () => {
    const [first, second] = scanner.scanTwice('sch:abc123');
    expect(bus.broadcasts).toHaveLength(2);
    expect(first.code).toBe('sch:abc123');
    expect(second.code).toBe('sch:abc123');
  });

  it('returns an empty replay for an empty code', () => {
    expect(scanner.scanTwice('  ')).toEqual([]);
    expect(bus.broadcasts).toEqual([]);
  });
});

describe('personal cards', () => {
  it('registers a learner card and scans it by learner id', () => {
    scanner.registerCard('kid1', 'sch:card:kid1');
    const payload = scanner.scanCard('kid1');
    expect(payload.code).toBe('sch:card:kid1');
    expect(bus.broadcasts).toHaveLength(1);
  });

  it('re-registering a learner replaces the token', () => {
    scanner.registerCard('kid1', 'sch:card:old');
    scanner.registerCard('kid1', 'sch:card:new');
    expect(scanner.scanCard('kid1').code).toBe('sch:card:new');
  });

  it('lists registered cards', () => {
    scanner.registerCard('kid1', 'a');
    scanner.registerCard('kid2', 'b');
    expect(scanner.listCards()).toEqual({ kid1: 'a', kid2: 'b' });
  });

  it('throws for an unregistered learner', () => {
    expect(() => scanner.scanCard('ghost')).toThrow(/ghost/);
  });

  it('rejects a blank learner id or token at registration', () => {
    expect(() => scanner.registerCard('', 'x')).toThrow();
    expect(() => scanner.registerCard('kid1', '  ')).toThrow();
  });

  it('supports a per-scan device override on a card scan', () => {
    scanner.registerCard('kid1', 'sch:card:kid1');
    expect(scanner.scanCard('kid1', { device: 'console-scanner' }).device).toBe('console-scanner');
  });
});

describe('scan history', () => {
  it('records every emitted scan in order', () => {
    scanner.scan('one');
    scanner.scan('two');
    expect(scanner.listScans().map((s) => s.code)).toEqual(['one', 'two']);
    expect(scanner.lastScan().code).toBe('two');
  });

  it('does not record a dropped empty scan', () => {
    scanner.scan(' ');
    expect(scanner.listScans()).toEqual([]);
    expect(scanner.lastScan()).toBe(null);
  });
});
