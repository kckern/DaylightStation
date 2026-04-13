// tests/unit/livestream/ProgramRunner.test.mjs
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgramRunner } from '../../../backend/src/2_domains/livestream/ProgramRunner.mjs';

const simpleProgram = {
  name: 'Test Program',
  start: 'intro',
  states: {
    intro: {
      play: '/audio/intro.mp3',
      then: { next: 'middle' },
    },
    middle: {
      play: '/audio/middle.mp3',
      then: {
        wait_for_input: { timeout: 30, default: 'a' },
        transitions: { a: 'path-a', b: 'path-b' },
      },
    },
    'path-a': {
      play: '/audio/path-a.mp3',
      then: 'stop',
    },
    'path-b': {
      queue: ['/audio/b1.mp3', '/audio/b2.mp3'],
      then: 'stop',
    },
  },
};

const randomProgram = {
  name: 'Random',
  start: 'pick',
  states: {
    pick: {
      random_pick: [
        { weight: 1, next: 'option-a' },
        { weight: 1, next: 'option-b' },
      ],
    },
    'option-a': { play: '/audio/a.mp3', then: 'stop' },
    'option-b': { play: '/audio/b.mp3', then: 'stop' },
  },
};

describe('ProgramRunner', () => {
  let runner;

  describe('start', () => {
    it('enters the start state and returns play action', () => {
      runner = new ProgramRunner(simpleProgram);
      const action = runner.start();
      expect(action).toEqual({ type: 'play', file: '/audio/intro.mp3' });
      expect(runner.currentState).toBe('intro');
    });

    it('throws if start state does not exist', () => {
      expect(() => new ProgramRunner({ start: 'missing', states: {} })).toThrow(/not found/);
    });
  });

  describe('advance (after track ends)', () => {
    it('transitions to next state via then.next', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start(); // intro
      const action = runner.advance();
      expect(runner.currentState).toBe('middle');
      expect(action).toEqual({ type: 'play', file: '/audio/middle.mp3' });
    });

    it('returns wait_for_input action when state requires input', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start(); // intro
      runner.advance(); // middle - play file
      const action = runner.advance(); // middle - then clause
      expect(action).toEqual({
        type: 'wait_for_input',
        timeout: 30,
        default: 'a',
        transitions: { a: 'path-a', b: 'path-b' },
      });
      expect(runner.isWaitingForInput).toBe(true);
    });

    it('returns stop action when then is "stop"', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance(); // → middle
      runner.advance(); // middle then → wait
      runner.receiveInput('a'); // → path-a
      const action = runner.advance(); // path-a then → stop
      expect(action).toEqual({ type: 'stop' });
      expect(runner.isFinished).toBe(true);
    });
  });

  describe('receiveInput', () => {
    it('transitions to the chosen state', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance(); // → middle
      runner.advance(); // → wait_for_input

      const action = runner.receiveInput('b');
      expect(runner.currentState).toBe('path-b');
      expect(action).toEqual({
        type: 'queue',
        files: ['/audio/b1.mp3', '/audio/b2.mp3'],
      });
      expect(runner.isWaitingForInput).toBe(false);
    });

    it('uses default choice on timeout', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance();
      runner.advance(); // → wait_for_input

      const action = runner.receiveInput(null); // timeout → default 'a'
      expect(runner.currentState).toBe('path-a');
    });

    it('throws if not waiting for input', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      expect(() => runner.receiveInput('a')).toThrow(/not waiting/);
    });
  });

  describe('queue action', () => {
    it('returns queue action with file list', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance(); // middle
      runner.advance(); // wait
      const action = runner.receiveInput('b'); // path-b
      expect(action.type).toBe('queue');
      expect(action.files).toEqual(['/audio/b1.mp3', '/audio/b2.mp3']);
    });
  });

  describe('random_pick', () => {
    it('picks a random state based on weights', () => {
      runner = new ProgramRunner(randomProgram);
      const action = runner.start();
      expect(['option-a', 'option-b']).toContain(runner.currentState);
      expect(action.type).toBe('play');
    });
  });
});
