import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const logged = vi.hoisted(() => []);
vi.mock('@/lib/logging/Logger.js', () => {
  const rec = (level) => (event, data) => logged.push({ level, event, data });
  const logger = { child: () => logger, debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error'), sampled: () => {} };
  return { getLogger: () => logger, default: () => logger };
});
vi.mock('./GovernanceAudioPlayer.jsx', () => ({ default: () => null }));

import GovernanceStateOverlay from './GovernanceStateOverlay.jsx';

const row = (key) => ({ key, userId: key, displayName: key, avatarSrc: '', heartRate: 110,
  currentZone: { id: 'cool', name: 'Cool' }, targetZone: { id: 'active', name: 'Active' }, status: 'missing' });
const warning = (rows) => ({ show: true, status: 'warning', deadline: Date.now() + 30_000, gracePeriodTotal: 30, rows });
const events = (name) => logged.filter((e) => e.event === `governance.warning_overlay.${name}`);

describe('GovernanceStateOverlay — warning overlay observability', () => {
  beforeEach(() => { logged.length = 0; });

  it('logs shown, a paint check, row changes, and hidden with how long it was up', async () => {
    const view = render(<GovernanceStateOverlay display={warning([row('rider-a')])} />);
    expect(events('shown')[0].data.rows).toBe('rider-a');
    await waitFor(() => expect(events('paint_check')).toHaveLength(1));
    expect(events('paint_check')[0].data).toMatchObject({ dimmed: false });

    view.rerender(<GovernanceStateOverlay display={warning([row('rider-a'), row('rider-b')])} />);
    expect(events('rows_changed')[0].data).toMatchObject({ rows: 'rider-a,rider-b', previous: 'rider-a' });

    view.rerender(<GovernanceStateOverlay display={{ show: false, status: 'unlocked', rows: [] }} />);
    expect(events('hidden')).toHaveLength(1);
    expect(events('hidden')[0].data.visibleMs).toBeGreaterThanOrEqual(0);
  });

  it('warns when the meter is painted under a filter', async () => {
    const host = document.createElement('div');
    host.className = 'fitness-player-content';
    host.style.filter = 'grayscale(1) brightness(0.6)';
    document.body.appendChild(host);
    render(<GovernanceStateOverlay display={warning([row('rider-a')])} />, { container: host });
    await waitFor(() => expect(events('dimmed')).toHaveLength(1));
    expect(events('dimmed')[0].level).toBe('warn');
    expect(events('dimmed')[0].data.targets.meter.filters[0].filter).toContain('grayscale');
  });
});
