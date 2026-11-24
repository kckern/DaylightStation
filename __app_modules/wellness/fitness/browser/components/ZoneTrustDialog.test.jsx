import React from 'react';
import {afterEach, beforeEach, it, expect, vi} from 'vitest';
import {act, cleanup, render, screen, fireEvent} from '@testing-library/react';
const h = vi.hoisted(() => ({context: null, identity: null}));
vi.mock('../context/FitnessContext.jsx', () => ({useFitnessContext: () => h.context}));
vi.mock('../identity/useIdentity.js', () => ({useIdentity: () => h.identity}));
import ZoneTrustDialog from './ZoneTrustDialog.jsx';

let resolve, approvals, onClose;
const profile = (id = 'kid') => ({id, displayName: id === 'kid' ? 'Rider One' : 'Rider Two', heartRate: 140,
  zoneTrusted: false, zoneReadingEligible: true, zoneReadingDeviceId: 'sensor', trustRevision: 1,
  zoneConfig: [{id: 'active', min: 100}]});
const dialog = (riderId = 'kid') => <ZoneTrustDialog riderId={riderId} onClose={onClose} />;

beforeEach(() => {
  approvals = [];
  onClose = vi.fn();
  h.context = {zoneProfiles: [profile()], fitnessSessionInstance: {sessionId: 'session', endTime: null,
    approveZoneTrust: grant => {
      approvals.push(grant);
      h.context.zoneProfiles = h.context.zoneProfiles.map(p => p.id === grant.userId ? {...p, zoneTrusted: true} : p);
      return {ok: true};
    }}, forceUpdate: () => {}};
  h.identity = {registerAdmin: () => new Promise(r => { resolve = r; }), clearUnlock: vi.fn(), unlockState: 'scanning'};
});
afterEach(cleanup);

it('explains one rider: reading, what is paused, how it clears', () => {
  const view = render(dialog());
  expect(screen.getByRole('dialog', {name: "Rider One's heart rate isn't trusted yet"})).toBeTruthy();
  expect(screen.getByText('140')).toBeTruthy();
  expect(screen.getByText(/Rings and Fire don't count for Rider One/)).toBeTruthy();
  expect(screen.getByText(/drops below 100 BPM/)).toBeTruthy();
  h.context.zoneProfiles[0].zoneReadingEligible = false; view.rerender(dialog());
  expect(screen.getByText(/steady reading/)).toBeTruthy();
});

it('closes itself once the reading is trusted, the session ends, or the rider has no reading', () => {
  const view = render(dialog());
  expect(onClose).not.toHaveBeenCalled();
  h.context.zoneProfiles = [{...profile(), zoneTrusted: true}]; view.rerender(dialog());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes when the session ends', () => {
  const view = render(dialog());
  h.context.fitnessSessionInstance = {...h.context.fitnessSessionInstance, sessionId: null}; view.rerender(dialog());
  expect(onClose).toHaveBeenCalled();
});

it('admin approval trusts only the selected rider', async () => {
  h.context.zoneProfiles.push(profile('other'));
  const view = render(dialog());
  fireEvent.click(screen.getByRole('button', {name: 'Admin unlock Rider One'}));
  await act(async () => resolve({matched: true, userId: 'admin'})); view.rerender(dialog());
  expect(h.context.zoneProfiles[0].zoneTrusted).toBe(true);
  expect(h.context.zoneProfiles[1].zoneTrusted).toBe(false);
  expect(approvals[0]).toEqual({sessionId: 'session', userId: 'kid', deviceId: 'sensor', trustRevision: 1, adminId: 'admin'});
  expect(h.identity.clearUnlock).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it.each(['denied', 'session', 'session-object', 'wearer', 'revision', 'unmount'])('keeps trust blocked after %s', async mode => {
  const view = render(dialog());
  fireEvent.click(screen.getByRole('button', {name: 'Admin unlock Rider One'}));
  if (mode === 'session-object') h.context.fitnessSessionInstance = {...h.context.fitnessSessionInstance};
  if (mode === 'session') h.context.fitnessSessionInstance = {...h.context.fitnessSessionInstance, sessionId: 'next'};
  if (mode === 'wearer') h.context.zoneProfiles = [{...profile(), zoneReadingDeviceId: 'replacement'}];
  if (mode === 'revision') h.context.zoneProfiles = [{...profile(), trustRevision: 2}];
  if (mode === 'unmount') view.unmount(); else view.rerender(dialog());
  await act(async () => resolve({matched: mode !== 'denied', userId: 'admin'}));
  expect(approvals).toEqual([]);
  expect(h.context.zoneProfiles[0].zoneTrusted).toBe(false);
  expect(h.identity.clearUnlock).toHaveBeenCalled();
});

it('a refused grant keeps the dialog open with the reason', async () => {
  h.context.fitnessSessionInstance.approveZoneTrust = () => ({ok: false, reason: 'stale'});
  render(dialog());
  fireEvent.click(screen.getByRole('button', {name: 'Admin unlock Rider One'}));
  await act(async () => resolve({matched: true, userId: 'admin'}));
  expect(h.context.zoneProfiles[0].zoneTrusted).toBe(false);
  expect(screen.getByRole('status').textContent).toMatch(/still not trusted/);
});

it('Close calls onClose without approving anything', () => {
  render(dialog());
  fireEvent.click(screen.getByRole('button', {name: 'Close'}));
  expect(onClose).toHaveBeenCalled();
  expect(approvals).toEqual([]);
});
