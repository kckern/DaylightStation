import { describe, expect, it } from 'vitest';
import { onboardingCopy, onboardingStep, shouldOnboard } from './chessOnboarding.js';

describe('onboardingStep', () => {
  it('starts by asking them to find a square', () => {
    expect(onboardingStep({ history: [], origin: null })).toBe('find');
  });

  it('advances as the selection machine actually advances', () => {
    expect(onboardingStep({ history: [], hoveredChord: 'Cm' })).toBe('arm');
    expect(onboardingStep({ history: [], hoveredChord: 'Cm', armed: true })).toBe('lift');
    expect(onboardingStep({ history: [], origin: 'e2' })).toBe('land');
  });

  it('is finished after one completed move — that is the whole lesson', () => {
    expect(onboardingStep({ history: [{ san: 'e4' }] })).toBe('done');
  });

  it('reports the furthest state reached, not the order they were reached in', () => {
    // A player holding a piece is past "arm" even if a chord is also hovered.
    expect(onboardingStep({ history: [], origin: 'e2', hoveredChord: 'Cm', armed: true })).toBe('land');
  });
});

describe('onboardingCopy', () => {
  it('teaches in the vocabulary actually in use', () => {
    expect(onboardingCopy('find', { reading: false }).body).toMatch(/chord/i);
    expect(onboardingCopy('find', { reading: true }).body).toMatch(/notes/i);
  });

  it('says nothing once the lesson is done', () => {
    expect(onboardingCopy('done')).toBeNull();
  });

  it('has copy for every teachable step', () => {
    for (const step of ['find', 'arm', 'lift', 'land']) {
      const copy = onboardingCopy(step);
      expect(copy?.title, step).toBeTruthy();
      expect(copy?.body, step).toBeTruthy();
    }
  });
});

describe('shouldOnboard', () => {
  const base = { seen: false, gameOver: false, playerTurn: true, step: 'find' };

  it('shows on a first game', () => {
    expect(shouldOnboard(base)).toBe(true);
  });

  it('never returns for a player who has already played a move', () => {
    expect(shouldOnboard({ ...base, seen: true })).toBe(false);
  });

  it('stays out of the way on the opponent\'s turn', () => {
    // Every step asks for something the player cannot currently do.
    expect(shouldOnboard({ ...base, playerTurn: false })).toBe(false);
  });

  it('does not teach a finished game', () => {
    expect(shouldOnboard({ ...base, gameOver: true })).toBe(false);
  });

  it('stops once the lesson is complete', () => {
    expect(shouldOnboard({ ...base, step: 'done' })).toBe(false);
  });
});
