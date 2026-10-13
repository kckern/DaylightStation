import { it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = typeof traverseModule === 'function' ? traverseModule : traverseModule.default;
it('M3 composition: sessions changed reaches the producer installed after API construction', () => {
  const source = fs.readFileSync(new URL('../../../../__app_modules/wellness/fitness/server/composition/api-runtime.mjs', import.meta.url), 'utf8');
  let callback;
  traverse(parse(source, { sourceType: 'module' }), {
    ObjectProperty(p) {
      if (p.node.key.name === 'onSessionsChanged') callback = source.slice(p.node.value.start, p.node.value.end);
    },
  });
  expect(callback).toBeTruthy();
  let producer = null;
  const dependencies = { get fitnessStateGatesProducer() { return producer; } };
  const notify = vm.runInNewContext('(' + callback + ')', { dependencies });
  const received = [];
  notify({ beforeInstallation: true });
  producer = { requestReconcile(change) { received.push(change); } };
  const change = { sessionId: 'synthetic-session', event: 'saved' };
  notify(change);
  expect(received).toEqual([change]);
  producer = null;
  notify({ afterRemoval: true });
  expect(received).toEqual([change]);
});
