import { describe, it, expect } from 'vitest';
import { GeographyBankSource } from './GeographyBankSource.mjs';
import { validateQuestionBank } from '#domains/school/index.mjs';

const src = new GeographyBankSource();

it('resolves an available deck to a valid bank', () => {
  const bank = src.resolve('geo:us-state-capitals');
  expect(bank).toBeTruthy();
  expect(bank.items.length).toBe(50);
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('resolves us-state-locations and world-flags to valid banks', () => {
  expect(validateQuestionBank(src.resolve('geo:us-state-locations')).ok).toBe(true);
  const flags = src.resolve('geo:world-flags');
  expect(flags.items.length).toBe(50);
  expect(validateQuestionBank(flags).ok).toBe(true);
});

it('returns null for non-geo ids, unknown decks, and unavailable decks', () => {
  expect(src.resolve('some-file-bank')).toBeNull();
  expect(src.resolve('geo:nope')).toBeNull();
  expect(src.resolve('geo:country-locations')).toBeNull(); // available: false
});

it('lists deck summaries including unavailable ones', () => {
  const decks = src.listDeckSummaries();
  const ids = decks.map((d) => d.deckId);
  expect(ids).toContain('us-state-locations');
  expect(ids).toContain('country-locations');
  const cl = decks.find((d) => d.deckId === 'country-locations');
  expect(cl).toMatchObject({ bankId: 'geo:country-locations', available: false });
});

it('memoizes resolve (same object across calls)', () => {
  expect(src.resolve('geo:world-flags')).toBe(src.resolve('geo:world-flags'));
});
