import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ fn: vi.fn(), nextReads: 0 }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: api.fn }));
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  logger.child = () => logger;
  return { default: () => logger };
});

import SchoolLock, {
  buyNotice, DEBOUNCED_COPY, PRINT_FALLBACK, PRINTED_COPY, PrintNextButton, printResult, SNEAK_USED_COPY,
} from './SchoolLock.jsx';

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

describe('printResult', () => {
  it('uses the kiosk’s own words on success, never the grown-up reprint sentence', () => {
    expect(printResult({ outcome: 'done', sentence: 'Regenerating that worksheet with the current print layout.' }))
      .toEqual({ tone: 'ok', text: PRINTED_COPY });
    expect(printResult({ outcome: 'debounced', sentence: 'x' })).toEqual({ tone: 'ok', text: DEBOUNCED_COPY });
  });

  it('keeps the reply’s reason on a refusal or failure, with a fallback', () => {
    expect(printResult({ outcome: 'refused', sentence: 'Math is done for today.' })).toEqual({ tone: 'warn', text: 'Math is done for today.' });
    expect(printResult({ outcome: 'failed' })).toEqual({ tone: 'warn', text: PRINT_FALLBACK });
    expect(printResult(null)).toEqual({ tone: 'warn', text: PRINT_FALLBACK });
  });
});

describe('PrintNextButton', () => {
  it('reads the next sheet again after a print', async () => {
    render(<PrintNextButton learnerId="kid" deviceId="tablet" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Print my next sheet (Math 4-02)' }));
    expect(await screen.findByText('Your sheet is printing.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Print my next sheet (Math 4-03)' })).toBeTruthy();
    expect(api.nextReads).toBe(2);
  });
});

describe('SchoolLock layout', () => {
  const access = {
    status: 'ready', state: 'incomplete', unlocked: false, refresh: vi.fn(),
    pass: { passId: null, state: 'none', capUsed: false }, offers: [],
  };

  it('draws today’s subjects as done and to-do tiles, skipping excused ones', async () => {
    api.fn.mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('/completion')) {
        return { sections: [
          { subject: 'english', state: 'served' }, { subject: 'math', state: 'obligated' }, { subject: 'science', state: 'excused' },
        ] };
      }
      return {};
    });
    const { container } = render(<SchoolLock access={access} learnerId="kid" learnerName="Kid" />);
    expect(await screen.findByText('School today: 1 of 2 done')).toBeTruthy();
    const tiles = [...container.querySelectorAll('.piano-school-lock__subject')].map((li) => li.className.split('--')[1]);
    expect(tiles).toEqual(['done', 'todo']);
    expect(container.querySelector('.piano-school-lock__face img').getAttribute('src')).toContain('/img/users/kid');
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
    await screen.findByRole('button', { name: 'Print my next sheet (Math 4-02)' });
    const live = [...container.querySelectorAll('[role="status"]')].map((el) => el.className);
    expect(live).toEqual(['piano-school-lock__sentence', 'piano-school-lock__notice']);
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
