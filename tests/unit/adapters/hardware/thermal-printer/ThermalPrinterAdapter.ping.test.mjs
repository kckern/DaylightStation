import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';

const mockCreateConnection = jest.fn();
jest.unstable_mockModule('net', () => ({
  default: { createConnection: mockCreateConnection },
  createConnection: mockCreateConnection,
}));

const { ThermalPrinterAdapter } = await import(
  '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs'
);

function fakeSocket() {
  const sock = new EventEmitter();
  sock.end = jest.fn();
  sock.destroy = jest.fn();
  sock.setTimeout = jest.fn();
  sock.write = jest.fn();
  return sock;
}

describe('ThermalPrinterAdapter.ping (byte-free)', () => {
  beforeEach(() => {
    mockCreateConnection.mockReset();
  });

  it('returns { success: false, configured: false } when no host', async () => {
    const adapter = new ThermalPrinterAdapter({ host: '', port: 9100 });
    const result = await adapter.ping();
    expect(result).toMatchObject({ success: false, configured: false });
    expect(mockCreateConnection).not.toHaveBeenCalled();
  });

  it('opens a raw TCP connection and NEVER writes any bytes', async () => {
    const sock = fakeSocket();
    mockCreateConnection.mockReturnValue(sock);

    const adapter = new ThermalPrinterAdapter({ host: '10.0.0.50', port: 9100 });
    const pingPromise = adapter.ping();

    process.nextTick(() => sock.emit('connect'));
    const result = await pingPromise;

    expect(result.success).toBe(true);
    expect(result.host).toBe('10.0.0.50');
    expect(result.port).toBe(9100);
    expect(sock.write).not.toHaveBeenCalled();  // CRITICAL: no bytes written
    expect(sock.end).toHaveBeenCalled();
  });

  it('reports timeout when connection never opens', async () => {
    const sock = fakeSocket();
    mockCreateConnection.mockReturnValue(sock);

    const adapter = new ThermalPrinterAdapter({
      host: '10.0.0.99', port: 9100, timeout: 50,
    });
    const result = await adapter.ping();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout/i);
    expect(sock.write).not.toHaveBeenCalled();
    expect(sock.destroy).toHaveBeenCalled();
  });

  it('reports error on socket error event', async () => {
    const sock = fakeSocket();
    mockCreateConnection.mockReturnValue(sock);

    const adapter = new ThermalPrinterAdapter({ host: '10.0.0.99', port: 9100 });
    const pingPromise = adapter.ping();

    process.nextTick(() => sock.emit('error', new Error('ECONNREFUSED')));
    const result = await pingPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/i);
    expect(sock.write).not.toHaveBeenCalled();
  });
});
