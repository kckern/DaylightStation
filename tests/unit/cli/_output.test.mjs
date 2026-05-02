// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import {
  printJson,
  printError,
  EXIT_OK,
  EXIT_FAIL,
  EXIT_USAGE,
  EXIT_CONFIG,
  EXIT_BACKEND,
} from '../../../cli/_output.mjs';

function makeBuffer() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  stream.read = () => Buffer.concat(chunks).toString('utf8');
  return stream;
}

describe('exit code constants', () => {
  it('matches the contract in the spec', () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_FAIL).toBe(1);
    expect(EXIT_USAGE).toBe(2);
    expect(EXIT_CONFIG).toBe(3);
    expect(EXIT_BACKEND).toBe(4);
  });
});

describe('printJson', () => {
  it('writes a single JSON value followed by newline', () => {
    const buf = makeBuffer();
    printJson(buf, { hello: 'world' });
    expect(buf.read()).toBe('{"hello":"world"}\n');
  });

  it('serializes numbers, arrays, nested objects', () => {
    const buf = makeBuffer();
    printJson(buf, { count: 2, items: [{ a: 1 }, { a: 2 }] });
    expect(JSON.parse(buf.read().trim())).toEqual({ count: 2, items: [{ a: 1 }, { a: 2 }] });
  });
});

describe('printError', () => {
  it('writes a JSON error envelope to the given stream', () => {
    const buf = makeBuffer();
    printError(buf, { error: 'not_found', entity_id: 'light.x' });
    const parsed = JSON.parse(buf.read().trim());
    expect(parsed).toEqual({ error: 'not_found', entity_id: 'light.x' });
  });

  it('coerces an Error instance into { error: message }', () => {
    const buf = makeBuffer();
    printError(buf, new Error('boom'));
    const parsed = JSON.parse(buf.read().trim());
    expect(parsed.error).toBe('boom');
  });

  it('coerces a string into { error: <string> }', () => {
    const buf = makeBuffer();
    printError(buf, 'something went wrong');
    expect(JSON.parse(buf.read().trim())).toEqual({ error: 'something went wrong' });
  });
});
