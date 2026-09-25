import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AuditorConfig } from './AuditorConfig.jsx';
import { SettingsLog } from './SettingsLog.jsx';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

const TRIGGERS = ['captures', 'reviews', 'stabilization', 'scaleReconcile', 'artwork', 'dayRollover', 'edits', 'dailySweep'];
const PERMISSIONS = ['naming', 'identification', 'mealPlacement', 'grouping', 'artwork', 'portion', 'nutrients', 'estimates', 'completeCaptures', 'questions'];
const all = keys => Object.fromEntries(keys.map(key => [key, true]));
let status;
const spend = { data: { byModel: [{ model: 'gpt-4.1-mini', runs: 12, avgUsd: 0.0123, costUsd: 0.15 }] } };
beforeEach(() => {
  resetApiResourceCache(); api.mockReset();
  status = { version: 7, settings: { enabled: false, dryRun: true, telegram: false, model: 'gpt-4.1-mini', dailyCapUsd: 1, minGapMinutes: 15,
    triggers: all(TRIGGERS), permissions: all(PERMISSIONS) }, runs: [], questions: [], nextEligibleAt: null };
  api.mockImplementation(async (path, body, method) => {
    if (method) return {};
    if (path.endsWith('/settings/log')) return { entries: [] };
    return structuredClone(status);
  });
});
const resource = () => ({ data: status, reload: vi.fn() });
const mount = (res = resource()) => { render(<MantineProvider><AuditorConfig resource={res} spend={spend} /></MantineProvider>); return res; };
const patched = body => expect(api).toHaveBeenCalledWith(`${cleanupPath}/settings`, body, 'PATCH');

describe('Auditor configuration', () => {
  it('uses preview defaults and sends switches with the current revision', async () => {
    const res = mount();
    const automatic = screen.getByLabelText('Automatic cleanup');
    expect(automatic.checked).toBe(false);
    expect(screen.getByLabelText('Preview only — do not change food or send questions').checked).toBe(true);
    fireEvent.click(automatic);
    await waitFor(() => patched({ expectedVersion: 7, enabled: true }));
    await waitFor(() => expect(res.reload).toHaveBeenCalled());
  });
  it('turns one permission off', async () => {
    mount();
    fireEvent.click(screen.getByRole('switch', { name: /^Nutrient values/ }));
    await waitFor(() => patched({ expectedVersion: 7, permissions: { nutrients: false } }));
    expect(screen.getByText('Change nutrient values')).toBeTruthy();
  });
  it('turns one trigger off', async () => {
    mount();
    fireEvent.click(screen.getByLabelText('Scale readings updated'));
    await waitFor(() => patched({ expectedVersion: 7, triggers: { scaleReconcile: false } }));
  });
  it('sends a blank daily cap as no cap, on blur only', async () => {
    mount();
    const cap = screen.getByLabelText('Daily cap ($)');
    fireEvent.change(cap, { target: { value: '' } });
    expect(api).not.toHaveBeenCalledWith(`${cleanupPath}/settings`, expect.anything(), 'PATCH');
    fireEvent.blur(cap);
    await waitFor(() => patched({ expectedVersion: 7, dailyCapUsd: null }));
  });
  it('commits a new cap on Enter', async () => {
    mount();
    const cap = screen.getByLabelText('Daily cap ($)');
    fireEvent.change(cap, { target: { value: '2.5' } });
    fireEvent.keyDown(cap, { key: 'Enter' });
    await waitFor(() => patched({ expectedVersion: 7, dailyCapUsd: 2.5 }));
  });
  it('sets the minimum gap', async () => {
    mount();
    fireEvent.click(screen.getByLabelText('60 min'));
    await waitFor(() => patched({ expectedVersion: 7, minGapMinutes: 60 }));
  });
  it('shows cost per run next to each model', () => {
    mount();
    expect(screen.getByDisplayValue('gpt-4.1-mini · ≈ $0.012 / run')).toBeTruthy();
  });
  it('says settings changed and reloads on a version conflict', async () => {
    api.mockImplementation(async (path, body, method) => {
      if (method) throw Object.assign(new Error('HTTP 409: Conflict - {"error":"Settings changed. Reload first."}'), { status: 409 });
      return structuredClone(status);
    });
    const res = mount();
    fireEvent.click(screen.getByRole('switch', { name: /^Nutrient values/ }));
    expect(await screen.findByText('Settings changed. Reload first.')).toBeTruthy();
    expect(res.reload).toHaveBeenCalled();
  });
  it('shows the server message on a bad request', async () => {
    api.mockImplementation(async (path, body, method) => {
      if (method) throw Object.assign(new Error('HTTP 400: Bad Request - {"error":"Invalid daily cap"}'), { status: 400 });
      return structuredClone(status);
    });
    mount();
    const cap = screen.getByLabelText('Daily cap ($)');
    fireEvent.change(cap, { target: { value: '3' } });
    fireEvent.blur(cap);
    expect(await screen.findByText('Invalid daily cap')).toBeTruthy();
  });
  it('runs a preview now', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup now' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${cleanupPath}/run`, {}, 'POST'));
  });
});

describe('Auditor settings log', () => {
  const entries = [
    { at: '2026-09-25T17:42:00.000Z', actor: 'user', field: 'model', from: 'gpt-4.1-mini', to: 'gpt-4o' },
    { at: '2026-09-25T17:40:00.000Z', actor: 'user', field: 'permissions.nutrients', from: true, to: false },
    { at: '2026-09-25T17:39:00.000Z', actor: 'user', field: 'triggers.scaleReconcile', from: true, to: false },
    { at: '2026-09-25T17:38:00.000Z', actor: 'user', field: 'dailyCapUsd', from: 1, to: null },
    { at: '2026-09-25T17:37:00.000Z', actor: 'user', field: 'minGapMinutes', from: 0, to: 30 },
    ...Array.from({ length: 8 }, (_, i) => ({ at: `2026-09-2${i % 5}T10:00:00.000Z`, actor: 'user', field: 'telegram', from: false, to: true })),
  ];
  const mountLog = () => render(<MantineProvider><SettingsLog /></MantineProvider>);
  it('renders changes in plain words, collapsed after ten', async () => {
    api.mockImplementation(async () => ({ entries }));
    mountLog();
    expect(await screen.findByText(/^Model: gpt-4\.1-mini → gpt-4o · Sep 25/)).toBeTruthy();
    expect(screen.getByText(/^Nutrient values permission: On → Off/)).toBeTruthy();
    expect(screen.getByText(/^Scale readings updated trigger: On → Off/)).toBeTruthy();
    expect(screen.getByText(/^Daily cap: \$1\.00 → No cap/)).toBeTruthy();
    expect(screen.getByText(/^Minimum gap: Off → 30 min/)).toBeTruthy();
    expect(screen.getAllByText(/^Telegram questions: Off → On/).length).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all (13)' }));
    expect(screen.getAllByText(/^Telegram questions: Off → On/).length).toBe(8);
  });
  it('says when nothing has changed', async () => {
    api.mockImplementation(async () => ({ entries: [] }));
    mountLog();
    expect(await screen.findByText('No settings changes yet.')).toBeTruthy();
  });
});
