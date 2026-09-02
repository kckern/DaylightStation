import { describe, it, expect, vi } from 'vitest';

vi.mock('../logging/Logger.js', () => {
  const emitted = [];
  const make = (ctx) => ({
    debug: (e, d) => emitted.push({ level: 'debug', e, d, ctx }),
    info:  (e, d) => emitted.push({ level: 'info', e, d, ctx }),
    warn:  (e, d) => emitted.push({ level: 'warn', e, d, ctx }),
    error: (e, d) => emitted.push({ level: 'error', e, d, ctx }),
    sampled: (e, d) => emitted.push({ level: 'sampled', e, d, ctx }),
    child: (c) => make({ ...ctx, ...c }),
  });
  return { default: () => make({}), __emitted: emitted };
});

import { createAppLogger } from './createAppLogger.js';
import * as mocked from '../logging/Logger.js';

describe('createAppLogger', () => {
  it('lazily creates a child logger scoped to the app', () => {
    const log = createAppLogger('testapp');
    log.info('hello', { a: 1 });
    const last = mocked.__emitted.at(-1);
    expect(last.e).toBe('hello');
    expect(last.ctx.app).toBe('testapp');
  });

  it('child() scopes a component under the app', () => {
    const log = createAppLogger('testapp').child('combobox');
    log.debug('evt');
    expect(mocked.__emitted.at(-1).ctx.component).toBe('combobox');
  });
});
