import { describe, it, expect } from 'vitest';
import { assessFoodScale } from '../../../cli/esp.cli.mjs';

/** A relay with everything healthy; override per test. */
const status = (over = {}) => ({
  wifi: { connected: true, rssi: -58 },
  websocket: { connected: true, drops: 0 },
  barcode: { connected: true, listening: true, bonds: 1, open_count: 3, close_count: 2 },
  scale: { connected: true, scan_enabled: true, scan_active: false },
  ...over,
});

describe('assessFoodScale — barcode chain', () => {
  it('lands when the scanner is linked and transport is up', () => {
    expect(assessFoodScale(status()).barcode.land).toBe(true);
  });

  it('does not land when the scanner link is down', () => {
    const a = assessFoodScale(status({ barcode: { connected: false, listening: true, open_count: 3 } }));
    expect(a.barcode.land).toBe(false);
    expect(a.barcode.why).toMatch(/dropped/i);
  });

  it('distinguishes never-opened from dropped, because the remedy differs', () => {
    const never = assessFoodScale(status({ barcode: { connected: false, listening: true, open_count: 0 } }));
    const dropped = assessFoodScale(status({ barcode: { connected: false, listening: true, open_count: 4 } }));

    expect(never.barcode.why).toMatch(/not completed a connection/i);
    expect(dropped.barcode.why).toMatch(/dropped/i);
    expect(dropped.barcode.fix).toMatch(/wake the scanner/i);
  });

  it('reads ACL connects with no SPP open as "in range, failing to pair"', () => {
    // The squawking-scanner case: it reaches us and cannot establish. This is a
    // pairing problem, and saying "out of range" would send someone to move the
    // scanner closer when the fix is to re-pair it.
    const a = assessFoodScale(status({
      barcode: { connected: false, listening: true, open_count: 0, acl_conn_count: 7, auth_fail_count: 7 },
    }));
    expect(a.barcode.why).toMatch(/IS reaching us/i);
    expect(a.barcode.why).toMatch(/7 auth failures/);
    expect(a.barcode.fix).toMatch(/unbond/);
  });

  it('reads zero ACL connects as "never reached us"', () => {
    const a = assessFoodScale(status({
      barcode: { connected: false, listening: true, open_count: 0, acl_conn_count: 0 },
    }));
    expect(a.barcode.why).toMatch(/never reached us/i);
    expect(a.barcode.why).toMatch(/powered off, out of range/i);
  });

  it('admits ignorance on firmware without the counters, rather than guessing', () => {
    const a = assessFoodScale(status({
      barcode: { connected: false, listening: true, open_count: 0 }, // no acl_conn_count
    }));
    expect(a.barcode.why).toMatch(/cannot tell/i);
    expect(a.barcode.fix).toMatch(/Reflash/);
  });

  it('does NOT claim to know whether a never-opened scanner is off or failing auth', () => {
    // open_count counts successful SPP opens only. A scanner that pages and
    // fails auth emits GAP events with no SPP event and no counter, so it is
    // indistinguishable here from one switched off. Claiming "unpaired or out
    // of range" sent the operator to re-pair a scanner that may be pairing fine
    // and failing for another reason.
    const never = assessFoodScale(status({ barcode: { connected: false, listening: true, open_count: 0 } }));

    expect(never.barcode.why).toMatch(/cannot tell/i);
    expect(never.barcode.why).not.toMatch(/likely unpaired/i);
    expect(never.barcode.fix).toMatch(/esp log/);
  });

  it('blames the BT stack when the acceptor is not even listening', () => {
    const a = assessFoodScale(status({ barcode: { connected: false, listening: false } }));
    expect(a.barcode.why).toMatch(/not listening/i);
    expect(a.barcode.fix).toMatch(/reboot/);
  });

  it('does not land when the scanner is linked but the WS is down — scans would buffer then drop', () => {
    const a = assessFoodScale(status({ websocket: { connected: false } }));
    expect(a.barcode.land).toBe(false);
    expect(a.barcode.why).toMatch(/transport is down/i);
  });

  it('blames transport, not the scanner, when WiFi is down but the link holds', () => {
    const a = assessFoodScale(status({ wifi: { connected: false }, websocket: { connected: false } }));
    expect(a.barcode.why).toMatch(/transport/i);
    expect(a.barcode.why).not.toMatch(/scanner link dropped/i);
  });
});

describe('assessFoodScale — scale chain', () => {
  it('lands when the scale is linked and transport is up', () => {
    expect(assessFoodScale(status()).scale.land).toBe(true);
  });

  it('reads an active scan with no link as "scale is off", not as a fault', () => {
    const a = assessFoodScale(status({ scale: { connected: false, scan_active: true } }));
    expect(a.scale.land).toBe(false);
    expect(a.scale.why).toMatch(/powered off or asleep/i);
    expect(a.scale.fix).toMatch(/switch the scale on/i);
  });

  it('flags a stopped BLE scan as a distinct fault from a missing scale', () => {
    const a = assessFoodScale(status({ scale: { connected: false, scan_active: false } }));
    expect(a.scale.why).toMatch(/scan is not running/i);
    expect(a.scale.fix).toMatch(/blescan/);
  });
});

describe('assessFoodScale — the two chains are independent', () => {
  it('reports a working barcode chain even when the scale is absent', () => {
    const a = assessFoodScale(status({ scale: { connected: false, scan_active: true } }));
    expect(a.barcode.land).toBe(true);
    expect(a.scale.land).toBe(false);
  });

  it('survives a truncated payload without throwing', () => {
    expect(() => assessFoodScale({})).not.toThrow();
    expect(assessFoodScale({}).barcode.land).toBe(false);
  });
});
