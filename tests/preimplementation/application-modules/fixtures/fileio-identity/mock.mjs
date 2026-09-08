/** Target/factory placeholders are substituted only in the disposable fixture. */
import { expect, test, vi } from 'vitest';
import path from 'node:path';
const io = vi.hoisted(() => ({ loadYaml: vi.fn(() => ({ origin: 'mock' })) }));
vi.mock('__MOCK_TARGET__', __MOCK_FACTORY__);
import { read as externalRead } from './external-reader.mjs';
import { read as internalRead } from './platform/server/system/reader.mjs';

test('FILEIO_MOCK_EXTERNAL: public consumer receives the hoisted partial replacement', () => {
  expect(externalRead(path.join(process.env.PRE_RUN_ROOT, 'sample.yml'))).toEqual({ origin: 'mock' });
});
test('FILEIO_MOCK_INTERNAL: same-owner private consumer receives the same replacement', () => {
  expect(internalRead(path.join(process.env.PRE_RUN_ROOT, 'sample.yml')), 'FILEIO_MOCK_INTERNAL').toEqual({ origin: 'mock' });
});
test('FILEIO_MOCK_DYNAMIC: dynamic public import sees the factory binding', async () => {
  const loaded = await import('@daylight/platform/server/system/utils/file-io');
  expect(loaded.loadYaml).toBe(io.loadYaml);
  expect(loaded.loadYaml(path.join(process.env.PRE_RUN_ROOT, 'sample.yml'))).toEqual({ origin: 'mock' });
});
