import { it, expect } from 'vitest';
import { normalizeGratitudeSubject } from './GratitudeSubject.mjs';

it('capitalizes the first letter and keeps the rest as given', () => {
  expect(normalizeGratitudeSubject('cookies')).toBe('Cookies');
  expect(normalizeGratitudeSubject('eating cookies')).toBe('Eating cookies');
  expect(normalizeGratitudeSubject('my brother Sam')).toBe('My brother Sam');
  expect(normalizeGratitudeSubject('Trips to the park')).toBe('Trips to the park');
});

it('drops a framing phrase, quotes and trailing punctuation the model left in', () => {
  expect(normalizeGratitudeSubject('I am grateful for eating cookies.')).toBe('Eating cookies');
  expect(normalizeGratitudeSubject("I'm thankful that Grandma visited!")).toBe('Grandma visited');
  expect(normalizeGratitudeSubject('“snow days”')).toBe('Snow days');
});

it('capitalizes the first letter even after a leading emoji', () => {
  expect(normalizeGratitudeSubject('🍪 cookies')).toBe('🍪 Cookies');
});

it('refuses empty, non-string and over-long subjects', () => {
  expect(normalizeGratitudeSubject('')).toBeNull();
  expect(normalizeGratitudeSubject('   ...  ')).toBeNull();
  expect(normalizeGratitudeSubject(null)).toBeNull();
  expect(normalizeGratitudeSubject(42)).toBeNull();
  expect(normalizeGratitudeSubject('a'.repeat(161))).toBeNull();
  expect(normalizeGratitudeSubject('a'.repeat(160))).toBe('A' + 'a'.repeat(159));
});
