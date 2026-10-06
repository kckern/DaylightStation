// RQ-STEER-13 (STEER.11a): Pause all / Stop all fan out over each screen's
// session transport; Resume all restores exactly the screens that were
// playing; screens that couldn't be reached are listed.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { planQuiet, useHouseQuiet } from './houseQuiet.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';

const devices = [
  { id: 'livingroom-tv', name: 'Den TV', state: 'playing' },
  { id: 'office-tv', name: 'Office', state: 'paused' },
  { id: 'speaker-white', name: 'Bedroom speaker', state: 'playing' },
  { id: 'garage-tv', name: 'Garage', state: 'idle' },
  { id: 'browser:me', name: 'My phone', isLocal: true, state: 'playing' },
];
const entries = {
  'livingroom-tv': { snapshot: { state: 'playing' } },
  'office-tv': { snapshot: { state: 'paused' } },
  'speaker-white': { snapshot: { state: 'playing' }, offline: true },
};
const getEntry = (id) => entries[id] ?? null;

describe('planQuiet', () => {
  it('pauses what is playing, here included, and lists unreachable screens without sending', () => {
    const plan = planQuiet('pause', { devices, getEntry, localState: 'playing' });
    expect(plan.targets.map((t) => t.id)).toEqual(['livingroom-tv', 'local']);
    expect(plan.missed).toEqual([{ id: 'speaker-white', name: 'Bedroom speaker', reason: 'not reachable' }]);
  });

  it('stops anything active, paused included', () => {
    const plan = planQuiet('stop', { devices, getEntry, localState: 'paused' });
    expect(plan.targets.map((t) => t.id)).toEqual(['livingroom-tv', 'office-tv', 'local']);
  });

  it('resumes exactly the remembered screens', () => {
    const plan = planQuiet('resume', { devices, getEntry, localState: 'paused', resumable: ['office-tv', 'local'] });
    expect(plan.targets.map((t) => t.id)).toEqual(['office-tv', 'local']);
  });
});

function harness({ controllers, localTransport, resumable = null }) {
  let captured;
  const setResumable = vi.fn();
  const recordLocal = vi.fn();
  const fleet = {
    devices, store: { getEntry }, quiet: { resumable, setResumable },
  };
  function Probe() { captured = useHouseQuiet(); return null; }
  render(
    <FleetContext.Provider value={fleet}>
      <PeekContext.Provider value={{ getController: (id) => controllers[id] }}>
        <LocalSessionContext.Provider value={{ controller: { getSnapshot: () => ({ state: 'playing' }), subscribe: () => () => {}, transport: localTransport } }}>
          <DispatchContext.Provider value={{ recordLocal }}>
            <Probe />
          </DispatchContext.Provider>
        </LocalSessionContext.Provider>
      </PeekContext.Provider>
    </FleetContext.Provider>,
  );
  return { get: () => captured, setResumable, recordLocal };
}

describe('useHouseQuiet', () => {
  it('Pause all remembers the screens it paused and reports the ones it could not reach', async () => {
    const tv = { transport: { pause: vi.fn(async () => ({ ok: true })) } };
    const local = { pause: vi.fn(), play: vi.fn(), stop: vi.fn() };
    const h = harness({ controllers: { 'livingroom-tv': tv }, localTransport: local });
    await act(async () => { await h.get().pauseAll(); });
    expect(tv.transport.pause).toHaveBeenCalled();
    expect(local.pause).toHaveBeenCalled();
    expect(h.setResumable).toHaveBeenCalledWith(['livingroom-tv', 'local']);
    expect(h.recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'pauseAll', phase: 'failed',
      command: { copy: { primary: 'Paused 2 screens', secondary: 'Not paused: Bedroom speaker (not reachable)' } },
    }));
  });

  it('a screen that refuses or never answers is listed as not paused and not resumed later', async () => {
    const tv = { transport: { pause: vi.fn(async () => { throw new Error('ack timeout'); }) } };
    const local = { pause: vi.fn() };
    const h = harness({ controllers: { 'livingroom-tv': tv }, localTransport: local });
    await act(async () => { await h.get().pauseAll(); });
    expect(h.setResumable).toHaveBeenCalledWith(['local']);
    expect(h.recordLocal.mock.calls[0][0].command.copy.secondary)
      .toBe("Not paused: Bedroom speaker (not reachable), Den TV (didn't answer)");
  });

  it('Resume all plays exactly the remembered screens and then forgets them', async () => {
    const office = { transport: { play: vi.fn(async () => ({ ok: true })) } };
    const tv = { transport: { play: vi.fn() } };
    const local = { play: vi.fn() };
    const h = harness({ controllers: { 'office-tv': office, 'livingroom-tv': tv }, localTransport: local, resumable: ['office-tv'] });
    expect(h.get().canResume).toBe(true);
    await act(async () => { await h.get().resumeAll(); });
    expect(office.transport.play).toHaveBeenCalled();
    expect(tv.transport.play).not.toHaveBeenCalled();
    expect(local.play).not.toHaveBeenCalled();
    expect(h.setResumable).toHaveBeenCalledWith(null);
    expect(h.recordLocal.mock.calls[0][0]).toMatchObject({ kind: 'resumeAll', phase: 'confirmed' });
  });
});
