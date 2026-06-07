/**
 * VoiceMemoManager auto-popup eligibility gate.
 *
 * The session-end voice-memo auto-popup (FitnessPlayer "How did it go?") should
 * only fire when an eligible user (from fitness.yml `voice_memo_eligibility.users`)
 * is *currently active* in the roster. Manual recording is never gated.
 *
 * Semantics (per design 2026-06-07):
 * - Empty/absent eligible list => default-allow (everyone), like session_write_whitelist.
 * - "Live" eligibility: the matching roster entry must have isActive === true.
 * - Match by profileId, id, or baseUserName (a guest riding under an eligible user counts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceMemoManager } from '#frontend/hooks/fitness/VoiceMemoManager.js';

function makeSession(roster = []) {
  return {
    startTime: 1000,
    roster,
    logEvent() {},
  };
}

describe('VoiceMemoManager — auto-popup eligibility', () => {
  let session;
  let manager;

  beforeEach(() => {
    session = makeSession();
    manager = new VoiceMemoManager(session);
  });

  it('defaults to eligible when no eligible users are configured', () => {
    expect(manager.isAutoPromptEligible()).toBe(true);
  });

  it('stays eligible when configured with an empty list', () => {
    manager.setEligibleUsers([]);
    expect(manager.isAutoPromptEligible()).toBe(true);
  });

  it('is eligible when an eligible user is currently active (match by profileId)', () => {
    session.roster = [
      { id: 'felix', profileId: 'felix', isActive: true },
      { id: 'kckern', profileId: 'kckern', isActive: true },
    ];
    manager.setEligibleUsers(['kckern']);
    expect(manager.isAutoPromptEligible()).toBe(true);
  });

  it('is NOT eligible when the eligible user is present but inactive (live semantics)', () => {
    session.roster = [
      { id: 'kckern', profileId: 'kckern', isActive: false },
    ];
    manager.setEligibleUsers(['kckern']);
    expect(manager.isAutoPromptEligible()).toBe(false);
  });

  it('is NOT eligible when only non-eligible users are active', () => {
    session.roster = [
      { id: 'felix', profileId: 'felix', isActive: true },
      { id: 'milo', profileId: 'milo', isActive: true },
    ];
    manager.setEligibleUsers(['kckern']);
    expect(manager.isAutoPromptEligible()).toBe(false);
  });

  it('counts a guest riding under an eligible user (match by baseUserName)', () => {
    session.roster = [
      { id: 'device:42', profileId: null, baseUserName: 'kckern', isGuest: true, isActive: true },
    ];
    manager.setEligibleUsers(['kckern']);
    expect(manager.isAutoPromptEligible()).toBe(true);
  });

  it('matches by roster entry id as well as profileId', () => {
    session.roster = [
      { id: 'kckern', profileId: null, isActive: true },
    ];
    manager.setEligibleUsers(['kckern']);
    expect(manager.isAutoPromptEligible()).toBe(true);
  });

  it('returns to default-allow after eligible list is cleared', () => {
    manager.setEligibleUsers(['kckern']);
    expect(manager.isAutoPromptEligible()).toBe(false);
    manager.setEligibleUsers([]);
    expect(manager.isAutoPromptEligible()).toBe(true);
  });

  it('handles a missing/empty roster without throwing (not eligible when gated)', () => {
    session.roster = undefined;
    manager.setEligibleUsers(['kckern']);
    expect(manager.isAutoPromptEligible()).toBe(false);
  });
});
