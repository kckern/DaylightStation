import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ fn: vi.fn(), nextReads: 0 }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: api.fn }));
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  logger.child = () => logger;
  return { default: () => logger };
});

import SchoolLock, { buyNotice, PrintNextButton, SNEAK_USED_COPY } from './SchoolLock.jsx';

const httpError = (status, body) => Object.assign(new Error(`HTTP ${status}: x`), { status, ...(body ? { body } : {}) });

beforeEach(() => {
  api.nextReads = 0;
  api.fn.mockReset();
  api.fn.mockImplementation(async (path) => {
    const p = String(path);
    if (p.endsWith('/next')) {
      api.nextReads += 1;
      return { unit: { title: api.nextReads === 1 ? 'Math 4-02' : 'Math 4-03' }, printable: true, reward: null };
    }
    if (p.endsWith('/print-next')) return { sentence: 'Your sheet is printing.' };
    if (p.endsWith('/completion')) return { sections: [] };
    return {};
  });
});

describe('buyNotice', () => {
  it('names the shortfall on a 402', () => {
    expect(buyNotice(httpError(402, { code: 'PASS_UNAFFORDABLE', coin: 'gold', shortfall: 1 }), 'gold')).toBe('1 more gold to buy a game.');
  });

  it('a fractional gold shortfall reads in whole coins, rounded up (0.4 → 1)', () => {
    expect(buyNotice(httpError(402, { code: 'PASS_UNAFFORDABLE', coin: 'gold', shortfall: 0.4 }), 'gold')).toBe('1 more gold to buy a game.');
    expect(buyNotice(httpError(402, { code: 'PASS_UNAFFORDABLE', coin: 'gold', shortfall: 2.4 }), 'gold')).toBe('3 more gold to buy a game.');
  });

  it('says plainly "not enough" on a 402 with no shortfall', () => {
    expect(buyNotice(httpError(402, { code: 'PASS_UNAFFORDABLE' }), 'silver')).toBe('Not enough silver yet.');
    expect(buyNotice(httpError(402), 'silver')).toBe('Not enough silver yet.');
  });

  it('says games are not for sale on PASS_NOT_SOLD', () => {
    expect(buyNotice(httpError(409, { code: 'PASS_NOT_SOLD' }), 'silver')).toBe('Games aren’t for sale right now.');
  });

  it('uses the cap copy on PASS_CAP, and a generic line otherwise', () => {
    expect(buyNotice(httpError(409, { code: 'PASS_CAP' }), 'silver')).toBe(SNEAK_USED_COPY);
    expect(buyNotice(new Error('Network error: offline'), 'silver')).toBe('Couldn’t buy a game right now. Try again later.');
  });
});

describe('PrintNextButton', () => {
  it('reads the next sheet again after a print', async () => {
    render(<PrintNextButton learnerId="kid" deviceId="tablet" />);
    fireEvent.click(await screen.findByText('Print my next sheet (Math 4-02)'));
    expect(await screen.findByText('Your sheet is printing.')).toBeTruthy();
    expect(await screen.findByText('Print my next sheet (Math 4-03)')).toBeTruthy();
    expect(api.nextReads).toBe(2);
  });
});

describe('SchoolLock accessibility', () => {
  const access = {
    status: 'ready', state: 'incomplete', unlocked: false, refresh: vi.fn(),
    pass: { passId: null, state: 'none', capUsed: false }, offers: [{ coin: 'silver', price: 3, affordable: true }],
  };

  it('labels the panel by its heading and keeps the live regions to the notice and sentence', async () => {
    const { container } = render(<SchoolLock access={access} learnerId="kid" />);
    const section = container.querySelector('section');
    expect(section.getAttribute('role')).toBeNull();
    expect(document.getElementById(section.getAttribute('aria-labelledby')).textContent).toBe('Games are locked');
    await screen.findByText('Print my next sheet (Math 4-02)');
    const live = [...container.querySelectorAll('[role="status"]')].map((el) => el.className);
    expect(live).toEqual(['piano-school-lock__notice', 'piano-school-lock__sentence']);
  });

  it('makes the confirm step a labelled group and moves focus to "Not now"', async () => {
    render(<SchoolLock access={access} learnerId="kid" />);
    fireEvent.click(screen.getByText('Spend 3 silver: one game'));
    const group = screen.getByRole('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')).textContent)
      .toBe('One game, then games lock until school is done');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Not now'));
  });

  it('marks the offer busy while a buy is in flight', async () => {
    let release;
    api.fn.mockImplementation(async (path) => {
      if (String(path).endsWith('/passes')) return new Promise((resolve) => { release = resolve; });
      return {};
    });
    const { container } = render(<SchoolLock access={access} learnerId="kid" />);
    fireEvent.click(screen.getByText('Spend 3 silver: one game'));
    fireEvent.click(screen.getByText('Yes, spend 3 silver'));
    expect(container.querySelector('.piano-school-lock__offer').getAttribute('aria-busy')).toBe('true');
    release({ pass: { passId: 'p' } });
    await waitFor(() => expect(container.querySelector('.piano-school-lock__offer').getAttribute('aria-busy')).toBe('false'));
    expect(access.refresh).toHaveBeenCalled();
  });
});
