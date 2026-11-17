import { Component, Suspense, StrictMode, useState } from 'react';
import { render, act, screen } from '@testing-library/react';
import { it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalMountCommit, useLocalMountConfirmation } from './LocalMountCommit.jsx';
import { YamlTokenRegistry } from '../../server/adapters/persistence/YamlTokenRegistry.mjs';
import { HmacSchoolMountReceiptIssuer } from '../../server/adapters/actions/HmacSchoolMountReceiptIssuer.mjs';
import { AcknowledgeSelfServiceMount } from '../../server/application/usecases/AcknowledgeSelfServiceMount.mjs';
const roots = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'school-commit-')); roots.push(root);
  const now = Date.now();
  const registry = new YamlTokenRegistry({ configService: { getHouseholdPath: () => root } });
  const token = 'sch:COMMITTEST';
  await registry.put({ token, tokenClass: 'subject_next', subject: { learnerId: 'kid1' }, accessCode: '123456', accessCodeExpiresAt: new Date(now+3600000).toISOString(), maxUses: 1 });
  const use = { useId: 'use1', learnerId: 'kid1', deviceId: 'kiosk', action: 'program', at: new Date(now).toISOString(), expiresAt: new Date(now+120000).toISOString() };
  await registry.reserveMountUse(token, use);
  const issuer = new HmacSchoolMountReceiptIssuer({ key: 'k'.repeat(32), householdId: 'home' });
  const receipt = issuer.issue({ ...use, token });
  const ack = new AcknowledgeSelfServiceMount({ tokens: registry, mountReceiptIssuer: issuer });
  let controls;
  let ready = false; let wake;
  const suspended = new Promise(resolve => { wake = () => { ready = true; resolve(); }; });
  function Target({ throws }) { if (throws) throw new Error('target failed'); if (!ready) throw suspended; return <div>Committed target</div>; }
  class Boundary extends Component { state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; } render() { return this.state.failed ? <div>Failed target</div> : this.props.children; } }
  function Harness({ throws = false }) {
    const coordinator = useLocalMountConfirmation();
    const [request, setRequest] = useState(null);
    controls = { launch() { const next = coordinator.begin(); setRequest(next); return next.promise; }, override() { coordinator.cancel(); setRequest(null); } };
    return <Boundary><Suspense fallback={<div>Waiting target</div>}>{request && <LocalMountCommit requestId={request.id} confirm={coordinator.confirm}><Target throws={throws} /></LocalMountCommit>}</Suspense></Boundary>;
  }
  const count = async () => (await registry.get(token)).useCount ?? 0;
  const settle = promise => promise.then(mounted => ack.execute({ receipt, mounted, deviceId: 'kiosk' }));
  return { Harness, getControls: () => controls, wake, count, settle };
}
it('a suspended target spends nothing until the matching subtree commits, once under StrictMode', async () => {
  const f = await fixture(); render(<StrictMode><f.Harness /></StrictMode>);
  let outcome;
  await act(async () => { outcome = f.settle(f.getControls().launch()); });
  expect(screen.getByText('Waiting target')).toBeInTheDocument();
  expect(await f.count()).toBe(0);
  await act(async () => { f.wake(); });
  expect(await outcome).toEqual({ ok: true, committed: true, replayed: false });
  expect(screen.getByText('Committed target')).toBeInTheDocument();
  expect(await f.count()).toBe(1);
});
it('overridden and unmounted uncommitted requests release without consuming a use', async () => {
  for (const cause of ['override', 'unmount']) {
    const f = await fixture(); const view = render(<f.Harness />); let outcome;
    await act(async () => { outcome = f.settle(f.getControls().launch()); });
    await act(async () => { if (cause === 'override') f.getControls().override(); else view.unmount(); });
    expect((await outcome).committed).toBe(false); expect(await f.count()).toBe(0);
    view.unmount();
  }
});
it('an uncommitted request times out and cannot confirm later', async () => {
  vi.useFakeTimers(); const f = await fixture(); render(<f.Harness />); let promise;
  await act(async () => { promise = f.getControls().launch(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(await promise).toBe(false);
  await act(async () => { f.wake(); });
  expect(await f.count()).toBe(0);
});
it('a throwing target cannot confirm a mount', async () => {
  const f = await fixture(); const view = render(<f.Harness throws />); let promise; let settled = false;
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await act(async () => { promise = f.getControls().launch(); promise.then(() => { settled = true; }); });
    expect(screen.getByText('Failed target')).toBeInTheDocument();
    expect(settled).toBe(false); expect(await f.count()).toBe(0);
    view.unmount(); expect(await promise).toBe(false);
  } finally { error.mockRestore(); }
});
