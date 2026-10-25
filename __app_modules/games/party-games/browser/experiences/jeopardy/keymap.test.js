import { describe, it, expect } from 'vitest';
import { resolveJeopardyKey, remoteActionKey } from "./keymap.js";

describe('resolveJeopardyKey', () => {
  it('board: arrows move, enter selects', () => {
    expect(resolveJeopardyKey({ phase: 'board', key: 'ArrowLeft' })).toEqual({ type: 'MOVE_CURSOR', dir: 'left' });
    expect(resolveJeopardyKey({ phase: 'board', key: 'ArrowDown' })).toEqual({ type: 'MOVE_CURSOR', dir: 'down' });
    expect(resolveJeopardyKey({ phase: 'board', key: 'Enter' })).toEqual({ type: 'SELECT_TILE' });
  });
  it('clue: escape times out; enter returns when revealed', () => {
    expect(resolveJeopardyKey({ phase: 'clue', revealed: false, key: 'Escape' })).toEqual({ type: 'TIMEOUT' });
    expect(resolveJeopardyKey({ phase: 'clue', revealed: true, key: 'Enter' })).toEqual({ type: 'RETURN_TO_BOARD' });
    expect(resolveJeopardyKey({ phase: 'clue', revealed: false, key: 'Enter' })).toBe(null);
  });
  it('judging: up=correct, down=wrong, enter reveals if hidden', () => {
    expect(resolveJeopardyKey({ phase: 'judging', revealed: true, key: 'ArrowUp' })).toEqual({ type: 'JUDGE', correct: true });
    expect(resolveJeopardyKey({ phase: 'judging', revealed: true, key: 'ArrowDown' })).toEqual({ type: 'JUDGE', correct: false });
    expect(resolveJeopardyKey({ phase: 'judging', revealed: false, key: 'Enter' })).toEqual({ type: 'REVEAL' });
  });
  it('final-clue: enter reveals; unknown phases/keys → null', () => {
    expect(resolveJeopardyKey({ phase: 'final-clue', key: 'Enter' })).toEqual({ type: 'REVEAL' });
    expect(resolveJeopardyKey({ phase: 'wager', key: 'Enter' })).toBe(null);
    expect(resolveJeopardyKey({ phase: 'board', key: 'x' })).toBe(null);
  });
});

describe('remoteActionKey', () => {
  it('maps shell remote actions back to the host keys', () => {
    expect(remoteActionKey({ action: 'navigate', direction: 'up' })).toBe('ArrowUp');
    expect(remoteActionKey({ action: 'navigate', direction: 'right' })).toBe('ArrowRight');
    expect(remoteActionKey({ action: 'select' })).toBe('Enter');
    expect(remoteActionKey({ action: 'escape' })).toBe('Escape');
    expect(remoteActionKey({ action: 'select', repeat: true })).toBe(null);
    expect(remoteActionKey({ action: 'other' })).toBe(null);
  });
});

it('reveals an assigned-team clue on OK without requiring a buzzer',()=>{
 expect(resolveJeopardyKey({phase:'clue',revealed:false,answeringTeamId:'team_1',key:'Enter'})).toEqual({type:'REVEAL'});
 expect(resolveJeopardyKey({phase:'judging',revealed:false,key:'ArrowUp'})).toBe(null);
});
