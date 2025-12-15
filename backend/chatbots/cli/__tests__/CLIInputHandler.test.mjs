/**
 * CLI Input Handler Tests
 * @module cli/__tests__/CLIInputHandler.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { CLIInputHandler, InputType } from '../input/CLIInputHandler.mjs';

describe('CLIInputHandler', () => {
  let inputHandler;

  beforeEach(() => {
    inputHandler = new CLIInputHandler({
      presenter: { printSystemMessage: jest.fn() },
    });
  });

  describe('detectInputType', () => {
    describe('text input', () => {
      it('should detect plain text', () => {
        const result = inputHandler.detectInputType('hello world');
        expect(result.type).toBe(InputType.TEXT);
        expect(result.data.text).toBe('hello world');
      });

      it('should handle empty string', () => {
        const result = inputHandler.detectInputType('');
        expect(result.type).toBe(InputType.TEXT);
        expect(result.data.text).toBe('');
      });

      it('should handle whitespace', () => {
        const result = inputHandler.detectInputType('  trimmed  ');
        expect(result.type).toBe(InputType.TEXT);
        expect(result.data.text).toBe('trimmed');
      });

      it('should treat text with numbers as text', () => {
        const result = inputHandler.detectInputType('I ate 2 apples');
        expect(result.type).toBe(InputType.TEXT);
        expect(result.data.text).toBe('I ate 2 apples');
      });
    });

    describe('command input', () => {
      it('should detect /help command', () => {
        const result = inputHandler.detectInputType('/help');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('help');
        expect(result.data.args).toBeNull();
      });

      it('should detect /switch command', () => {
        const result = inputHandler.detectInputType('/switch');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('switch');
      });

      it('should detect /quit command', () => {
        const result = inputHandler.detectInputType('/quit');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('quit');
      });

      it('should detect /exit command', () => {
        const result = inputHandler.detectInputType('/exit');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('exit');
      });

      it('should detect /debug command', () => {
        const result = inputHandler.detectInputType('/debug');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('debug');
      });

      it('should detect /clear command', () => {
        const result = inputHandler.detectInputType('/clear');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('clear');
      });

      it('should detect /state command', () => {
        const result = inputHandler.detectInputType('/state');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('state');
      });

      it('should ignore case for commands', () => {
        const result = inputHandler.detectInputType('/HELP');
        expect(result.type).toBe(InputType.COMMAND);
        expect(result.data.command).toBe('help');
      });

      it('should treat unknown /commands as text', () => {
        const result = inputHandler.detectInputType('/unknown');
        expect(result.type).toBe(InputType.TEXT);
      });
    });

    describe('photo input', () => {
      it('should detect photo simulation', () => {
        const result = inputHandler.detectInputType('[photo:/path/to/image.jpg]');
        expect(result.type).toBe(InputType.PHOTO);
        expect(result.data.path).toBe('/path/to/image.jpg');
      });

      it('should handle photo with spaces in path', () => {
        const result = inputHandler.detectInputType('[photo:/path/to/my image.jpg]');
        expect(result.type).toBe(InputType.PHOTO);
        expect(result.data.path).toBe('/path/to/my image.jpg');
      });

      it('should be case insensitive', () => {
        const result = inputHandler.detectInputType('[PHOTO:/path/to/image.png]');
        expect(result.type).toBe(InputType.PHOTO);
        expect(result.data.path).toBe('/path/to/image.png');
      });
    });

    describe('voice input', () => {
      it('should detect voice simulation', () => {
        const result = inputHandler.detectInputType('[voice:I had a salad for lunch]');
        expect(result.type).toBe(InputType.VOICE);
        expect(result.data.transcript).toBe('I had a salad for lunch');
      });

      it('should handle voice with punctuation', () => {
        const result = inputHandler.detectInputType('[voice:Hello, how are you?]');
        expect(result.type).toBe(InputType.VOICE);
        expect(result.data.transcript).toBe('Hello, how are you?');
      });

      it('should be case insensitive', () => {
        const result = inputHandler.detectInputType('[VOICE:test message]');
        expect(result.type).toBe(InputType.VOICE);
        expect(result.data.transcript).toBe('test message');
      });
    });

    describe('UPC input', () => {
      it('should detect UPC barcode simulation', () => {
        const result = inputHandler.detectInputType('[upc:012345678901]');
        expect(result.type).toBe(InputType.UPC);
        expect(result.data.upc).toBe('012345678901');
      });

      it('should detect shorter UPC codes', () => {
        const result = inputHandler.detectInputType('[upc:12345678]');
        expect(result.type).toBe(InputType.UPC);
        expect(result.data.upc).toBe('12345678');
      });

      it('should be case insensitive', () => {
        const result = inputHandler.detectInputType('[UPC:999999999999]');
        expect(result.type).toBe(InputType.UPC);
        expect(result.data.upc).toBe('999999999999');
      });

      it('should not match non-numeric UPC', () => {
        const result = inputHandler.detectInputType('[upc:abc123]');
        expect(result.type).toBe(InputType.TEXT);
      });
    });
  });

  describe('isCommand', () => {
    it('should return true for commands', () => {
      expect(inputHandler.isCommand('/help')).toBe(true);
      expect(inputHandler.isCommand('/quit')).toBe(true);
    });

    it('should return false for non-commands', () => {
      expect(inputHandler.isCommand('hello')).toBe(false);
      expect(inputHandler.isCommand('[photo:test.jpg]')).toBe(false);
    });
  });

  describe('getAvailableCommands', () => {
    it('should return command list', () => {
      const commands = inputHandler.getAvailableCommands();
      expect(commands).toHaveProperty('help');
      expect(commands).toHaveProperty('switch');
      expect(commands).toHaveProperty('quit');
      expect(commands).toHaveProperty('exit');
      expect(commands).toHaveProperty('debug');
      expect(commands).toHaveProperty('clear');
      expect(commands).toHaveProperty('state');
    });
  });
});
