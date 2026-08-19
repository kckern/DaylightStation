import { resolvePorts, deepMerge, DEFAULT_APP_PORT } from './vite.ports.mjs';

// Stub filesystem: a Map of path -> parsed-yaml-object (as if already yaml.load()'d).
function makeFs(files) {
  return {
    exists: (p) => files.has(p),
    readYaml: (p) => files.get(p),
  };
}

const BASE_PATH = '/data/system/config/system.yml';
const LOCAL_PATH = (env) => `/data/system/config/system-local.${env}.yml`;

describe('vite.ports resolvePorts — local-over-base merge (regression: local file must not replace base)', () => {
  test('missing dataPath/envName falls back to the hardcoded default', () => {
    const result = resolvePorts({});
    expect(result).toEqual({ app: DEFAULT_APP_PORT, backend: DEFAULT_APP_PORT + 1, usedDefault: true });
  });

  test('no local file present -> base system.yml is used', () => {
    const fs = makeFs(new Map([
      [BASE_PATH, { app: { ports: { 'kckern-server': 3112 } } }],
    ]));
    const result = resolvePorts({ dataPath: '/data', envName: 'kckern-server', ...fs });
    expect(result.app).toBe(3112);
    expect(result.backend).toBe(3113);
  });

  test('local file present but WITHOUT an app key -> base app.ports still wins (the kckern-server bug)', () => {
    const fs = makeFs(new Map([
      [BASE_PATH, { app: { ports: { 'kckern-server': 3112 } } }],
      [LOCAL_PATH('kckern-server'), { logging: { fileSink: { path: '/var/log/x' } } }],
    ]));
    const result = resolvePorts({ dataPath: '/data', envName: 'kckern-server', ...fs });
    expect(result.app).toBe(3112);
    expect(result.backend).toBe(3113);
  });

  test('local file WITH app.ports.<env> overrides the base value for that env', () => {
    const fs = makeFs(new Map([
      [BASE_PATH, { app: { ports: { 'kckern-server': 3112 } } }],
      [LOCAL_PATH('kckern-server'), { app: { ports: { 'kckern-server': 9999 } } }],
    ]));
    const result = resolvePorts({ dataPath: '/data', envName: 'kckern-server', ...fs });
    expect(result.app).toBe(9999);
    expect(result.backend).toBe(10000);
  });

  test('local file overrides one env only, base value for a different env is untouched', () => {
    const fs = makeFs(new Map([
      [BASE_PATH, { app: { ports: { 'kckern-server': 3112, 'kckern-macbook': 3111 } } }],
      [LOCAL_PATH('kckern-server'), { app: { ports: { 'kckern-server': 9999 } } }],
    ]));
    const result = resolvePorts({ dataPath: '/data', envName: 'kckern-macbook', ...fs });
    expect(result.app).toBe(3111);
    expect(result.backend).toBe(3112);
  });

  test('neither file exists -> hardcoded default', () => {
    const fs = makeFs(new Map());
    const result = resolvePorts({ dataPath: '/data', envName: 'kckern-server', ...fs });
    expect(result.app).toBe(DEFAULT_APP_PORT);
    expect(result.backend).toBe(DEFAULT_APP_PORT + 1);
  });
});

describe('deepMerge — matches backend/src/0_system/utils/deepMerge.mjs semantics', () => {
  test('undefined override values are skipped, base preserved', () => {
    expect(deepMerge({ a: 1 }, { a: undefined, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test('arrays are replaced wholesale, never concatenated', () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  test('null override does not clear an existing base value', () => {
    expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: 1 });
  });

  test('nested objects merge recursively', () => {
    expect(deepMerge({ app: { ports: { x: 1, y: 2 } } }, { app: { ports: { x: 9 } } }))
      .toEqual({ app: { ports: { x: 9, y: 2 } } });
  });
});
